#!/usr/bin/env node
// Standalone native integration browser tests; no shared mock-host/browser files used.
// Node 22+ and Chrome/Chromium/Edge. Only an allowlisted ephemeral localhost server is contacted.
import { createServer } from 'node:http';
import { readFile, access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const routes = new Map();
for (const file of ['index.js', 'native-integration.mjs', 'timeline-preferences.mjs', 'swipe-data.mjs', 'style.css', 'branch-tree.js', 'timeline-graph.mjs', 'timeline-virtual.mjs', 'timeline.css', 'tests/native-browser-cases.mjs']) {
    routes.set('/' + file, [file.endsWith('.css') ? 'text/css' : 'text/javascript', await readFile(new URL('../' + file, import.meta.url), 'utf8')]);
}

routes.set('/script.js', ['text/javascript', 'export const isGenerating = () => false; export const isChatSaving = false; export const cancelDebouncedChatSave = () => {};']);
routes.set('/scripts/events.js', ['text/javascript', "export { eventSource, event_types } from '/tests/native-browser-cases.mjs';"]);
routes.set('/', ['text/html', `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,">
<link rel="stylesheet" href="/style.css"><style>#message_template { display:none } .extraMesButtons { display:flex }
:root { --SmartThemeBlurTintColor:#eee; --SmartThemeBodyColor:#222; --SmartThemeBorderColor:#aaa; --mainFontFamily:sans-serif; --mainFontSize:15px }</style></head>
<body><div id="extensions_settings2"></div>
<button id="options_button" type="button">Options</button><div id="options" style="display:none"><div class="options-content"><a id="option_select_chat" class="interactable" tabindex="0"><i class="fa-lg fa-solid fa-address-book"></i><span>Manage chat files</span></a><hr></div></div>
<div id="chat"></div><div id="message_template">
<div class="mes" mesid=""><div class="mes_block"><div class="mes_buttons"><div class="mes_button extraMesButtonsHint"></div><div class="extraMesButtons"><div class="mes_button mes_copy"></div></div><div class="mes_button mes_edit"></div></div><div class="mes_text"></div></div></div>
</div></body></html>`]);
const unexpectedRequests = [];
const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    const route = request.method === 'GET' && routes.get(path);
    if (!route) { unexpectedRequests.push(request.method + ' ' + path); response.writeHead(404); response.end(); return; }
    response.writeHead(200, { 'Content-Type': route[0] + '; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self' about:;" });
    response.end(route[1]);
});
const candidates = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
let executable;
for (const path of candidates) { try { await access(path); executable = path; break; } catch {} }
if (!executable) throw new Error('Set CHROME_PATH to a Chrome/Chromium/Edge executable');
const profile = await mkdtemp(join(tmpdir(), 'swipe-native-browser-'));
let browser, socket;
const pending = new Map();
let nextId = 0;
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
});
const timeout = setTimeout(() => { console.error('Native browser test deadline exceeded'); browser?.kill(); process.exitCode = 1; }, 45000);
try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', '--disable-component-update', '--disable-sync',
        '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1', '--remote-debugging-port=0',
        '--user-data-dir=' + profile, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const debuggerUrl = await new Promise((resolve, reject) => {
        let log = '';
        const timer = setTimeout(() => reject(new Error('Browser startup timed out')), 15000);
        browser.once('error', error => { clearTimeout(timer); reject(error); });
        browser.stderr.on('data', data => {
            log += data;
            const match = log.match(/DevTools listening on (ws:\/\/\S+)/);
            if (match) { clearTimeout(timer); resolve(match[1]); }
        });
    });
    socket = new WebSocket(debuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = event => {
        const message = JSON.parse(event.data);
        const task = pending.get(message.id);
        if (task) { pending.delete(message.id); if (message.error) task.reject(new Error(JSON.stringify(message.error))); else task.resolve(message.result); }
    };
    socket.onclose = () => { for (const task of pending.values()) task.reject(new Error('Browser disconnected')); pending.clear(); };
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Runtime.enable', {}, sessionId);
    await send('Page.enable', {}, sessionId);
    const evaluate = async expression => {
        const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? JSON.stringify(result.exceptionDetails));
        return result.result.value;
    };
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` }, sessionId);
    for (let i = 0; i < 100; i++) {
        if (await evaluate("document.readyState === 'complete' && !!document.querySelector('#message_template')")) break;
        await new Promise(resolve => setTimeout(resolve, 20));
    }
    const results = await evaluate("import('/tests/native-browser-cases.mjs').then(module => module.runNativeBrowserCases())");
    for (const result of results) console.log(`PASS ${result.name}`);
    if (unexpectedRequests.length) throw new Error('Unexpected network requests: ' + unexpectedRequests.join(', '));
    console.log(`Native browser: ${results.length} passed; no wrapper access, real saves or external requests.`);
} finally {
    clearTimeout(timeout);
    socket?.close();
    if (browser && browser.exitCode === null) {
        const exited = new Promise(resolve => browser.once('exit', resolve));
        browser.kill(); await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 2000))]);
    }
    await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
