// Isolated tree-only browser regression. No real host, native APIs, chat files or shared mock edits.
// Run: node --test tests/timeline-virtual-browser.test.mjs (Node 22+, Chrome/Edge; CHROME_PATH optional).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

async function browserCases() {
    const { showBranchTree } = await import('/branch-tree.js');
    localStorage.removeItem('st-swipe-previewer-tree-preferences');
    const assert = (ok, message) => { if (!ok) throw new Error(message); };
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const wait = async (fn, label) => { for (let n = 0; n < 250; n++) { if (fn()) return; await sleep(20); } throw new Error(`timeout: ${label}`); };
    const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
    const node = id => $(`.st-swipe-timeline-node[data-node-id="${id}"]`);
    const names = ['CHAT_CHANGED', 'MESSAGE_SWIPED', 'MESSAGE_UPDATED', 'MESSAGE_EDITED', 'MESSAGE_DELETED',
        'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_SWIPE_DELETED', 'GENERATION_ENDED', 'GENERATION_STOPPED', 'CHARACTER_FIRST_MESSAGE_SELECTED'];
    const listeners = new Map();
    const emit = (name, id) => { for (const fn of listeners.get(name) ?? []) fn(id); };
    const message = (i, count = 11) => ({ name: 'AI', mes: `floor ${i}`, swipe_id: 0,
        swipes: Array.from({ length: count }, (_, swipe) => `floor ${i} swipe ${swipe}`) });
    const context = { chat: Array.from({ length: 6000 }, (_, i) => message(i)), chatId: 'one',
        eventTypes: Object.fromEntries(names.map(n => [n, n])), eventSource: {
            on: (name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
            removeListener: (name, fn) => listeners.get(name)?.delete(fn),
        } };
    window.SillyTavern = { getContext: () => context };
    let previews = 0;
    const openedAt = performance.now();
    const tree = showBranchTree({ onPreview: () => previews++, focusMesId: 3000, focusSwipeIdx: 0 });
    await wait(() => node('3000:0'), 'initial source');
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const initial = { cards: $$('.st-swipe-timeline-node').length, paths: $$('.st-swipe-timeline-edge').length,
        overview: $$('.st-swipe-timeline-path-step').length, openMs: Math.round((performance.now() - openedAt) * 10) / 10 };
    const viewport = $('.st-swipe-timeline-viewport');
    assert($$('.st-swipe-timeline-node').length < 80, 'bounded cards');
    assert($$('.st-swipe-timeline-edge').length < 30, 'bounded SVG DOM');
    assert($$('.st-swipe-timeline-path-step').length < 20, 'bounded overview');
    assert($('.st-swipe-timeline-edges').getBoundingClientRect().width <= viewport.clientWidth + 362, 'viewport-sized SVG surface');
    const initialNode = node('3000:0'), neighbor = node('3001:0'), initialScroll = viewport.scrollTop;
    viewport.scrollTop += 3; viewport.dispatchEvent(new Event('scroll')); await sleep(80);
    assert(node('3000:0') === initialNode && node('3001:0') === neighbor, 'scroll preserves node identities');
    node('3000:0').click();
    const oldPreview = $('.st-swipe-timeline-preview');
    context.chat[3000].mes = 'edited incrementally'; emit('MESSAGE_EDITED', 3000);
    oldPreview.click(); assert(previews === 0, 'old detail action invalid immediately');
    await wait(() => node('3000:0')?.textContent.includes('edited incrementally'), 'incremental edit');
    assert(node('3000:0') === initialNode && node('3001:0') === neighbor, 'edit preserves cards including unaffected neighbor');
    assert(Math.abs(viewport.scrollTop - initialScroll - 3) < 2, 'edit preserves scroll');
    context.chat[3000].swipe_id = 2; context.chat[3000].mes = 'current two'; emit('MESSAGE_SWIPED', 3000);
    await wait(() => node('3000:2')?.dataset.current === 'true', 'incremental swipe');
    assert(node('3001:0') === neighbor, 'swipe preserves neighbor DOM');
    assert($$('.st-swipe-timeline-edge-current').some(e => e.dataset.from === '3000:2' && e.dataset.to === '3001:0'), 'adjacent edges repaired');
    node('3000:2').focus();
    viewport.scrollTop = viewport.scrollHeight;
    await wait(() => node('5999:0'), 'scroll tail');
    assert(document.activeElement === viewport, 'unmounted focused card returns focus to virtual viewport');
    $('.st-swipe-timeline-go-tail').click();
    await wait(() => document.activeElement === node('5999:0'), 'tail keyboard focus');
    const oldDetail = $('.st-swipe-timeline-detail').hidden;
    initialNode.click(); assert($('.st-swipe-timeline-detail').hidden === oldDetail, 'detached old card cannot act');
    $('.st-swipe-timeline-go-head').click(); await wait(() => node('0:0'), 'head');
    $('.st-swipe-timeline-go-source').click(); await wait(() => node('3000:0'), 'source');
    // Far horizontal candidate is reachable via search despite never having been mounted.
    context.chat[5000] = message(5000, 1001); context.chat[5000].swipes[1000] = 'uniquefarneedle'; emit('MESSAGE_UPDATED', 5000);
    await sleep(120);
    $('.st-swipe-timeline-search-toggle').click();
    const search = $('.st-swipe-timeline-search'); search.value = 'uniquefarneedle'; search.dispatchEvent(new Event('input'));
    await wait(() => node('5000:1000')?.classList.contains('st-swipe-timeline-node-match'), 'unmounted horizontal search match');
    assert($('.st-swipe-timeline-match-count').textContent === '1 / 1', 'unmounted is not filter-hidden');
    assert($$('.st-swipe-timeline-node').length < 80, 'horizontal candidate clipping');
    search.value = 'floor'; search.dispatchEvent(new Event('input'));
    search.value = 'nomatch-cancel'; search.dispatchEvent(new Event('input'));
    await wait(() => $('.st-swipe-timeline-status').textContent.includes('匹配 0'), 'query cancellation');
    const summary = $('.st-swipe-timeline-path-summary'); summary.scrollLeft = summary.scrollWidth;
    for (let i = 0; i < 5; i++) viewport.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -1, cancelable: true }));
    await wait(() => $('.st-swipe-timeline-zoom-label').textContent === '150%', 'coalesced zoom');
    assert($$('.st-swipe-timeline-node').length < 80, 'zoom keeps bounded DOM');
    $('.st-swipe-timeline-zoom-reset').click();
    await wait(() => $('.st-swipe-timeline-zoom-label').textContent === '100%', 'zoom reset');
    await wait(() => $('.st-swipe-timeline-path-step[data-mes-id="5999"]'), 'virtual summary tail');
    assert($$('.st-swipe-timeline-path-step').length < 20, 'summary remains bounded at tail');
    const oldSummary = $('.st-swipe-timeline-path-step[data-mes-id="5999"]');
    context.chat = Array.from({ length: 6000 }, (_, i) => message(i, 1)); context.chatId = 'two'; emit('CHAT_CHANGED');
    oldSummary.click();
    await wait(() => $('.st-swipe-timeline-summary-gap'), 'new chat summary');
    $('.st-swipe-timeline-summary-gap').click();
    await wait(() => $$('.st-swipe-timeline-path-step').length > 0, 'expanded virtual summary');
    assert($$('.st-swipe-timeline-path-step').length < 20, 'expanded ordinary run is virtualized');
    assert($('.st-swipe-timeline-go-source').disabled, 'source invalid after switch');
    context.chat.splice(0, 1); emit('MESSAGE_DELETED', 0);
    await wait(() => $('.st-swipe-tree-stats').textContent.includes('5999个'), 'delete structure rebuild');
    context.chat.push(message(5999, 1)); emit('MESSAGE_RECEIVED', 5999);
    await wait(() => $('.st-swipe-tree-stats').textContent.includes('6000个'), 'append structure rebuild');
    tree.close(); await sleep(50);
    assert([...listeners.values()].every(set => !set.size), 'event cleanup');
    assert(!$('#st-swipe-tree-modal'), 'closed');
    return { floors: 6000, candidates: 66000, initial, checks: 25 };
}

