// Runs against real plugin modules in the isolated mock page.
import { collectTimeline, revealTimeline, settleTimeline } from './timeline-test-helpers.mjs';
export async function runIntegrationCases({ selectionOnly = false } = {}) {
    const results = [];
    const $ = selector => document.querySelector(selector);
    const all = selector => [...document.querySelectorAll(selector)];
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    function assert(value, message) { if (!value) throw new Error(message); }
    function equal(actual, expected, message) {
        assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
    }
    async function waitFor(predicate, label) {
        const until = performance.now() + 4000;
        while (!predicate()) {
            if (performance.now() > until) throw new Error(`Timed out: ${label}`);
            await pause(20);
        }
    }
    function click(selector) {
        if (selector === '#st-swipe-tree-entry') mock.openOptions();
        const node = $(selector); assert(node, `Missing ${selector}`);
        assert(!node.closest('[hidden]'), `Cannot click hidden control: ${selector}`);
        node.click();
    }
    function openTools() {
        if ($('.st-swipe-timeline-controls')?.hidden) click('.st-swipe-timeline-tools-toggle');
        assert(!$('.st-swipe-timeline-controls').hidden, 'tools genuinely expanded');
        equal($('.st-swipe-timeline-tools-toggle').getAttribute('aria-expanded'), 'true', 'expanded tools ARIA');
    }
    const message = () => mock.context.chat[0];
    const selected = () => all('.st-swipe-jump-item.selected').map(button => Number(button.dataset.idx));
    const snapshot = () => JSON.stringify(mock.context.chat);
    function enterSelection() {
        if ($('#st-swipe-preview-modal-delete-mode').getAttribute('aria-pressed') !== 'true') click('#st-swipe-preview-modal-delete-mode');
    }
    const select = index => { enterSelection(); click(`.st-swipe-jump-item[data-idx="${index}"]`); };
    const action = (name, index) => click(`.st-swipe-action-${name}[data-idx="${index}"]`);
    const toolbar = name => { enterSelection(); click(`[data-selection="${name}"]`); };
    const idle = () => waitFor(() => !$('#st-swipe-preview-modal')?.hasAttribute('aria-busy'), 'mutation idle');
    async function open(index = 0) {
        if (!$(`#chat .mes[mesid="${index}"]`)) await mock.renderMessage(index);
        click(`#chat .mes[mesid="${index}"] .st-swipe-previewer-button`);
        await waitFor(() => all('.st-swipe-card').length === (mock.context.chat[index].swipes?.length || 1), 'preview cards');
    }
    async function tree(fromPreview = false) {
        click(fromPreview ? '#st-swipe-preview-modal-tree' : '#st-swipe-tree-entry');
        const total = mock.context.chat.length;
        const candidates = mock.context.chat.reduce((sum, message) => sum + (message.swipes?.length || 1) - 1, 0);
        await waitFor(() => $('.st-swipe-tree-status')?.textContent === `显示 ${total} / ${total} 个楼层 + ${candidates} 个旁支。`, 'complete timeline status');
        if (total) await waitFor(() => $('.st-swipe-timeline-node-selected'), 'initial source focus');
    }
    function mixedChat() {
        const single = (text, role = 'char') => ({ name: `${role} name`, mes: text, extra: {},
            is_user: role === 'user', is_system: role === 'system' });
        const multi = (count, current, role = 'char') => ({ ...single(`Reply ${current}`, role),
            swipes: Array.from({ length: count }, (_, i) => `Reply ${i}`), swipe_id: current });
        return [single('system', 'system'), multi(3, 1), single('user', 'user'), single('char single'),
            multi(2, 0, 'user'), multi(2, 1), single('user tail', 'user'), single('system tail', 'system'), single('char tail')];
    }
    const visibleFloors = async () => (await collectTimeline('.st-swipe-timeline-node-current')).map(node => Number(node.dataset.mesId));
    async function filter(selector, ids) {
        openTools();
        click(selector);
        await settleTimeline();
        equal(await visibleFloors(), ids, 'all filtered floors reachable across virtual windows');
    }
    async function captureScroll(run) {
        const calls = [];
        const originals = new Map();
        for (const method of ['scrollTo', 'scrollIntoView']) {
            const original = Element.prototype[method];
            originals.set(method, original);
            Element.prototype[method] = function (options, ...args) {
                calls.push({ method, target: this, options });
                return original.call(this, options, ...args);
            };
        }
        try { await run(calls); } finally { for (const [method, original] of originals) Element.prototype[method] = original; }
    }
    async function nodeDetail(index, swipe = 0) {
        const selector = `.st-swipe-timeline-node[data-mes-id="${index}"][data-swipe-idx="${swipe}"]`;
        await revealTimeline(selector);
        click(selector);
        await waitFor(() => $('.st-swipe-timeline-preview'), 'node detail');
    }
    function assertCoherent() {
        const m = message();
        equal(m.mes, m.swipes[m.swipe_id], 'visible text matches active swipe');
        equal(m.swipes.length, m.swipe_info.length, 'metadata length');
        equal(m.extra, m.swipe_info[m.swipe_id].extra, 'active metadata matches');
        equal(m.send_date, m.swipe_info[m.swipe_id].send_date, 'active date matches');
    }
    async function test(name, run) {
        if (selectionOnly && /tree|single-branch/i.test(name)) return;
        await mock.reset();
        try {
            await run();
            equal(mock.errors, [], 'uncaught browser errors');
            results.push({ name, status: 'passed' });
        } catch (error) {
            results.push({ name, status: 'failed', error: error.message, notifications: mock.notifications });
        }
    }
    await waitFor(() => $('#chat .st-swipe-previewer-button') && $('#st-swipe-tree-entry'), 'native plugin ready');
    await test('native message entry opens five native swipes without mutation', async () => {
        assert(!('ST_API' in window), 'no wrapper API exists in the native mock');
        const before = snapshot();
        await open();
        equal(all('.st-swipe-card').length, 5, 'card count');
        assert(!$('#st-swipe-tree-modal'), 'message entry opens content first, not graph');
        equal($('.st-swipe-card.active').dataset.idx, '2', 'current card');
        equal(snapshot(), before, 'preview is read only');
        equal(mock.stats.saves, 0, 'no save');
    });
    await test('native template and existing rows have exactly one accessible button beside edit', async () => {
        for (const row of all('#message_template .mes, #chat .mes')) {
            const buttons = [...row.querySelectorAll('.st-swipe-previewer-button')];
            equal(buttons.length, 1, 'one button per template or floor');
            const button = buttons[0];
            assert(button.parentElement.matches('.mes_buttons'), 'normal native button container');
            assert(button.nextElementSibling.matches('.mes_edit'), 'button immediately before edit');
            equal(button.getAttribute('role'), 'button', 'accessible role');
            equal(button.tabIndex, 0, 'keyboard focusable');
            assert(button.getAttribute('aria-label'), 'accessible name');
        }
        const before = snapshot();
        message().swipes[2] = 'stale native swipe text';
        const stale = snapshot();
        await open();
        assert($('.st-swipe-card.active').textContent.includes('Charlie'), 'active preview uses current mes, not stale swipes');
        equal(snapshot(), stale, 'preview does not normalize live native data');
        equal(mock.stats.saves, 0, 'no preview save');
        assert(before !== stale, 'stale fixture differs');
    });
    await test('native rendered events patch new user and character rows without duplicate buttons', async () => {
        const counts = mock.listenerCounts();
        for (const [offset, is_user] of [true, false].entries()) {
            const index = offset + 2;
            mock.context.chat.push({ name: is_user ? 'You' : 'AI', is_user, mes: `New native ${index}`, extra: {} });
            await mock.renderMessage(index, { cloneTemplate: false });
            await mock.context.eventSource.emit(mock.context.event_types.MESSAGE_UPDATED, index);
            await mock.context.eventSource.emit(mock.context.event_types.MESSAGE_SWIPED, index);
            equal(all(`#chat .mes[mesid="${index}"] .st-swipe-previewer-button`).length, 1, 'render/update/swipe reconciliation is idempotent');
            const before = snapshot();
            await open(index);
            assert($('.st-swipe-card').textContent.includes(`New native ${index}`), 'new row opens correct native message');
            equal(snapshot(), before, 'new row preview read only');
            click('#st-swipe-preview-modal-close');
        }
        equal(mock.listenerCounts(), counts, 'new messages do not add global handlers');
        equal(mock.stats.saves, 0, 'no native render save');
    });
    await test('native history clones template and MORE_MESSAGES_LOADED repairs missing buttons', async () => {
        const { showMoreMessages } = await import('/script.js');
        $('#chat .mes[mesid="0"]').remove();
        const before = snapshot();
        await showMoreMessages(1);
        equal(all('#chat .mes[mesid="0"] .st-swipe-previewer-button').length, 1, 'history clone inherits native button');
        $('#chat .mes[mesid="0"] .st-swipe-previewer-button').remove();
        await mock.context.eventSource.emit(mock.context.event_types.MORE_MESSAGES_LOADED);
        equal(all('#chat .mes[mesid="0"] .st-swipe-previewer-button').length, 1, 'history event reconciles older unpatched rows');
        assert(mock.stats.events.some(event => event.type === 'MORE_MESSAGES_LOADED'), 'history host emits native event');
        await open();
        equal(snapshot(), before, 'history preview read only');
        equal(mock.stats.saves, 0, 'history never saves');
    });
    await test('native position setting moves same buttons and updates future/history template clones', async () => {
        await open();
        click('#st-swipe-preview-modal-settings');
        const toggle = $('#st-swipe-previewer-settings-modal-move');
        const original = $('#chat .mes[mesid="0"] .st-swipe-previewer-button');
        const before = snapshot();
        try {
            for (const extra of [true, false, true, false]) {
                toggle.checked = extra;
                toggle.dispatchEvent(new Event('change', { bubbles: true }));
                await pause(0);
                for (const row of all('#message_template .mes, #chat .mes')) {
                    const buttons = [...row.querySelectorAll('.st-swipe-previewer-button')];
                    equal(buttons.length, 1, 'moving does not duplicate buttons');
                    assert(buttons[0].parentElement.matches(extra ? '.extraMesButtons' : '.mes_buttons'), 'button uses selected native container');
                    if (extra) assert(buttons[0].parentElement.firstElementChild === buttons[0], 'first extra menu slot');
                    else assert(buttons[0].nextElementSibling.matches('.mes_edit'), 'before native edit');
                }
                assert($('#chat .mes[mesid="0"] .st-swipe-previewer-button') === original, 'existing button identity retained');
                const clone = mock.createMessageElement(1);
                assert(clone.querySelector(`${extra ? '.extraMesButtons' : '.mes_buttons'} > .st-swipe-previewer-button`), 'future template clone preserves placement');
                $('#chat .mes[mesid="1"]').replaceWith(clone);
            }
        } finally {
            toggle.checked = false; toggle.dispatchEvent(new Event('change', { bubbles: true }));
            click('#st-swipe-previewer-settings-modal-close');
            click('#st-swipe-preview-modal-close');
        }
        await open(1);
        equal(snapshot(), before, 'position settings do not alter chat');
        equal(mock.stats.saves, 0, 'settings do not save chat');
    });
    await test('native delegated keyboard activation opens correct row and ignores invalid message ids', async () => {
        const button = $('#chat .mes[mesid="1"] .st-swipe-previewer-button');
        for (const key of ['Enter', ' ']) {
            button.focus();
            button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
            await waitFor(() => all('.st-swipe-card').length === 1, 'native keyboard preview');
            assert($('.st-swipe-card').textContent.includes('Only single message'), 'keyboard opens owning row');
            click('#st-swipe-preview-modal-close');
            await waitFor(() => document.activeElement === button, 'close restores source button focus');
        }
        const row = button.closest('.mes');
        for (const id of ['-1', 'not-a-number', '9999']) {
            row.setAttribute('mesid', id); button.click(); await pause(0);
            assert(!$('#st-swipe-preview-modal'), 'invalid or missing native message ignored');
        }
        row.setAttribute('mesid', '1');
        equal(mock.stats.saves, 0, 'keyboard preview never saves');
    });
    await test('header trash enters selection; normal numbered navigation never selects', async () => {
        await open();
        assert($('.st-swipe-selection-toolbar').hidden, 'toolbar initially hidden');
        assert($('#st-swipe-preview-modal-delete-mode').closest('.st-swipe-header-ops'), 'trash in header');
        equal(all('.st-swipe-card input, .st-swipe-action-delete').length, 0, 'cards have no selection or deletion controls');
        click('.st-swipe-jump-item[data-idx="4"]');
        equal(selected(), [], 'normal click only navigates');
        click('#st-swipe-preview-modal-toggle');
        assert($('#st-swipe-preview-modal-jump-list').classList.contains('hidden'), 'list collapsed');
        enterSelection();
        assert(!$('#st-swipe-preview-modal-jump-list').classList.contains('hidden'), 'selection expands list');
        click('#st-swipe-preview-modal-toggle');
        assert(!$('#st-swipe-preview-modal-jump-list').classList.contains('hidden'), 'cannot hide selection controls');
        assert(!$('.st-swipe-selection-toolbar').hidden, 'toolbar visible in mode');
        equal(mock.stats.saves, 0, 'no save');
    });
    await test('numbered selection has independent current and pending-delete states without scrolling', async () => {
        await open(); enterSelection();
        const content = $('#st-swipe-preview-modal-content');
        content.scrollTop = 40; const top = content.scrollTop;
        click('.st-swipe-jump-item[data-idx="2"]');
        const current = $('.st-swipe-jump-item[data-idx="2"]');
        assert(current.classList.contains('active') && current.classList.contains('selected'), 'current and selected stack');
        equal(current.getAttribute('aria-current'), 'true', 'current accessibility');
        equal(current.getAttribute('aria-pressed'), 'true', 'selection accessibility');
        click('.st-swipe-jump-item[data-idx="4"]');
        equal(content.scrollTop, top, 'selection does not move content');
        equal(message().swipe_id, 2, 'selection does not activate swipe');
        click('.st-swipe-jump-item[data-idx="2"]');
        assert(current.classList.contains('active') && !current.classList.contains('selected'), 'deselect retains current');
    });
    await test('invert selection toggles every number, including current; exit clears selection', async () => {
        await open(); select(0); select(2); toolbar('invert');
        equal(selected(), [1, 3, 4], 'inverted');
        toolbar('invert'); equal(selected(), [0, 2], 'double inversion');
        toolbar('none'); toolbar('invert'); equal(selected(), [0, 1, 2, 3, 4], 'empty inverted to all');
        assert($('[data-selection="delete"]').disabled, 'inverted all cannot delete');
        toolbar('exit'); assert($('.st-swipe-selection-toolbar').hidden, 'exited');
        equal(selected(), [], 'exit clears');
        enterSelection(); equal(selected(), [], 'reentry empty');
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        assert($('#st-swipe-preview-modal') && $('.st-swipe-selection-toolbar').hidden, 'escape first exits mode');
        equal(mock.stats.saves, 0, 'no save');
    });
    await test('numbered batch delete preserves active branch and aligned metadata', async () => {
        await open(); select(0); select(4); equal(selected(), [0, 4], 'selection');
        equal(all('.st-swipe-jump-item.selected').length, 2, 'number selection styles');
        toolbar('delete'); await idle();
        equal(message().swipes, ['Bravo', 'Charlie', 'Delta'], 'survivors');
        equal(message().swipe_id, 1, 'active remapped'); assertCoherent();
        equal(message().swipe_info.map(info => info.extra.marker), ['Bravo', 'Charlie', 'Delta'], 'metadata follows');
        assert($('.st-swipe-selection-toolbar').hidden, 'successful deletion exits mode');
        equal(mock.stats.saves, 1, 'one save'); equal(selected(), [], 'selection cleared');
        const events = mock.stats.events.filter(event => event.type === 'MESSAGE_SWIPE_DELETED');
        equal(events.map(event => event.args[0].swipeId), [4, 0], 'native descending deletion payloads');
        equal(events.map(event => event.swipes.length), [4, 3], 'events see intermediate arrays');
    });
    await test('batch deletion including current activates next surviving branch', async () => {
        await open(); select(1); select(2); toolbar('delete'); await idle();
        equal(message().swipes, ['Alpha', 'Delta', 'Echo'], 'survivors');
        equal(message().swipe_id, 1, 'next active'); equal(message().mes, 'Delta', 'next text'); assertCoherent();
        equal(mock.stats.saves, 1, 'one save');
    });
    await test('select all disables deletion; deselect and others controls work', async () => {
        await open(); const before = snapshot(); toolbar('all'); equal(selected(), [0, 1, 2, 3, 4], 'all');
        assert($('[data-selection="delete"]').disabled, 'delete all disabled'); toolbar('delete'); await pause(30);
        equal(snapshot(), before, 'unchanged'); equal(mock.stats.confirms, 0, 'no confirmation');
        toolbar('none'); equal(selected(), [], 'none'); toolbar('others'); equal(selected(), [0, 1, 3, 4], 'others');
    });
    await test('cancel confirmation preserves chat and selection', async () => {
        await open(); select(0); const before = snapshot(); mock.confirmMode = 'cancel';
        toolbar('delete'); await idle(); equal(snapshot(), before, 'cancelled chat');
        equal(selected(), [0], 'selection retained'); equal(mock.stats.saves, 0, 'no save');
    });
    await test('selection follows reordered candidate then deletes that candidate', async () => {
        await open(); select(1); action('move-down', 1); await idle();
        equal(message().swipes, ['Alpha', 'Charlie', 'Bravo', 'Delta', 'Echo'], 'swap');
        equal(selected(), [2], 'selected Bravo follows move'); equal(message().swipe_id, 1, 'active Charlie remaps');
        toolbar('delete'); await idle(); equal(message().swipes, ['Alpha', 'Charlie', 'Delta', 'Echo'], 'Bravo deleted');
        assertCoherent(); equal(mock.stats.saves, 2, 'move and delete saved');
    });
    await test('edit inactive candidate preserves active text and invalidates its token cache', async () => {
        await open(); const activeExtra = structuredClone(message().extra); action('edit', 0);
        await waitFor(() => $('.st-swipe-edit-textarea'), 'editor'); $('.st-swipe-edit-textarea').value = 'Alpha edited\nsecond line';
        click('.st-swipe-edit-save'); await idle();
        equal(message().swipes[0], 'Alpha edited\nsecond line', 'inactive edit'); equal(message().mes, 'Charlie', 'active unchanged');
        equal(message().extra, activeExtra, 'active metadata unchanged');
        assert(!('token_count' in message().swipe_info[0].extra), 'inactive token cache removed');
        equal(mock.stats.events.filter(e => e.type === 'MESSAGE_EDITED').length, 0, 'no false active edit event');
        equal(mock.stats.saves, 1, 'one save'); assertCoherent();
    });
    await test('edit active candidate updates mes and native edit/update events', async () => {
        await open(); action('edit', 2); await waitFor(() => $('.st-swipe-edit-textarea'), 'editor');
        $('.st-swipe-edit-textarea').value = 'Charlie edited'; click('.st-swipe-edit-save'); await idle();
        equal(message().mes, 'Charlie edited', 'active edit'); assertCoherent();
        assert(!('token_count' in message().extra), 'active token cache removed');
        equal(mock.stats.events.map(e => e.type), ['MESSAGE_EDITED', 'MESSAGE_UPDATED'], 'edit events');
        equal(mock.stats.saves, 1, 'one save');
    });
    await test('tree preview of noncurrent branch is read only', async () => {
        const before = snapshot(); await tree(); await nodeDetail(0, 4);
        equal((await collectTimeline('.st-swipe-timeline-node[data-mes-id="0"]')).length, 5, 'five candidate nodes reachable across virtual windows');
        click('.st-swipe-timeline-preview');
        await waitFor(() => all('.st-swipe-card').length === 5, 'preview from tree');
        assert(!$('#st-swipe-tree-modal'), 'tree closed'); equal(snapshot(), before, 'tree preview no mutation');
        equal(message().swipe_id, 2, 'current not switched'); equal(mock.stats.saves, 0, 'no save');
    });
    await test('single-branch floor opens read-only preview', async () => {
        const before = snapshot(); await tree(); await nodeDetail(1);
        click('.st-swipe-timeline-preview');
        await waitFor(() => all('.st-swipe-card').length === 1, 'single card');
        equal($('.st-swipe-card-text').textContent, 'Only single message', 'single text');
        assert($('.st-swipe-selection-toolbar').hidden, 'selection hidden');
        assert(all('.st-swipe-card-actions button').every(button => button.disabled), 'mutations disabled');
        equal(snapshot(), before, 'single preview no mutation'); equal(mock.stats.saves, 0, 'no save');
    });
    await test('native single-candidate message entry opens content directly', async () => {
        const before = snapshot(); await open(1);
        assert(!$('#st-swipe-tree-modal'), 'single message does not divert to tree');
        equal($('.st-swipe-card-text').textContent, 'Only single message', 'single entry text');
        equal(snapshot(), before, 'read-only single entry'); equal(mock.stats.saves, 0, 'no save');
    });
    await test('tree close and Escape restore the same hidden source preview and its selection', async () => {
        const before = snapshot(); await open(); select(1);
        const source = $('#st-swipe-preview-modal');
        for (const dismiss of ['close', 'Escape']) {
            await tree(true);
            assert(source.isConnected && source.hidden, 'source kept connected but hidden');
            equal(getComputedStyle(source).display, 'none', 'hidden preview does not cover graph');
            if (dismiss === 'close') click('.st-swipe-tree-close');
            else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            await waitFor(() => !$('#st-swipe-tree-modal'), 'tree dismissed');
            assert($('#st-swipe-preview-modal') === source && !source.hidden, 'exact source restored');
            equal(selected(), [1], 'selection retained across tree');
        }
        equal(snapshot(), before, 'return flow never changes chat'); equal(mock.stats.saves, 0, 'no save');
    });
    await test('tree pure preview replaces hidden source with target without activating a swipe', async () => {
        const before = snapshot(); await open(1); const source = $('#st-swipe-preview-modal');
        await tree(true); await nodeDetail(0, 4); click('.st-swipe-timeline-preview');
        await waitFor(() => all('.st-swipe-card').length === 5 && !$('#st-swipe-tree-modal'), 'target preview');
        assert(!source.isConnected, 'old single-floor source disposed');
        assert(!$('#st-swipe-preview-modal').hidden, 'target visible');
        await tree(true);
        equal($('.st-swipe-timeline-node-selected').dataset.nodeId, '0:4', 'requested candidate is preview target');
        click('.st-swipe-tree-close');
        equal(message().swipe_id, 2, 'native active branch unchanged');
        equal(snapshot(), before, 'pure preview no mutation'); equal(mock.stats.saves, 0, 'no save');
    });
    await test('tree filters combine, preserve native IDs and unknown edges, and style roles distinctly', async () => {
        mock.context.chat = mixedChat(); const before = snapshot(); await tree();
        for (const role of ['char', 'user', 'system']) {
            await revealTimeline(`.st-swipe-timeline-node[data-role="${role}"]`);
            assert($(`.st-swipe-timeline-node[data-role="${role}"]`), `${role} data-role`);
        }
        await revealTimeline('.st-swipe-timeline-node-current[data-role="char"]');
        const charColor = getComputedStyle($('.st-swipe-timeline-node-current[data-role="char"]')).backgroundColor;
        await revealTimeline('.st-swipe-timeline-node-current[data-role="user"]');
        const userColor = getComputedStyle($('.st-swipe-timeline-node-current[data-role="user"]')).backgroundColor;
        assert(charColor !== userColor, 'char and user use distinct computed color families');
        await filter('.st-swipe-timeline-only-char', [1, 3, 5, 8]);
        equal((await collectTimeline('.st-swipe-timeline-gap')).length, 4, 'char omissions rendered');
        await filter('.st-swipe-timeline-only-branches', [1, 5]);
        equal((await collectTimeline('.st-swipe-timeline-gap')).map(n => n.textContent), ['… 省略 1 楼 …', '… 省略 3 楼 …', '… 省略 3 楼 …'], 'collapsed ranges');
        equal((await collectTimeline('.st-swipe-timeline-summary-gap')).map(n => n.dataset.gapId), ['0:0', '2:3', '6:8'], 'summary keeps independent ordinary runs');
        equal((await collectTimeline('.st-swipe-timeline-path-step')).map(n => Number(n.dataset.mesId)), [1, 4, 5], 'summary retains user junction despite canvas filters');
        equal((await collectTimeline('.st-swipe-timeline-edge-current')).map(e => [e.dataset.from, e.dataset.to]), [['1:1', '5:1']], 'visible path reconnected');
        equal((await collectTimeline('.st-swipe-timeline-edge-candidate')).map(e => [e.dataset.from, e.dataset.to]), [['1:1', '5:0']], 'unknown candidate reconnected');
        assert((await collectTimeline('.st-swipe-timeline-edge-candidate')).every(e => !e.hasAttribute('marker-end')), 'unknown edges do not claim ancestry');
        click('.st-swipe-timeline-toggle-candidates');
        await waitFor(() => all('.st-swipe-timeline-node').length === 2, 'filtered current-only');
        equal((await collectTimeline('.st-swipe-timeline-gap')).length, 3, 'candidate toggle retains gaps');
        await filter('.st-swipe-timeline-only-char', [1, 4, 5]);
        equal($('.st-swipe-timeline-only-branches').getAttribute('aria-pressed'), 'true', 'branch filter remains active');
        await filter('.st-swipe-timeline-only-branches', [0, 1, 2, 3, 4, 5, 6, 7, 8]);
        equal((await collectTimeline('.st-swipe-timeline-gap')).length, 0, 'filters restore all floors');
        equal(snapshot(), before, 'filtering is display-only'); equal(mock.stats.saves, 0, 'no save');
    });
    await test('tree initially locates source candidate, hidden source falls back, head/tail use visible floors', async () => {
        mock.context.chat = mixedChat(); await open(4);
        click('.st-swipe-jump-item[data-idx="1"]'); await tree(true);
        equal($('.st-swipe-timeline-node-selected').dataset.nodeId, '4:1', 'initial source candidate');
        const viewport = $('.st-swipe-timeline-viewport');
        assert(viewport.scrollTop > 0, 'source initially scrolled into view');
        await filter('.st-swipe-timeline-only-char', [1, 3, 5, 8]);
        equal($('.st-swipe-timeline-node-selected').dataset.nodeId, '3:0', 'hidden source tie falls back to earlier floor');
        await filter('.st-swipe-timeline-only-branches', [1, 5]);
        click('.st-swipe-timeline-go-source');
        await waitFor(() => $('.st-swipe-timeline-node-selected')?.dataset.nodeId === '5:1', 'nearest source floor under combined filters');
        assert(all('.st-swipe-timeline-status').some(n => n.textContent.includes('#4') && n.textContent.includes('#5')), 'hidden source explanation');
        click('.st-swipe-timeline-go-head'); await settleTimeline(); equal(document.activeElement.dataset.nodeId, '1:1', 'head is first visible floor');
        const headTop = viewport.scrollTop;
        click('.st-swipe-timeline-go-tail'); await settleTimeline(); equal(document.activeElement.dataset.nodeId, '5:1', 'tail is last visible floor');
        assert(viewport.scrollTop > headTop, 'tail moves canvas synchronously');
        equal(getComputedStyle(viewport).scrollBehavior, 'auto', 'canvas scrolling is immediate');
        equal(mock.stats.saves, 0, 'navigation no save');
    });
    await test('tree floating tools stay at canvas top-left while scrolling and search clears on collapse', async () => {
        mock.context.chat = mixedChat(); await tree();
        const tools = $('.st-swipe-timeline-tools'), canvas = $('.st-swipe-timeline-canvas');
        assert(tools.parentElement === canvas && !tools.closest('.st-swipe-timeline-header'), 'tools belong to canvas, not header');
        equal(getComputedStyle(tools).position, 'absolute', 'floating overlay');
        const before = tools.getBoundingClientRect(), bounds = canvas.getBoundingClientRect();
        assert(Math.abs(before.left - bounds.left) <= 16 && Math.abs(before.top - bounds.top) <= 16, 'top-left anchored');
        $('.st-swipe-timeline-viewport').scrollTop = 900;
        const after = tools.getBoundingClientRect(); equal([after.left, after.top], [before.left, before.top], 'tools do not scroll away');
        click('.st-swipe-timeline-search-toggle'); $('.st-swipe-tree-search').value = 'Reply';
        $('.st-swipe-tree-search').dispatchEvent(new Event('input', { bubbles: true }));
        await waitFor(() => all('.st-swipe-timeline-node-match').length > 0, 'search matches');
        click('.st-swipe-timeline-search-toggle');
        await waitFor(() => all('.st-swipe-timeline-node-match').length === 0, 'collapse clears highlighting');
        equal($('.st-swipe-tree-search').value, '', 'query cleared on collapse');
        assert($('.st-swipe-timeline-toolbar').hidden, 'search panel hidden again');
    });
    await test('tree locate closes both overlays and preview navigation uses auto scroll', async () => {
        const before = snapshot();
        await captureScroll(async calls => {
            await open(); click('.st-swipe-jump-item[data-idx="4"]');
            assert(calls.some(c => c.target.id === 'st-swipe-preview-modal-content' && c.options?.behavior === 'auto'), 'numbered navigation auto-scroll');
            assert(calls.every(c => c.options?.behavior !== 'smooth'), 'no smooth preview scroll');
            const source = $('#st-swipe-preview-modal'); await tree(true); await nodeDetail(1);
            click('.st-swipe-timeline-locate');
            await waitFor(() => !$('#st-swipe-tree-modal') && !$('#st-swipe-preview-modal'), 'locate returns to chat');
            assert(!source.isConnected, 'locate disposes hidden source');
            assert(calls.some(c => c.target.matches('#chat .mes[mesid="1"]') && c.options?.behavior === 'auto'), 'chat floor located with auto scroll');
        });
        equal(snapshot(), before, 'locate read only'); equal(mock.stats.saves, 0, 'no save');
    });
    await test('tree all-hidden filter can recover without fabricated nodes', async () => {
        mock.context.chat = [{ name: 'Single user', is_user: true, mes: 'one', extra: {} }]; await tree();
        await filter('.st-swipe-timeline-only-char', []);
        equal(all('.st-swipe-timeline-node').length, 0, 'no visible nodes');
        equal(all('.st-swipe-timeline-edge').length, 0, 'no fake path');
        equal((await collectTimeline('.st-swipe-timeline-gap')).length, 1, 'one omitted range');
        click('.st-swipe-timeline-go-head'); click('.st-swipe-timeline-go-tail'); click('.st-swipe-timeline-go-source');
        await filter('.st-swipe-timeline-only-char', [0]);
        equal((await collectTimeline('.st-swipe-timeline-gap')).length, 0, 'recover all floors');
    });
    await test('chat switch closes preview and cancels pending confirmation safely', async () => {
        await open(); select(2); const before = snapshot(); const oldChat = mock.context.chat;
        mock.confirmMode = 'hold'; toolbar('delete'); await waitFor(() => mock.pendingConfirm, 'pending confirm');
        await mock.switchChat(); assert(!$('#st-swipe-preview-modal'), 'preview closes on chat change');
        const next = snapshot(); mock.pendingConfirm(true); mock.pendingConfirm = null; await pause(80);
        equal(JSON.stringify(oldChat), before, 'old chat unchanged'); equal(snapshot(), next, 'new chat unchanged');
        equal(mock.stats.saves, 0, 'stale confirmation no save');
    });
    await test('chat switch closes active editor without saving', async () => {
        await open(); action('edit', 2); await waitFor(() => $('.st-swipe-edit-textarea'), 'editor');
        const old = mock.context.chat; const before = JSON.stringify(old); $('.st-swipe-edit-textarea').value = 'never save';
        await mock.switchChat(); await pause(30);
        assert(!$('.st-swipe-edit-textarea') && !$('#st-swipe-preview-modal'), 'editor and preview closed');
        equal(JSON.stringify(old), before, 'old chat unchanged'); equal(mock.stats.saves, 0, 'no save');
    });
    await test('repeated preview/tree open-close does not grow lifecycle listeners', async () => {
        const baseline = mock.listenerCounts();
        for (let i = 0; i < 6; i++) {
            await open(); click('#st-swipe-preview-modal-close'); await pause(10);
            equal(mock.listenerCounts(), baseline, `preview cycle ${i}`);
            await tree(); click('.st-swipe-tree-close');
            await waitFor(() => all('.st-swipe-card').length === 1, 'settings tree returns to last floor preview');
            click('#st-swipe-preview-modal-close'); await pause(10);
            equal(mock.listenerCounts(), baseline, `tree cycle ${i}`);
        }
    });
    await test('generation guard blocks mutations and generation event closes preview', async () => {
        await open(); const before = snapshot(); mock.generating = true; action('move-down', 0); await idle();
        equal(snapshot(), before, 'generation guard'); equal(mock.stats.saves, 0, 'no save');
        await mock.context.eventSource.emit('GENERATION_STARTED'); assert(!$('#st-swipe-preview-modal'), 'generation closes');
    });
    await test('tree search highlights raw branch text without removing paths and refreshes on chat switch', async () => {
        await tree();
        const paths = (await collectTimeline('.st-swipe-timeline-edge')).map(edge => edge.getAttribute('d')).sort();
        assert($('.st-swipe-timeline-toolbar').hidden, 'search collapsed by default');
        equal($('.st-swipe-timeline-search-toggle').getAttribute('aria-expanded'), 'false', 'search toggle state');
        click('.st-swipe-timeline-search-toggle');
        assert(!$('.st-swipe-timeline-toolbar').hidden, 'search expanded');
        assert(document.activeElement === $('.st-swipe-tree-search'), 'expanded search receives focus');
        $('.st-swipe-tree-search').value = 'Echo';
        $('.st-swipe-tree-search').dispatchEvent(new Event('input', { bubbles: true }));
        await waitFor(() => all('.st-swipe-timeline-node-match').length === 1, 'matched node');
        equal($('.st-swipe-timeline-node-match').dataset.nodeId, '0:4', 'search finds noncurrent swipe');
        equal((await collectTimeline('.st-swipe-timeline-node')).length, 6, 'search keeps every node reachable');
        equal((await collectTimeline('.st-swipe-timeline-edge')).map(edge => edge.getAttribute('d')).sort(), paths, 'search never rewires');
        await mock.switchChat();
        await waitFor(() => all('.st-swipe-timeline-node').length === 1 && $('.st-swipe-timeline-node').textContent.includes('Other AI'), 'new chat tree');
        equal($('.st-swipe-tree-search').value, '', 'search cleared');
        click('.st-swipe-timeline-search-toggle');
        assert($('.st-swipe-timeline-toolbar').hidden, 'search can collapse again');
        equal($('.st-swipe-timeline-search-toggle').getAttribute('aria-expanded'), 'false', 'collapsed accessibility');
        equal(mock.stats.saves, 0, 'no tree save');
    });
    await test('tree main path, candidate visibility, zoom and double-click are read only', async () => {
        const before = snapshot(); await tree(); openTools();
        equal((await collectTimeline('.st-swipe-timeline-node-current')).map(node => node.dataset.nodeId), ['0:2', '1:0'], 'selected path nodes');
        equal((await collectTimeline('.st-swipe-timeline-edge-current')).map(edge => [edge.dataset.from, edge.dataset.to]), [['0:2', '1:0']], 'selected path connects current swipes');
        assert($('.st-swipe-timeline-path-summary').textContent.includes('#0分支5'), 'path summary emphasizes multi-branch count');
        assert($('.st-swipe-timeline-path-multiple').title.includes('当前分支3'), 'summary tooltip retains actual current swipe');
        click('.st-swipe-timeline-toggle-candidates');
        await waitFor(() => all('.st-swipe-timeline-node').length === 2, 'current path only');
        equal(all('.st-swipe-timeline-node-candidate').length, 0, 'candidates hidden');
        click('.st-swipe-timeline-zoom-in'); await settleTimeline(); equal($('.st-swipe-timeline-zoom-label').textContent, '115%', 'zoom in');
        click('.st-swipe-timeline-zoom-reset'); await settleTimeline(); equal($('.st-swipe-timeline-zoom-label').textContent, '100%', 'zoom reset');
        click('.st-swipe-timeline-toggle-candidates');
        await settleTimeline();
        equal((await collectTimeline('.st-swipe-timeline-node')).length, 6, 'all candidates restored across virtual windows');
        (await revealTimeline('.st-swipe-timeline-node[data-node-id="0:1"]')).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        await waitFor(() => all('.st-swipe-card').length === 5, 'double-click preview');
        equal(snapshot(), before, 'graph interactions never write'); equal(mock.stats.saves, 0, 'no save');
    });
    await test('tree loads historical floor in bounded batches without changing chat', async () => {
        mock.context.chat = Array.from({ length: 206 }, (_, i) => ({ name: 'History AI', mes: `Floor ${i}`, extra: {} }));
        $('#chat').replaceChildren(mock.createMessageElement(205));
        const before = snapshot();
        await tree(); await nodeDetail(0);
        click('.st-swipe-timeline-locate');
        await waitFor(() => !$('#st-swipe-tree-modal'), 'historical locate completes');
        equal(mock.stats.historyLoads, [100, 100, 5], 'bounded load batches');
        assert($('#chat .mes[mesid="0"] .st-swipe-previewer-button'), 'loaded target has native preview button');
        equal(snapshot(), before, 'history display never mutates data'); equal(mock.stats.saves, 0, 'no save');
    });
    await test('tree stops further history loading after chat changes during load', async () => {
        mock.context.chat = Array.from({ length: 206 }, (_, i) => ({ name: 'History AI', mes: `Floor ${i}`, extra: {} }));
        $('#chat').replaceChildren(mock.createMessageElement(205));
        await tree(); await nodeDetail(0);
        mock.historyLoadHook = () => mock.switchChat();
        click('.st-swipe-timeline-locate');
        await waitFor(() => all('.st-swipe-timeline-node').length === 1, 'new graph after load chat switch');
        equal(mock.stats.historyLoads, [100], 'old task stopped after first batch');
        equal(mock.context.chat[0].mes, 'Unrelated chat', 'new chat intact'); equal(mock.stats.saves, 0, 'no save');
    });
    await test('tree empty chat renders no nodes and closes safely', async () => {
        mock.context.chat = [];
        click('#st-swipe-tree-entry');
        await waitFor(() => $('.st-swipe-tree-status')?.textContent.includes('没有消息'), 'empty state');
        equal(all('.st-swipe-timeline-node').length, 0, 'empty graph');
        equal(all('.st-swipe-timeline-edge').length, 0, 'no fabricated path');
        click('.st-swipe-tree-close'); equal(mock.stats.saves, 0, 'no save');
    });
    await mock.reset();
    return results;
}
