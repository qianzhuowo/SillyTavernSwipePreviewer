#!/usr/bin/env node
/**
 * Safe, dependency-free real-JS browser integration test.
 * Run: node tests/mock-integration.mjs
 * Optional isolated UI measurements: --performance --artifacts=performance-results
 * Performance-only options: --performance-repeats=3 --performance-stress --performance-narrow
 * Requires Node 22+ (built-in WebSocket) and Chrome/Chromium/Edge.
 * Optional: CHROME_PATH=/path/to/browser. No real SillyTavern server is contacted.
 * Product files are snapshotted into an allowlisted, ephemeral localhost server.
 * Saves, chat switches, bookmarks and native message rendering are in-memory mocks only.
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runKeyboardBrowserCases } from './keyboard-browser-cases.mjs';
import { runHelpBrowserCases } from './help-browser-cases.mjs';

const selectionOnly = process.argv.includes('--selection-only');
const performanceMode = process.argv.includes('--performance');
if (performanceMode && selectionOnly) throw new Error('--performance cannot be combined with --selection-only');
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const routes = new Map();
const artifactArg = process.argv.find(arg => arg.startsWith('--artifacts='));
const artifacts = artifactArg ? resolve(root, 'tests', artifactArg.slice('--artifacts='.length))
    : performanceMode ? resolve(root, 'tests', 'performance-results') : null;
if (artifacts) await mkdir(artifacts, { recursive: true });
const snapshots = {};
const files = ['index.js', 'native-integration.mjs', 'timeline-preferences.mjs', 'style.css', 'swipe-data.mjs', 'branch-tree.js',
    ...(!selectionOnly ? ['timeline-graph.mjs', 'timeline-virtual.mjs', 'timeline.css'] : []),
    'tests/mock-host.mjs', 'tests/browser-cases.mjs', 'tests/timeline-browser-cases.mjs', 'tests/timeline-test-helpers.mjs',
    'tests/virtualization-browser-cases.mjs', 'tests/tree-preferences-browser-cases.mjs',
    ...(performanceMode ? ['tests/timeline-performance.mjs'] : [])];
for (const file of files) {
    const content = await readFile(join(root, file), 'utf8');
    routes.set('/' + file, { type: file.endsWith('.css') ? 'text/css' : 'text/javascript', content });
    if (!file.startsWith('tests/')) {
        snapshots[file] = createHash('sha256').update(content).digest('hex');
        console.log(`SNAPSHOT ${file} ${snapshots[file].slice(0, 12)}`);
    }
}
if (selectionOnly) {
    // No graph UI is exercised in this subset; its optional CSS is deliberately inert.
    routes.set('/timeline.css', { type: 'text/css', content: '' });
    console.log('SUBSET: selection/preview only; graph and graph CSS are not tested.');
}
routes.set('/script.js', { type: 'text/javascript', content: `
export const isGenerating = () => !!window.mock.generating;
export let isChatSaving = false;
export const cancelDebouncedChatSave = () => { window.mock.stats.cancelledSaves++; };
export async function showMoreMessages(count) {
    const mock = window.mock;
    (mock.stats.historyLoads ??= []).push(count);
    const chat = document.querySelector('#chat');
    const first = chat.querySelector('.mes[mesid]');
    const firstId = first ? Number(first.getAttribute('mesid')) : mock.context.chat.length;
    const fragment = document.createDocumentFragment();
    for (let id = Math.max(0, firstId - count); id < firstId; id++) {
        fragment.append(mock.createMessageElement(id));
    }
    chat.insertBefore(fragment, first);
    if (mock.historyLoadHook) await mock.historyLoadHook();
    await mock.context.eventSource.emit(mock.context.event_types.MORE_MESSAGES_LOADED);
}
` });
routes.set('/scripts/events.js', { type: 'text/javascript', content: `
export const eventSource = window.mock.context.eventSource;
export const event_types = window.mock.context.event_types;
` });
routes.set('/scripts/bookmarks.js', { type: 'text/javascript', content: `
export async function createBranch(index) {
    const mock = window.mock; mock.stats.branches++;
    const message = mock.context.chat[index];
    (message.extra.branches ??= []).push('mock-branch-only');
    return 'mock-branch-only';
}
` });
routes.set('/', { type: 'text/html', content: `<!doctype html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:,"><style>
:root { --SmartThemeBlurTintColor: #eee; --SmartThemeBodyColor: #222;
--SmartThemeEmColor: #555; --SmartThemeQuoteColor: #963; --SmartThemeBorderColor: #888;
--SmartThemeShadowColor: #0005; --mainFontFamily: sans-serif; --mainFontSize: 15px; }
.menu_button { color: var(--SmartThemeBodyColor); background: var(--SmartThemeBlurTintColor);
border: 1px solid var(--SmartThemeBorderColor); padding: 3px 5px; cursor: pointer; }
.options-content a { display:flex; gap:10px; align-items:baseline; padding:5px; color:var(--SmartThemeBodyColor); cursor:pointer; opacity:.5; }
.options-content a:hover { opacity:1; }
.options-content i { width:20px; height:20px; pointer-events:none; }
</style><link rel="stylesheet" href="/style.css"></head><body>
<div id="extensions_settings2"><button id="st-swipe-tree-entry">Legacy tree entry</button></div>
<button id="options_button" class="interactable" type="button">Chat options</button>
<div id="options" style="display:none"><div class="options-content">
<a id="option_select_chat" class="interactable" tabindex="0"><i class="fa-lg fa-solid fa-address-book"></i><span>Manage chat files</span></a><hr>
</div></div>
<div id="message_template" hidden><div class="mes" mesid="{{mesid}}">
<div class="mes_buttons"><div class="mes_edit mes_button" role="button" tabindex="0">Edit</div></div>
<div class="extraMesButtons"><div class="mes_button">Native extra</div></div>
<div class="mes_text"></div></div></div>
<div id="chat"></div>
<script type="module">import { installMockHost } from '/tests/mock-host.mjs';
await installMockHost(); await import('/index.js');</script></body></html>` });
const unexpectedRequests = [];
const server = createServer((request, response) => {
    const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
    const route = request.method === 'GET' && routes.get(pathname);
    if (!route) {
        unexpectedRequests.push(`${request.method} ${pathname}`);
        response.writeHead(404); response.end('No real server API exists in this mock'); return;
    }
    response.writeHead(200, { 'Content-Type': `${route.type}; charset=utf-8`, 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self' about:;" });
    response.end(route.content);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const candidates = [process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
let executable;
for (const path of candidates) { try { await access(path); executable = path; break; } catch {} }
if (!executable) { server.close(); throw new Error('Set CHROME_PATH to a Chrome/Chromium/Edge executable'); }
const profile = await mkdtemp(join(tmpdir(), 'swipe-mock-integration-'));
let browser;
let socket;
let timer;
let nextId = 0;
const pending = new Map();
function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
}
try {
    browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', '--disable-component-update', '--disable-sync',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--remote-debugging-port=0',
        '--user-data-dir=' + profile, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const debuggerUrl = await new Promise((resolve, reject) => {
        let log = '';
        const timeout = setTimeout(() => reject(new Error('Chrome did not start debugging server')), 15000);
        browser.on('error', reject);
        browser.stderr.on('data', data => {
            log += data;
            const match = log.match(/DevTools listening on (ws:\/\/\S+)/);
            if (match) { clearTimeout(timeout); resolve(match[1]); }
        });
    });
    socket = new WebSocket(debuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        if (!message.id) return;
        const promise = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) promise?.reject(new Error(JSON.stringify(message.error)));
        else promise?.resolve(message.result);
    };
    const { targetId } = await send('Target.createTarget', { url: origin });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const evaluate = async expression => {
        const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
        if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
        return result.result.value;
    };
    const screenshot = async name => {
        if (!artifacts) return;
        const { data } = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
        const path = join(artifacts, `${name}.png`);
        await writeFile(path, Buffer.from(data, 'base64'));
        console.log(`SCREENSHOT ${path}`);
    };
    const deadline = Date.now() + 10000;
    while (!await evaluate('!!document.querySelector("#chat .st-swipe-previewer-button")')) {
        if (Date.now() > deadline) throw new Error('Plugin did not register against mock host');
        await new Promise(resolve => setTimeout(resolve, 25));
    }
    if (performanceMode) {
        // Reuse exactly the same allowlist, product snapshots and temporary Chrome.
        // The suite creates a fresh page per sample; no default regression case runs here.
        const { runPerformanceSuite } = await import('./timeline-performance.mjs');
        await send('Target.closeTarget', { targetId });
        await runPerformanceSuite({ send, origin, snapshots, artifacts, executable, root, unexpectedRequests });
    } else {
    const results = await Promise.race([
        evaluate(`import('/tests/browser-cases.mjs').then(module => module.runIntegrationCases({ selectionOnly: ${selectionOnly} }))`),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Integration cases timed out')), 90000); }),
    ]);
    clearTimeout(timer);
    try {
        await send('Page.bringToFront', {}, sessionId);
        await evaluate(`(async () => {
            await mock.reset();
            document.querySelector('#chat .mes[mesid="0"] .st-swipe-previewer-button').click();
            for (let i = 0; document.querySelectorAll('.st-swipe-card').length !== 5 && i < 100; i++) await new Promise(r => setTimeout(r, 20));
            document.querySelector('#st-swipe-preview-modal-delete-mode').click();
            document.querySelector('.st-swipe-jump-item[data-idx="2"]').focus();
        })()`);
        for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32 }, sessionId);
        const keyboardSelection = await evaluate(`document.querySelector('.st-swipe-jump-item[data-idx="2"]').getAttribute('aria-pressed') === 'true' && document.querySelector('.st-swipe-jump-item[data-idx="2"]').getAttribute('aria-current') === 'true'`);
        if (!keyboardSelection) throw new Error('Space did not select the current numbered branch');
        for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId);
        const exited = await evaluate(`!!document.querySelector('#st-swipe-preview-modal') && document.querySelector('.st-swipe-selection-toolbar').hidden && document.activeElement.id === 'st-swipe-preview-modal-delete-mode' && mock.stats.saves === 0`);
        if (!exited) throw new Error('Escape did not exit selection and focus trash without closing preview');
        results.push({ name: 'real Space selects numbered branch; Escape exits mode and restores trash focus', status: 'passed' });
    } catch (error) { results.push({ name: 'real selection keyboard controls', status: 'failed', error: error.message }); }
    if (!selectionOnly) {
    // Exercise actual plugin-generated DOM at desktop and small viewport sizes.
    for (const width of [1280, 600, 320]) {
        const name = `real preview/tree long-text layout at ${width}px`;
        try {
            await send('Emulation.setDeviceMetricsOverride', { width, height: 640, deviceScaleFactor: 1, mobile: false }, sessionId);
            const uiResults = await evaluate(`import('/tests/timeline-browser-cases.mjs').then(module => module.runTimelineUiCases())`);
            results.push(...uiResults.map(result => ({ ...result, name: `${result.name} at ${width}px` })));
            const failures = await evaluate(`(async () => {
                await mock.reset();
                const wait = async fn => { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 20)); } throw new Error('layout render timeout'); };
                mock.context.chat[0].swipes[0] = 'UnbrokenLongCandidate'.repeat(150);
                document.querySelector('#chat .mes[mesid="0"] .st-swipe-previewer-button').click();
                await wait(() => document.querySelectorAll('.st-swipe-card').length === 5);
                const overflow = selector => [...document.querySelectorAll(selector)].filter(e => e.scrollWidth > e.clientWidth + 2).map(e => e.className);
                const failures = overflow('.st-swipe-modal-container,.st-swipe-modal-header,.st-swipe-modal-content,.st-swipe-card');
                document.querySelector('#st-swipe-preview-modal-delete-mode').click();
                failures.push(...overflow('.st-swipe-modal-container,.st-swipe-modal-header,.st-swipe-selection-toolbar,.st-swipe-jump-list'));
                document.querySelector('#st-swipe-preview-modal-close').click();
                document.querySelector('#st-swipe-tree-entry').click();
                await wait(() => document.querySelector('.st-swipe-timeline-node-selected'));
                const { revealTimeline } = await import('/tests/timeline-test-helpers.mjs');
                (await revealTimeline('.st-swipe-timeline-node[data-node-id="0:0"]')).click();
                await wait(() => document.querySelector('.st-swipe-timeline-preview'));
                // The graph viewport intentionally scrolls on both axes; surrounding UI must not overflow.
                failures.push(...overflow('.st-swipe-modal-container,.st-swipe-modal-header,.st-swipe-modal-content,.st-swipe-timeline-detail,.st-swipe-timeline-tools,.st-swipe-timeline-controls'));
                const toolsToggle = document.querySelector('.st-swipe-timeline-tools-toggle');
                const controls = document.querySelector('.st-swipe-timeline-controls');
                if (!controls.hidden || toolsToggle.getAttribute('aria-expanded') !== 'false') failures.push('tools not initially collapsed');
                toolsToggle.click();
                if (controls.hidden || toolsToggle.getAttribute('aria-expanded') !== 'true') failures.push('tools did not actually expand');
                failures.push(...overflow('.st-swipe-timeline-tools,.st-swipe-timeline-controls,.st-swipe-timeline-control-row'));
                document.querySelector('.st-swipe-timeline-search-toggle').click();
                failures.push(...overflow('.st-swipe-timeline-tools,.st-swipe-timeline-toolbar,.st-swipe-timeline-header,.st-swipe-timeline-status-row,.st-swipe-timeline-summary-shell'));
                const viewport = document.querySelector('.st-swipe-timeline-viewport');
                if (viewport.clientHeight < 100 || viewport.clientWidth < 100) failures.push('graph viewport unusably small');
                document.querySelector('.st-swipe-tree-close').click();
                return failures;
            })()`);
            if (failures.length) throw new Error('Horizontal overflow: ' + failures.join(', '));
            results.push({ name, status: 'passed' });
        } catch (error) { results.push({ name, status: 'failed', error: error.message }); }
        const dragName = `real summary range mouse drag, touch scroll and resize at ${width}px`;
        try {
            await evaluate(`(async () => {
                await mock.reset();
                mock.context.chat = Array.from({ length: 90 }, (_, i) => ({ name: 'AI', mes: 'Floor ' + i, extra: {} }));
                document.querySelector('#st-swipe-tree-entry').click();
                for (let i = 0; !document.querySelector('.st-swipe-timeline-summary-gap') && i < 150; i++) await new Promise(r => setTimeout(r, 20));
                if (!document.querySelector('.st-swipe-timeline-summary-gap')) throw new Error('summary did not render');
            })()`);
            await screenshot(`timeline-${width}-collapsed`);
            await evaluate(`document.querySelector('.st-swipe-timeline-tools-toggle').click()`);
            await screenshot(`timeline-${width}-tools-expanded`);
            await evaluate(`(async () => {
                document.querySelector('.st-swipe-timeline-tools-toggle').click();
                document.querySelector('.st-swipe-timeline-search-toggle').click();
                document.querySelector('.st-swipe-timeline-summary-gap').click();
                for (let i = 0; document.querySelector('.st-swipe-timeline-summary-scroll').hidden && i < 150; i++) await new Promise(r => setTimeout(r, 20));
                const summary = document.querySelector('.st-swipe-timeline-path-summary');
                summary.scrollLeft = 0;
                await new Promise(r => setTimeout(r, 50));
            })()`);
            const slider = await evaluate(`(() => {
                const e = document.querySelector('.st-swipe-timeline-summary-scroll'), b = e.getBoundingClientRect();
                if (e.hidden || b.width < 100) throw new Error('range not visibly usable');
                return { x: b.left, y: b.top + b.height / 2, width: b.width };
            })()`);
            await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: slider.x + 8, y: slider.y }, sessionId);
            await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: slider.x + 8, y: slider.y, button: 'left', buttons: 1, clickCount: 1 }, sessionId);
            for (let i = 1; i <= 8; i++) await send('Input.dispatchMouseEvent', {
                type: 'mouseMoved', x: slider.x + 8 + (slider.width * .75 - 8) * i / 8, y: slider.y, button: 'left', buttons: 1,
            }, sessionId);
            await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: slider.x + slider.width * .75, y: slider.y, button: 'left', buttons: 0, clickCount: 1 }, sessionId);
            const dragged = await evaluate(`(() => {
                const summary = document.querySelector('.st-swipe-timeline-path-summary'), slider = document.querySelector('.st-swipe-timeline-summary-scroll');
                return { left: summary.scrollLeft, value: Number(slider.value), max: Number(slider.max) };
            })()`);
            if (dragged.left < dragged.max * .5 || Math.abs(dragged.left - dragged.value) > 1) throw new Error('native mouse drag did not scroll/sync: ' + JSON.stringify(dragged));
            await screenshot(`timeline-${width}-search-summary-dragged`);
            await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }, sessionId);
            const touch = await evaluate(`(() => {
                const summary = document.querySelector('.st-swipe-timeline-path-summary'), b = summary.getBoundingClientRect();
                return { x: b.left + b.width * .7, y: b.top + b.height / 2, before: summary.scrollLeft, distance: Math.min(120, b.width * .4) };
            })()`);
            await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touch.x, y: touch.y }] }, sessionId);
            for (let i = 1; i <= 8; i++) {
                await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touch.x - touch.distance * i / 8, y: touch.y }] }, sessionId);
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId);
            await new Promise(resolve => setTimeout(resolve, 400));
            const touched = await evaluate(`(() => {
                const summary = document.querySelector('.st-swipe-timeline-path-summary'), slider = document.querySelector('.st-swipe-timeline-summary-scroll');
                return { left: summary.scrollLeft, value: Number(slider.value) };
            })()`);
            if (touched.left <= touch.before + 20 || Math.abs(touched.left - touched.value) > 1) throw new Error('native touch scroll did not move/sync: ' + JSON.stringify({ touch, touched }));
            await send('Emulation.setTouchEmulationEnabled', { enabled: false }, sessionId);
            await send('Emulation.setDeviceMetricsOverride', { width: width === 320 ? 600 : 320, height: 640, deviceScaleFactor: 1, mobile: false }, sessionId);
            await evaluate(`(async () => {
                const summary = document.querySelector('.st-swipe-timeline-path-summary'), slider = document.querySelector('.st-swipe-timeline-summary-scroll');
                await new Promise(r => setTimeout(r, 120));
                if (Number(slider.max) !== summary.scrollWidth - summary.clientWidth || Math.abs(Number(slider.value) - summary.scrollLeft) > 1) throw new Error('range stale after real viewport resize');
            })()`);
            await send('Emulation.setDeviceMetricsOverride', { width, height: 640, deviceScaleFactor: 1, mobile: false }, sessionId);
            results.push({ name: dragName, status: 'passed' });
        } catch (error) {
            results.push({ name: dragName, status: 'failed', error: error.message });
            await screenshot(`timeline-${width}-failure`);
        } finally { await send('Emulation.setTouchEmulationEnabled', { enabled: false }, sessionId); }
    }
    try {
        await send('Page.bringToFront', {}, sessionId);
        await evaluate(`(async () => {
            await mock.reset();
            document.querySelector('#chat .mes[mesid="0"] .st-swipe-previewer-button').click();
            for (let i = 0; document.querySelectorAll('.st-swipe-card').length !== 5 && i < 100; i++) await new Promise(r => setTimeout(r, 20));
            mock.sourcePreview = document.querySelector('#st-swipe-preview-modal');
            document.querySelector('#st-swipe-preview-modal-tree').focus();
            document.querySelector('#st-swipe-preview-modal-tree').click();
            for (let i = 0; !document.querySelector('.st-swipe-timeline-node-selected') && i < 100; i++) await new Promise(r => setTimeout(r, 20));
        })()`);
        for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
        const focus = await evaluate(`({ visible: document.activeElement.matches(':focus-visible'), outline: getComputedStyle(document.activeElement).outlineStyle, width: getComputedStyle(document.activeElement).outlineWidth })`);
        if (!focus.visible || focus.outline !== 'solid' || focus.width !== '2px') throw new Error('Focus outline: ' + JSON.stringify(focus));
        for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }, sessionId);
        const restored = await evaluate(`!document.querySelector('#st-swipe-tree-modal') && document.querySelector('#st-swipe-preview-modal') === mock.sourcePreview && !mock.sourcePreview.hidden && document.activeElement.id === 'st-swipe-preview-modal-tree' && mock.stats.saves === 0`);
        if (!restored) throw new Error('Escape did not restore the same source preview and its tree-button focus');
        results.push({ name: 'real Tab focus outline and Escape focus restoration', status: 'passed' });
    } catch (error) { results.push({ name: 'real Tab focus outline and Escape focus restoration', status: 'failed', error: error.message }); }
    }
    if (!selectionOnly) {
        results.push(...await evaluate(`import('/tests/virtualization-browser-cases.mjs').then(module => module.runVirtualizationCases())`));
        results.push(...await evaluate(`import('/tests/tree-preferences-browser-cases.mjs').then(module => module.runTreePreferenceCases())`));
    }
    results.push(...await runKeyboardBrowserCases({ evaluate, send, sessionId, selectionOnly }));
    if (!selectionOnly) results.push(...await runHelpBrowserCases({ evaluate, send, sessionId, screenshot }));
    if (artifacts) await writeFile(join(artifacts, 'results.json'), JSON.stringify({ snapshots, results, unexpectedRequests }, null, 2));
    for (const result of results) console.log(`${result.status === 'passed' ? 'PASS' : 'FAIL'} ${result.name}${result.error ? '\n  ' + result.error : ''}`);
    console.log(`RESULT ${results.filter(result => result.status === 'passed').length}/${results.length} passed`);
    if (results.some(result => result.status !== 'passed')) process.exitCode = 1;
    }
    if (unexpectedRequests.length) {
        console.error('Unexpected localhost requests:', unexpectedRequests);
        process.exitCode = 1;
    }
    console.log('SAFETY: all product modules served from snapshot; chat/save/bookmark APIs mocked; no real server route available.');
} catch (error) {
    console.error(error);
    process.exitCode = 1;
} finally {
    clearTimeout(timer);
    if (socket?.readyState === WebSocket.OPEN) {
        await Promise.race([send('Browser.close').catch(() => {}), new Promise(resolve => setTimeout(resolve, 1000))]);
        socket.close();
    }
    browser?.kill();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(error => {
        console.warn('Temporary browser profile cleanup deferred:', error.message);
    });
}
