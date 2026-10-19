// Node-side real pointer/touch/keyboard tests for the header help, using the isolated host.
export async function runHelpBrowserCases({ evaluate, send, sessionId, screenshot }) {
    const results = [];
    const help = '.st-swipe-timeline-help-panel';
    const toggle = '.st-swipe-timeline-help-toggle';
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const check = async (expression, label) => { if (!await evaluate(expression)) throw new Error(label); };
    const wait = async (expression, label) => {
        for (let n = 0; n < 150; n++) { if (await evaluate(expression)) return; await pause(20); }
        throw new Error('Timeout: ' + label);
    };
    const center = selector => evaluate(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return {x:b.left+b.width/2, y:b.top+b.height/2}; })()`);
    const move = async point => send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point }, sessionId);
    const click = async point => {
        await move(point);
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 }, sessionId);
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 }, sessionId);
    };
    const tap = async point => {
        await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] }, sessionId);
        await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId);
    };
    const key = async value => {
        for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', {
            type, key: value, code: value === ' ' ? 'Space' : value,
            windowsVirtualKeyCode: { Enter: 13, ' ': 32, Escape: 27 }[value],
            ...(type === 'keyDown' && value === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}),
        }, sessionId);
    };
    const open = async () => {
        await evaluate(`mock.openOptions(); document.querySelector('#st-swipe-tree-entry').click()`);
        await wait(`!!document.querySelector('.st-swipe-timeline-node-selected')`, 'tree ready');
        await evaluate(`window.helpHeaderHeight = document.querySelector('.st-swipe-timeline-header').getBoundingClientRect().height`);
    };
    const bounds = async () => {
        await check(`(() => {
            const p = document.querySelector('${help}'), b = p.getBoundingClientRect();
            return !p.hidden && b.width > 0 && b.left >= 11 && b.right <= innerWidth - 11
                && b.top >= 11 && b.bottom <= innerHeight - 11
                && p.scrollWidth <= p.clientWidth + 1
                && Math.abs(document.querySelector('.st-swipe-timeline-header').getBoundingClientRect().height - helpHeaderHeight) < 1;
        })()`, 'help fits viewport without overflow or changing header height');
        await check(`(() => {
            const p = document.querySelector('${help}'), b = p.getBoundingClientRect();
            return p.contains(document.elementFromPoint(b.left + b.width/2, b.bottom - 8));
        })()`, 'help text is not clipped or covered by the header/canvas');
    };
    const test = async (name, run) => {
        await evaluate('mock.reset()');
        try {
            await run();
            await check('mock.errors.length === 0 && mock.stats.saves === 0', 'no uncaught errors or chat saves');
            results.push({ name, status: 'passed' });
        } catch (error) { results.push({ name, status: 'failed', error: error.message }); }
    };
    await send('Page.bringToFront', {}, sessionId);
    for (const width of [1280, 600, 320]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 640, deviceScaleFactor: 1, mobile: false }, sessionId);
        await test(`title help starts hidden and real mouse hover remains readable at ${width}px`, async () => {
            await move({ x: 2, y: 2 }); await open();
            await check(`(() => {
                const p = document.querySelector('${help}'), t = document.querySelector('${toggle}');
                const title = document.querySelector('.st-swipe-timeline-header .st-swipe-title');
                const a = title.getBoundingClientRect(), b = t.getBoundingClientRect();
                return p.hidden && getComputedStyle(p).display === 'none'
                    && t.getAttribute('aria-expanded') === 'false' && t.getAttribute('aria-controls') === p.id
                    && t.getAttribute('aria-describedby') === p.id && !!t.querySelector('.fa-circle-exclamation')
                    && title.nextElementSibling === t && b.left >= a.right && b.left - a.right < 10
                    && Math.abs(a.top+a.height/2-b.top-b.height/2) < 2
                    && !document.querySelector('.st-swipe-timeline-header').contains(p)
                    && p.querySelector('.st-swipe-timeline-path-label').textContent === '实线箭头：当前选择路径'
                    && p.querySelector('.st-swipe-timeline-candidate-label').textContent === '虚线：同层候选归属 / 续接未知（不与下一层相连）'
                    && p.querySelector('.st-swipe-timeline-hint').textContent === '楼层 # 从 0 开始。点击节点看详情；双击预览，不会切换 swipe。滚动查看，Ctrl/⌘+滚轮缩放，拖动空白平移。'
                    && !document.querySelector('.st-swipe-timeline-header > .st-swipe-timeline-legend, .st-swipe-timeline-header > .st-swipe-timeline-hint');
            })()`, 'icon sits right of title; original tips moved out of the header unchanged');
            await move(await center(toggle));
            await wait(`!document.querySelector('${help}').hidden`, 'mouse hover opens help');
            await bounds();
            await move(await center(help)); await pause(200);
            await check(`!document.querySelector('${help}').hidden`, 'pointer can enter and read the help');
            await move({ x: 2, y: 638 });
            await wait(`document.querySelector('${help}').hidden`, 'leaving closes unpinned help');
            await click(await center(toggle)); // Pointer-enter opens it, click pins it.
            await move({ x: 2, y: 638 }); await pause(200);
            await check(`!document.querySelector('${help}').hidden`, 'click pins help beyond hover');
            await click(await center(toggle));
            await check(`document.querySelector('${help}').hidden`, 'second click closes pinned help');
        });
        await test(`touch tap toggles title help and outside tap closes only help at ${width}px`, async () => {
            await move({ x: 2, y: 2 }); await open();
            await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 }, sessionId);
            try {
                const point = await center(toggle);
                await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] }, sessionId);
                await check(`document.querySelector('${help}').hidden`, 'touch pointerenter does not open before click');
                await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }, sessionId);
                await wait(`!document.querySelector('${help}').hidden`, 'first tap opens help');
                await bounds();
                await screenshot?.(`timeline-help-${width}-touch-open`);
                await tap(point);
                await wait(`document.querySelector('${help}').hidden`, 'second tap closes help');
                await tap(point); await wait(`!document.querySelector('${help}').hidden`, 'tap reopens');
                await tap({ x: 2, y: 2 });
                await check(`!!document.querySelector('#st-swipe-tree-modal') && document.querySelector('${help}').hidden`, 'outside tap dismisses help without closing tree');
                await tap(point); await wait(`!document.querySelector('${help}').hidden`, 'help before resize');
                const nextWidth = width === 320 ? 600 : 320;
                await send('Emulation.setDeviceMetricsOverride', { width: nextWidth, height: 640, deviceScaleFactor: 1, mobile: false }, sessionId);
                await pause(120);
                // Resizing may scroll the header to retain focused controls, dismissing the help.
                if (await evaluate(`document.querySelector('${help}').hidden`)) await tap(await center(toggle));
                await evaluate(`helpHeaderHeight = document.querySelector('.st-swipe-timeline-header').getBoundingClientRect().height`);
                await bounds();
            } finally {
                // A normal tap has already sent touchEnd. Cancel only for failure cleanup;
                // Chrome rejects a second touchEnd when no touch sequence is active.
                await send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }, sessionId).catch(() => {});
                await send('Emulation.setTouchEmulationEnabled', { enabled: false }, sessionId);
                await send('Emulation.setDeviceMetricsOverride', { width, height: 640, deviceScaleFactor: 1, mobile: false }, sessionId);
            }
        });
        await test(`title help keyboard toggles once and Escape dismisses only help at ${width}px`, async () => {
            await move({ x: 2, y: 2 }); await open();
            await evaluate(`document.querySelector('${toggle}').focus(); window.helpClicks = 0; document.querySelector('${toggle}').addEventListener('click', () => helpClicks++)`);
            await key('Enter');
            await check(`helpClicks === 1 && !document.querySelector('${help}').hidden`, 'Enter opens once beside native host keyboard handler');
            await evaluate(`document.querySelector('${help}').focus()`);
            await key('Escape');
            await check(`!!document.querySelector('#st-swipe-tree-modal') && document.querySelector('${help}').hidden
                && document.activeElement.matches('${toggle}')`, 'Escape closes help and restores its icon focus');
            await key(' ');
            await check(`helpClicks === 2 && !document.querySelector('${help}').hidden`, 'Space opens once');
            await key(' ');
            await check(`helpClicks === 3 && document.querySelector('${help}').hidden`, 'Space closes once');
            await key('Escape');
            await check(`!document.querySelector('#st-swipe-tree-modal')`, 'Escape with hidden help dismisses tree normally');
        });
    }
    await test('title help stays scrollable inside a short mobile viewport', async () => {
        await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 140, deviceScaleFactor: 1, mobile: false }, sessionId);
        try {
            await move({ x: 2, y: 2 }); await open();
            await evaluate(`document.querySelector('${toggle}').focus()`);
            await key('Enter');
            await wait(`!document.querySelector('${help}').hidden`, 'short viewport help');
            await bounds();
            await check(`document.querySelector('${help}').scrollHeight > document.querySelector('${help}').clientHeight`, 'long help content remains scrollable');
            await evaluate(`document.querySelector('${help}').focus(); document.querySelector('${help}').scrollTop = 1000`);
            await check(`document.querySelector('${help}').scrollTop > 0`, 'help can scroll without moving clipped header');
            await key('Escape');
            await check(`!!document.querySelector('#st-swipe-tree-modal') && document.querySelector('${help}').hidden`, 'short viewport Escape closes help only');
        } finally {
            await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 1, mobile: false }, sessionId);
        }
    });
    await test('closing tree cancels a pending hover dismissal without orphan help or listeners', async () => {
        const baseline = await evaluate('mock.listenerCounts()');
        await move({ x: 2, y: 2 }); await open();
        await move(await center(toggle)); await wait(`!document.querySelector('${help}').hidden`, 'hover before removal');
        await move({ x: 2, y: 638 });
        await evaluate(`document.querySelector('#st-swipe-tree-modal').remove()`);
        await pause(220);
        await check(`!document.querySelector('${help}') && JSON.stringify(mock.listenerCounts()) === ${JSON.stringify(JSON.stringify(baseline))}`, 'external tree removal cleans help and scoped lifecycle');
        await open();
        await check(`document.querySelector('${help}').hidden`, 'new tree does not inherit help open state');
    });
    await evaluate('mock.reset()');
    return results;
}
