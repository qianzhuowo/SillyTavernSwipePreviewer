// Dual-environment harness: browser exports exercise real UI; Node export drives the
// existing isolated Chrome launcher. No product imports, network APIs or disk I/O
// occur in the browser. Run via mock-integration.mjs --performance, not directly.
const QUERY = 'perfneedle2048';
const BODY_LENGTH = 2048;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const $ = selector => document.querySelector(selector);

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

/** Deterministic data generation is intentionally outside every timed interval. */
export async function preparePerformanceCase(config) {
    await window.mock.reset();
    const chat = Array.from({ length: config.floors }, (_, floor) => {
        const isUser = floor % 2 === 0;
        const count = isUser ? 1 : config.charCandidates;
        const texts = Array.from({ length: count }, (_, candidate) => {
            const prefix = `Synthetic floor ${floor}, candidate ${candidate}. `;
            const suffix = floor % 10 === 9 ? ` ${QUERY}` : ' synthetic end';
            return prefix + 'Isolated timeline performance prose. '.repeat(70)
                .slice(0, BODY_LENGTH - prefix.length - suffix.length) + suffix;
        });
        assert(texts.every(text => text.length === BODY_LENGTH), 'Body length mismatch');
        return { name: isUser ? 'Synthetic User' : 'Synthetic Character', is_user: isUser,
            mes: texts[0], extra: {}, ...(count > 1 ? { swipes: texts, swipe_id: 0 } : {}) };
    });
    window.mock.context.chat = chat;
    // Do not populate a 1000-message host chat DOM: this is isolated extension UI,
    // not a benchmark of SillyTavern's host conversation renderer.
    const longTasks = [];
    const longTasksSupported = PerformanceObserver.supportedEntryTypes.includes('longtask');
    let observer;
    if (longTasksSupported) {
        observer = new PerformanceObserver(list => longTasks.push(...list.getEntries()));
        observer.observe({ type: 'longtask', buffered: false });
    }
    window.timelinePerformance = { config, longTasks, observer, longTasksSupported };
    await document.fonts.ready;
    await frame();
    await frame();
    await pause(100);
    return { floors: config.floors,
        graphNodes: chat.reduce((sum, message) => sum + (message.swipes?.length ?? 1), 0),
        bodyLengthCodeUnits: BODY_LENGTH, query: QUERY,
        userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
        deviceMemoryGiBHint: navigator.deviceMemory ?? null,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        longTasksSupported };
}

function counts() {
    const modal = $('#st-swipe-tree-modal');
    return {
        documentElements: document.querySelectorAll('*').length,
        modalElements: modal?.querySelectorAll('*').length ?? 0,
        graphNodeButtons: document.querySelectorAll('.st-swipe-timeline-node').length,
        graphEdgePaths: document.querySelectorAll('.st-swipe-timeline-edge').length,
        currentEdgePaths: document.querySelectorAll('.st-swipe-timeline-edge-current').length,
        candidateEdgePaths: document.querySelectorAll('.st-swipe-timeline-edge-candidate').length,
        summaryFloorButtons: document.querySelectorAll('.st-swipe-timeline-path-step').length,
        summaryGapButtons: document.querySelectorAll('.st-swipe-timeline-summary-gap').length,
        matchedNodeButtons: document.querySelectorAll('.st-swipe-timeline-node-match').length,
    };
}

function layoutProbe() {
    const viewport = $('.st-swipe-timeline-viewport');
    const stage = $('.st-swipe-timeline-stage');
    const last = document.querySelector('.st-swipe-timeline-node:last-child');
    assert(viewport && stage && last, 'Missing final graph layout');
    const rect = stage.getBoundingClientRect();
    const lastRect = last.getBoundingClientRect();
    assert(viewport.clientWidth > 0 && viewport.clientHeight > 0 && lastRect.height > 0,
        'Graph layout has zero dimensions');
    return { viewportWidth: viewport.clientWidth, viewportHeight: viewport.clientHeight,
        stageWidth: rect.width, stageHeight: rect.height,
        scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop };
}

/** Each operation is measured entirely on the browser performance.now() clock.
 * DOM .click()/input events invoke product UI handlers (not a model benchmark).
 * The timer excludes CDP round trips, synthetic setup, heap sampling and panel setup.
 */