test('tree-only real browser: bounded DOM, stable incremental updates, search, overview, structure and lifecycle', { timeout: 60000 }, async () => {
    const candidates = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].filter(Boolean);
    let executable;
    for (const path of candidates) { try { await access(path); executable = path; break; } catch {} }
    assert.ok(executable, 'Set CHROME_PATH to Chrome/Edge');
    const routes = new Map();
    for (const file of ['branch-tree.js', 'native-integration.mjs', 'timeline-preferences.mjs', 'timeline-graph.mjs', 'timeline-virtual.mjs', 'timeline.css', 'style.css'])
        routes.set('/' + file, { body: await readFile(new URL('../' + file, import.meta.url)), type: file.endsWith('.css') ? 'text/css' : 'text/javascript' });
    routes.set('/', { type: 'text/html', body: '<!doctype html><html><head><link rel="icon" href="data:,"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/timeline.css"></head><body></body></html>' });
    const unexpected = [];
    const server = createServer((req, res) => { const route = routes.get(req.url); if (!route) unexpected.push(req.url);
        res.writeHead(route ? 200 : 404, { 'Content-Type': route?.type ?? 'text/plain' }); res.end(route?.body ?? 'not found'); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const profile = await mkdtemp(join(tmpdir(), 'swipe-tree-only-'));
    let browser, socket, nextId = 0; const pending = new Map();
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
        const id = ++nextId; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    try {
        browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking',
            '--disable-component-update', '--disable-sync', '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
            '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
        const url = await new Promise((resolve, reject) => {
            let log = ''; const timer = setTimeout(() => reject(new Error('browser startup timeout')), 15000);
            browser.on('error', reject); browser.stderr.on('data', data => {
                log += data; const match = log.match(/DevTools listening on (ws:\/\/\S+)/);
                if (match) { clearTimeout(timer); resolve(match[1]); }
            });
        });
        socket = new WebSocket(url); await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
        socket.onmessage = event => { const m = JSON.parse(event.data); if (!m.id) return;
            const task = pending.get(m.id); pending.delete(m.id); if (m.error) task?.reject(m.error); else task?.resolve(m.result); };
        const { targetId } = await send('Target.createTarget', { url: `http://127.0.0.1:${server.address().port}/` });
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        for (let n = 0; ; n++) {
            const ready = await send('Runtime.evaluate', { expression: 'location.hostname === "127.0.0.1" && document.readyState === "complete"', returnByValue: true }, sessionId);
            if (ready.result?.value) break;
            if (n >= 200) throw new Error('isolated page navigation timeout');
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        for (const width of [1280, 600, 320]) {
            await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: false }, sessionId);
            const result = await send('Runtime.evaluate', { expression: `(${browserCases.toString()})()`, returnByValue: true, awaitPromise: true }, sessionId);
            assert.equal(result.exceptionDetails, undefined, `width=${width}: ${JSON.stringify(result.exceptionDetails)}`);
            console.log({ width, ...result.result.value });
        }
        assert.deepEqual(unexpected, []);
    } finally {
        socket?.close(); browser?.kill(); server.close();
        await new Promise(resolve => setTimeout(resolve, 350));
        await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
    }
});
