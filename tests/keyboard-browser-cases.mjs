// Node-side CDP keyboard regression against the isolated mock host, not a live chat.
export async function runKeyboardBrowserCases({ evaluate, send, sessionId, selectionOnly = false }) {
    const results = [];
    const key = async (key, modifiers = 0, repeat = false) => {
        const codes = { Enter: 13, ' ': 32, Tab: 9, Escape: 27 };
        for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', {
            type, key, code: key === ' ' ? 'Space' : key, windowsVirtualKeyCode: codes[key], modifiers,
            ...(type === 'keyDown' ? { autoRepeat: repeat,
                // Chrome's printable/default Enter action requires its character payload.
                // Without this, a test exercises keydown listeners but misses button default
                // clicks and textarea newlines, masking the exact host duplication bug.
                ...(key === 'Enter' && !modifiers ? { text: '\r', unmodifiedText: '\r' } : {}),
            } : {}),
        }, sessionId);
    };
    const check = async (expression, label) => {
        if (!await evaluate(expression)) throw new Error(label);
    };
    const wait = async (expression, label) => {
        for (let n = 0; n < 150; n++) {
            if (await evaluate(expression)) return;
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        throw new Error('Timeout: ' + label);
    };
    const focus = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    const preview = '#st-swipe-preview-modal';
    const source = '#chat .mes[mesid="0"] .st-swipe-previewer-button';
    const open = async () => {
        await focus(source);
        await key('Enter');
        await wait(`document.querySelectorAll('.st-swipe-card').length === 5`, 'open preview');
    };
    const assertScope = async selector => {
        await evaluate(`(() => {
            const root = document.querySelector(${JSON.stringify(selector)});
            const all = [...root.querySelectorAll('button, input, select, textarea, a[href], iframe, [tabindex]')]
                .filter(el => el.tabIndex >= 0 && !el.matches(':disabled, [aria-disabled="true"]')
                    && !el.closest('[hidden], [inert]') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
            window.keyboardFirst = all[0]; window.keyboardLast = all.at(-1);
            keyboardLast.focus();
        })()`);
        await key('Tab');
        await check('document.activeElement === keyboardFirst', 'Tab wraps to first visible control');
        await key('Tab', 8);
        await check('document.activeElement === keyboardLast', 'Shift+Tab wraps to last visible control');
        // An external extension trying to focus the chat must be redirected into the top scope.
        await focus(source);
        await check(`document.querySelector(${JSON.stringify(selector)}).contains(document.activeElement)`, 'focus cannot land behind overlay');
    };
    const test = async (name, action) => {
        try {
            await evaluate("document.querySelector('#keyboard-dialog')?.remove(); mock.reset()");
            await action();
            await check('mock.errors.length === 0', 'no uncaught browser errors');
            results.push({ name, status: 'passed' });
        } catch (error) { results.push({ name, status: 'failed', error: error.message }); }
    };
    await send('Page.bringToFront', {}, sessionId);
    await test('keyboard fixture reproduces host Enter plus browser default double click', async () => {
        await evaluate(`(() => {
            const probe = document.createElement('button'); probe.className = 'menu_button'; probe.id = 'keyboard-probe';
            window.keyboardProbeClicks = 0; probe.onclick = () => keyboardProbeClicks++;
            document.body.append(probe); probe.focus();
        })()`);
        try { await key('Enter'); await check('keyboardProbeClicks === 2', 'fixture must expose duplicate native click'); }
        finally { await evaluate("document.querySelector('#keyboard-probe')?.remove()"); }
    });
    for (const width of [1280, 600, 320]) {
        await send('Emulation.setDeviceMetricsOverride', { width, height: 640, deviceScaleFactor: 1, mobile: false }, sessionId);
        await test(`real preview Enter/Space, repeat/IME guards, focus entry and Tab scope at ${width}px`, async () => {
            await open();
            await check(`document.activeElement.id === 'st-swipe-preview-modal-close'`, 'preview receives initial focus');
            await assertScope(preview);
            await focus(preview + '-delete-mode');
            await key('Enter');
            await check(`document.querySelector('${preview}-delete-mode').getAttribute('aria-pressed') === 'true'`, 'Enter toggles once');
            await key('Enter', 0, true);
            await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', isComposing:true, bubbles:true, cancelable:true }))`);
            await check(`document.querySelector('${preview}-delete-mode').getAttribute('aria-pressed') === 'true'`, 'repeat/IME do not toggle or bubble to host');
            await focus('.st-swipe-jump-item[data-idx="2"]');
            await key(' ');
            await check(`document.activeElement.getAttribute('aria-pressed') === 'true'`, 'Space selects once');
            await key('Enter');
            await check(`document.activeElement.getAttribute('aria-pressed') === 'false'`, 'Enter deselects once');
            await key('Escape');
            await check(`document.activeElement.id === 'st-swipe-preview-modal-delete-mode' && document.querySelector('.st-swipe-selection-toolbar').hidden`, 'Escape exits selection only');
            await focus(preview + '-next');
            await evaluate('window.keyboardClicks = 0; document.activeElement.addEventListener("click", () => keyboardClicks++)');
            await key('Enter'); await check('keyboardClicks === 1', 'div header control activates only once');
            await key('Escape');
            await wait(`!document.querySelector('${preview}') && document.activeElement.matches(${JSON.stringify(source)})`, 'dismissal returns to source');
            await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', isComposing:true, bubbles:true, cancelable:true }))`);
            await key('Enter', 0, true);
            await check(`!document.querySelector('${preview}')`, 'message entry ignores IME and repeat');
            await key(' ');
            await wait(`document.querySelectorAll('.st-swipe-card').length === 5`, 'Space message entry');
            await check('mock.stats.saves === 0', 'keyboard browsing is read only');
        });
        await test(`real settings/editor nested scope and Escape focus return at ${width}px`, async () => {
            await open();
            await focus(preview + '-settings'); await key('Enter');
            const settings = '#st-swipe-previewer-settings-modal';
            await wait(`document.activeElement.id === 'st-swipe-previewer-settings-modal-close'`, 'settings receives focus');
            await assertScope(settings); await key('Escape');
            await wait(`!document.querySelector('${settings}') && document.activeElement.id === 'st-swipe-preview-modal-settings'`, 'settings returns to parent control');
            await focus('.st-swipe-card[data-idx="2"] .st-swipe-action-edit'); await key('Enter');
            await wait(`document.activeElement.tagName === 'TEXTAREA'`, 'editor receives focus');
            await assertScope('[id^="st-swipe-preview-modal-edit-"][role="dialog"]');
            await focus('.st-swipe-edit-textarea');
            const oldText = await evaluate('document.activeElement.value');
            await key('Enter');
            await check(`document.activeElement.value === ${JSON.stringify(oldText + '\n')}`, 'plain Enter remains textarea newline');
            await evaluate(`document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', ctrlKey:true, isComposing:true, bubbles:true, cancelable:true }))`);
            await check(`!!document.querySelector('[id^="st-swipe-preview-modal-edit-"][role="dialog"]') && mock.stats.saves === 0`, 'IME Ctrl+Enter cannot save');
            await key('Escape');
            await wait(`!document.querySelector('[id^="st-swipe-preview-modal-edit-"][role="dialog"]') && document.activeElement.matches('.st-swipe-card[data-idx="2"] .st-swipe-action-edit')`, 'editor returns to originating card');
            await check('mock.stats.saves === 0', 'cancel editing does not save');
            await key('Enter');
            await wait(`document.activeElement.tagName === 'TEXTAREA'`, 'reopen editor');
            await send('Input.insertText', { text: ' keyboard edit' }, sessionId);
            await key('Enter', 2);
            await wait(`mock.stats.saves === 1 && !document.querySelector('[id^="st-swipe-preview-modal-edit-"][role="dialog"]')`, 'Ctrl+Enter saves exactly once');
            await check(`mock.context.chat[0].mes.endsWith(' keyboard edit')`, 'keyboard save updates native message');
            await wait(`document.activeElement.matches('.st-swipe-card[data-idx="2"] .st-swipe-action-edit')`, 'save returns focus to the replacement card');
        });
        if (!selectionOnly) await test(`real tree Enter deduplication, virtual focus scope and parent return at ${width}px`, async () => {
            await open();
            await focus(preview + '-tree'); await key('Enter');
            await wait(`!!document.querySelector('.st-swipe-timeline-node')`, 'tree ready');
            await check(`document.querySelector('${preview}').hidden && document.activeElement.matches('.st-swipe-tree-close')`, 'tree owns focus over hidden preview');
            await assertScope('#st-swipe-tree-modal');
            await focus('.st-swipe-timeline-tools-toggle'); await key('Enter');
            await check(`!document.querySelector('.st-swipe-timeline-controls').hidden`, 'tree tools toggle only once');
            await focus('.st-swipe-timeline-search-toggle'); await key('Enter');
            await check(`document.activeElement.matches('.st-swipe-tree-search')`, 'search toggle activates once and focuses input');
            await key('Escape');
            await wait(`!document.querySelector('#st-swipe-tree-modal') && !document.querySelector('${preview}').hidden && document.activeElement.id === 'st-swipe-preview-modal-tree'`, 'tree returns to the same preview control');
            await key('Escape');
            await wait(`document.activeElement.matches(${JSON.stringify(source)})`, 'preview returns to chat control');
        });
    }
    await test('native dialog yields focus and Escape, chat switch and external removal clean listeners', async () => {
        const baseline = await evaluate('mock.listenerCounts()');
        await open();
        await evaluate(`(() => { const dialog = document.createElement('dialog'); dialog.id = 'keyboard-dialog';
            dialog.innerHTML = '<button>Native first action</button><button id="keyboard-dialog-last">Native last action</button>'; document.body.append(dialog); dialog.showModal(); dialog.querySelector('button').focus(); })()`);
        await key('Tab');
        await check(`document.activeElement.id === 'keyboard-dialog-last'`, 'plugin must yield Tab to native dialog');
        await key('Escape');
        await wait(`!document.querySelector('#keyboard-dialog').open`, 'native Escape closes its own dialog');
        await check(`!!document.querySelector('${preview}')`, 'native Escape must not dismiss preview');
        await evaluate(`document.querySelector('#keyboard-dialog').remove()`);
        await wait(`document.querySelector('${preview}').contains(document.activeElement)`, 'preview reclaims focus after native dialog');
        await evaluate('mock.switchChat()');
        await wait(`!document.querySelector('${preview}')`, 'chat switch dismisses preview');
        await check(`!document.activeElement.matches(${JSON.stringify(source)})`, 'chat switch does not restore stale source');
        await evaluate('mock.reset()'); await open();
        await evaluate(`document.querySelector('${preview}').remove()`);
        await wait(`JSON.stringify(mock.listenerCounts()) === ${JSON.stringify(JSON.stringify(baseline))}`, 'external removal releases keyboard/focus/event listeners');
    });
    if (!selectionOnly) await test('native chat menu Enter and Space each activate once and close the host menu', async () => {
        await check(`!document.querySelector('#extensions_settings2 #st-swipe-tree-entry')
            && document.querySelector('#st-swipe-tree-entry').previousElementSibling.id === 'option_select_chat'`, 'entry migrated to native position');
        await evaluate(`window.keyboardClicks = 0; document.querySelector('#st-swipe-tree-entry').addEventListener('click', () => keyboardClicks++)`);
        for (const [index, input] of ['Enter', ' '].entries()) {
            await evaluate('mock.openOptions()');
            await focus('#st-swipe-tree-entry'); await key(input);
            await wait(`!!document.querySelector('.st-swipe-timeline-node')`, 'native menu tree entry');
            await check(`keyboardClicks === ${index + 1} && getComputedStyle(document.querySelector('#options')).display === 'none'`, 'one activation closes menu');
            await evaluate('mock.reset()');
        }
    });
    if (!selectionOnly) await test('tree display preferences survive an actual page reload', async () => {
        await evaluate('mock.openOptions()'); await focus('#st-swipe-tree-entry'); await key('Enter');
        await wait(`!!document.querySelector('.st-swipe-timeline-node-selected')`, 'tree ready for saved settings');
        await focus('.st-swipe-timeline-tools-toggle'); await key('Enter');
        for (const selector of ['.st-swipe-timeline-only-branches', '.st-swipe-timeline-only-char', '.st-swipe-timeline-toggle-candidates']) {
            await focus(selector); await key('Enter');
        }
        await evaluate(`document.querySelector('.st-swipe-timeline-viewport').dispatchEvent(new WheelEvent('wheel', { ctrlKey:true, deltaY:-1, cancelable:true })); window.beforePreferenceReload = true;`);
        await wait(`document.querySelector('.st-swipe-timeline-zoom-label').textContent === '110%'`, 'chosen zoom');
        await send('Page.reload', {}, sessionId);
        await wait(`window.beforePreferenceReload === undefined && document.readyState === 'complete'
            && !!document.querySelector('#options .options-content #st-swipe-tree-entry')`, 'new document and plugin ready');
        await evaluate('mock.openOptions()'); await focus('#st-swipe-tree-entry'); await key('Enter');
        await wait(`!!document.querySelector('.st-swipe-timeline-node-selected')`, 'reopened after reload');
        await check(`document.querySelector('.st-swipe-timeline-stage').style.transform === 'scale(1.1)'
            && document.querySelector('.st-swipe-timeline-zoom-label').textContent === '110%'
            && document.querySelector('.st-swipe-timeline-only-branches').getAttribute('aria-pressed') === 'true'
            && document.querySelector('.st-swipe-timeline-only-char').getAttribute('aria-pressed') === 'true'
            && document.querySelector('.st-swipe-timeline-toggle-candidates').textContent === '主干'
            && !document.querySelector('.st-swipe-timeline-controls').hidden
            && document.querySelectorAll('.st-swipe-timeline-node').length === 1`, 'reload restores controls and actual graph layout');
        await check('mock.stats.saves === 0', 'preference persistence never saves chat');
    });
    await evaluate('mock.reset()');
    return results;
}