export async function measurePerformanceOperation(operation) {
    const state = window.timelinePerformance;
    const { floors, charCandidates } = state.config;
    const allNodes = floors / 2 * (1 + charCandidates);
    let expectedNodes = allNodes;
    let expectedStatus;
    let expectedMatches = 0;
    let action;
    if (operation === 'open') {
        expectedStatus = `显示 ${floors} / ${floors} 个楼层 + ${allNodes - floors} 个旁支。`;
        action = () => $('#st-swipe-tree-entry').click();
    } else if (operation === 'trunk' || operation === 'restoreAll') {
        if ($('.st-swipe-timeline-controls').hidden) $('.st-swipe-timeline-tools-toggle').click();
        expectedNodes = operation === 'trunk' ? floors : allNodes;
        expectedStatus = operation === 'trunk' ? `显示 ${floors} / ${floors} 个楼层（旁支已隐藏）。`
            : `显示 ${floors} / ${floors} 个楼层 + ${allNodes - floors} 个旁支。`;
        action = () => $('.st-swipe-timeline-toggle-candidates').click();
    } else if (operation === 'search') {
        if ($('.st-swipe-timeline-toolbar').hidden) $('.st-swipe-timeline-search-toggle').click();
        expectedMatches = floors / 10 * charCandidates;
        expectedStatus = `匹配 ${expectedMatches} 个可见节点；搜索不会隐藏楼层。`;
        action = () => {
            const input = $('.st-swipe-timeline-search');
            input.value = QUERY;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        };
    } else throw new Error(`Unknown operation: ${operation}`);
    // Let UI panel setup and previous sampling settle before starting the timer.
    await frame();
    await frame();
    await pause(100);
    const startedAt = performance.now();
    action();
    let readyAt;
    for (;;) {
        assert(performance.now() - startedAt < 60000, `${operation} did not finish: ${$('.st-swipe-tree-status')?.textContent}`);
        assert(!window.mock.errors.length, `Product browser errors: ${window.mock.errors.join('; ')}`);
        if ($('.st-swipe-tree-status')?.textContent === expectedStatus) {
            // Whole-chat totals come from completed status, while DOM is intentionally
            // bounded. Require the actual focused/first-match target to be mounted.
            const actualNodes = document.querySelectorAll('.st-swipe-timeline-node').length;
            const actualEdges = document.querySelectorAll('.st-swipe-timeline-edge').length;
            const target = operation === 'search' ? $('.st-swipe-timeline-node-match-active') : $('.st-swipe-timeline-node-selected');
            if (actualNodes > 0 && actualNodes <= Math.min(expectedNodes, 200) && actualEdges > 0 && actualEdges <= 200
                && target
                && (operation !== 'search' || (target.dataset.nodeId === '9:0'
                    && $('.st-swipe-timeline-match-count').textContent === `1 / ${expectedMatches}`))) {
                readyAt = performance.now();
                break;
            }
        }
        await frame();
    }
    layoutProbe(); // Force pending style/layout after DOM readiness.
    await frame();
    await frame(); // At least one intervening rendering/paint opportunity; not GPU fence/physical presentation.
    const geometry = layoutProbe();
    const endedAt = performance.now();
    const dom = counts(); // Count bookkeeping is outside reported duration.
    assert(dom.matchedNodeButtons <= expectedMatches, 'Mounted matches exceed global matches');
    if (operation === 'search') {
        assert(dom.matchedNodeButtons > 0, 'First search match not mounted');
        for (const node of document.querySelectorAll('.st-swipe-timeline-node-match')) {
            const message = mock.context.chat[Number(node.dataset.mesId)];
            assert((message.swipes?.[Number(node.dataset.swipeIdx)] ?? message.mes).includes(QUERY), 'False positive mounted search match');
        }
    } else assert(dom.matchedNodeButtons === 0, 'Empty search has highlights');
    if (operation === 'trunk') assert(dom.candidateEdgePaths === 0 && !$('.st-swipe-timeline-node-candidate'), 'Trunk hides candidate edges and nodes');
    await pause(0); // Deliver observer records generated by the timed interval.
    if (state.observer) state.longTasks.push(...state.observer.takeRecords());
    const tasks = state.longTasks.filter(entry => entry.startTime < endedAt && entry.startTime + entry.duration > startedAt);
    const longTasks = state.longTasksSupported ? {
        count: tasks.length,
        maxTaskDurationMs: Math.max(0, ...tasks.map(entry => entry.duration)),
        totalOverlapMs: tasks.reduce((sum, entry) => sum
            + Math.min(endedAt, entry.startTime + entry.duration) - Math.max(startedAt, entry.startTime), 0),
        entries: tasks.map(entry => ({ startTime: entry.startTime, duration: entry.duration, name: entry.name })),
    } : null;
    return { operation, startedAt, endedAt, durationMs: endedAt - startedAt,
        domReadyMs: readyAt - startedAt, layoutAndPaintOpportunityMs: endedAt - readyAt,
        status: expectedStatus, dom, geometry, longTasks };
}

/** Node-only orchestration, using the caller's existing safe server and Chrome. */
export async function runPerformanceSuite({ send, origin, snapshots, artifacts, executable, root, unexpectedRequests }) {
    const os = await import('node:os');
    const { readFile, writeFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const { createHash } = await import('node:crypto');
    const repeatsArg = process.argv.find(arg => arg.startsWith('--performance-repeats='));
    const repeats = repeatsArg ? Number(repeatsArg.split('=')[1]) : 3;
    assert(Number.isInteger(repeats) && repeats >= 2 && repeats <= 10, 'Performance repeats must be 2..10');
    const scenarios = [100, 500, 1000].map(floors => ({ id: `${floors}-user1-char1`, floors, charCandidates: 1 }));
    scenarios.push({ id: '1000-user1-char5', floors: 1000, charCandidates: 5 });
    if (process.argv.includes('--performance-stress')) scenarios.push(
        { id: '1000-user1-char10', floors: 1000, charCandidates: 10 },
        { id: '6000-user1-char21', floors: 6000, charCandidates: 21 });
    const viewports = [{ width: 1280, height: 800 }];
    if (process.argv.includes('--performance-narrow')) viewports.push({ width: 600, height: 800 }, { width: 320, height: 800 });
    const cpus = os.cpus();
    const harnessHashes = {};
    for (const file of ['tests/mock-integration.mjs', 'tests/mock-host.mjs', 'tests/timeline-performance.mjs']) {
        harnessHashes[file] = createHash('sha256').update(await readFile(join(root, file))).digest('hex');
    }
    const report = {
        schemaVersion: 1, startedAt: new Date().toISOString(), completedAt: null,
        command: ['node', ...process.argv.slice(1)], snapshots, harnessHashes,
        environment: { node: process.version, osType: os.type(), osRelease: os.release(), osVersion: os.version(),
            architecture: os.arch(), cpuModel: cpus[0]?.model, logicalCpus: cpus.length,
            totalHostMemoryBytes: os.totalmem(), freeHostMemoryAtStartBytes: os.freemem(),
            browser: await send('Browser.getVersion'), executable,
            headless: true, disableGpu: true, cpuThrottlingRate: 1, networkThrottling: false,
            viewportDeviceScaleFactor: 1, mobileEmulation: false },
        methodology: {
            repeats, freshPagePerSample: true, sharedBrowserProcess: true, bodyLengthCodeUnits: BODY_LENGTH,
            sequence: ['open', 'trunk', 'restoreAll', 'search'],
            timing: 'Browser performance.now from DOM click/input dispatch to expected final whole-chat status, bounded mounted nodes/edges, selected node, search count; forced style/layout, two requestAnimationFrame callbacks and final geometry read. Includes rendering/paint opportunity, not proof of physical presentation.',
            open: 'First tree open in a fresh document: includes lazy tree module import, graph construction, virtual node/edge window, summary window, focus, empty search, layout and paint opportunity. Host/plugin startup, style.css and its timeline.css import finish before setup; these and synthetic data generation are excluded. Browser process/OS caches may be warm.',
            search: `All candidates restored before search; ${QUERY} occurs near the end of every candidate on floor 9,19,...; includes the real 180ms input debounce, full graph text scan, highlights and navigation.`,
            longTasks: 'PerformanceObserver longtask entries overlapping the measured interval: >=50ms main-thread tasks only. totalOverlapMs is interval-clipped; maxTaskDurationMs is the full overlapping task duration. Not FPS or a complete responsiveness trace.',
            heap: 'CDP Runtime.getHeapUsage after each operation, no forced GC. JS isolate heap only; neither retained graph size nor renderer/browser/process total memory. Host RAM is machine capacity, not plugin usage.',
            dom: 'Mounted virtual-window element counts (not text/comment DOM nodes), not whole-chat candidate totals; graphEdgePaths excludes the SVG arrow marker path and candidate paths may batch multiple curves. modalElements excludes modal root.',
            isolation: 'Ephemeral allowlisted localhost snapshots; in-memory mock chat/save/bookmark APIs; no real server or chat; existing launcher --disable-gpu and DNS restriction retained. No CPU slowdown or claim to mobile hardware.',
        }, scenarios, viewports, samples: [], summary: [], unexpectedRequests,
    };
    const output = join(artifacts, 'timeline-performance.json');
    try {
        // Repeat-major order reduces bias from measuring all repeats of one size first.
        for (let repeat = 1; repeat <= repeats; repeat++) {
            for (const viewport of viewports) {
                for (const scenario of scenarios) {
                    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
                    try {
                        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
                        const evaluate = async expression => {
                            const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
                            if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
                            return result.result.value;
                        };
                        await send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false }, sessionId);
                        await send('Emulation.setCPUThrottlingRate', { rate: 1 }, sessionId);
                        await send('Page.bringToFront', {}, sessionId);
                        await send('Page.navigate', { url: origin }, sessionId);
                        const readyDeadline = Date.now() + 15000;
                        while (!await evaluate('document.readyState === "complete" && !!document.querySelector("#chat .st-swipe-previewer-button") && !!document.querySelector("#st-swipe-tree-entry")')) {
                            assert(Date.now() < readyDeadline, 'Mock tree entry readiness timeout');
                            await pause(25);
                        }
                        const setup = await evaluate(`import('/tests/timeline-performance.mjs').then(m => m.preparePerformanceCase(${JSON.stringify(scenario)}))`);
                        const sample = { scenario: scenario.id, repeat, viewport, setup,
                            heapBeforeOpen: await send('Runtime.getHeapUsage', {}, sessionId), operations: [] };
                        report.samples.push(sample);
                        for (const operation of report.methodology.sequence) {
                            const measured = await evaluate(`import('/tests/timeline-performance.mjs').then(m => m.measurePerformanceOperation(${JSON.stringify(operation)}))`);
                            measured.heapAfter = await send('Runtime.getHeapUsage', {}, sessionId);
                            sample.operations.push(measured);
                        }
                        sample.mockSafety = await evaluate('({ stats: mock.stats, errors: mock.errors, notifications: mock.notifications })');
                        assert(sample.mockSafety.stats.saves === 0 && sample.mockSafety.stats.branches === 0
                            && sample.mockSafety.stats.opens === 0 && sample.mockSafety.errors.length === 0, 'Unexpected mock side effect or browser error');
                        console.log(`PERF ${scenario.id} ${viewport.width}px repeat=${repeat} ${sample.operations.map(op => `${op.operation}=${op.durationMs.toFixed(1)}ms`).join(' ')} nodes=${setup.graphNodes}`);
                        await writeFile(output, JSON.stringify(report, null, 2) + '\n');
                    } finally {
                        await send('Target.closeTarget', { targetId });
                    }
                }
            }
        }
        const distribution = values => {
            const sorted = [...values].sort((a, b) => a - b);
            const mid = Math.floor(sorted.length / 2);
            return { min: sorted[0], median: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2, max: sorted.at(-1) };
        };
        for (const viewport of viewports) for (const scenario of scenarios) {
            const samples = report.samples.filter(s => s.scenario === scenario.id && s.viewport.width === viewport.width);
            report.summary.push({ scenario: scenario.id, viewport, repeats: samples.length,
                operations: report.methodology.sequence.map(operation => {
                    const ops = samples.map(s => s.operations.find(op => op.operation === operation));
                    return { operation, durationMs: distribution(ops.map(op => op.durationMs)),
                        domReadyMs: distribution(ops.map(op => op.domReadyMs)), dom: ops[0].dom,
                        domCountsConsistent: ops.every(op => JSON.stringify(op.dom) === JSON.stringify(ops[0].dom)),
                        longTaskCount: distribution(ops.map(op => op.longTasks?.count ?? 0)),
                        longestTaskMs: distribution(ops.map(op => op.longTasks?.maxTaskDurationMs ?? 0)),
                        heapUsedBytes: distribution(ops.map(op => op.heapAfter.usedSize)) };
                }) });
        }
        assert(unexpectedRequests.length === 0, 'Unexpected localhost requests');
        report.sourceFilesUnchangedAtEnd = {};
        for (const [file, digest] of Object.entries(snapshots)) {
            report.sourceFilesUnchangedAtEnd[file] = createHash('sha256')
                .update(await readFile(join(root, file), 'utf8')).digest('hex') === digest;
        }
        report.completedAt = new Date().toISOString();
        console.log(`PERFORMANCE RESULT ${report.samples.length} samples; ${output}`);
    } catch (error) {
        report.failure = error.stack ?? String(error);
        throw error;
    } finally {
        await writeFile(output, JSON.stringify(report, null, 2) + '\n');
    }
}
