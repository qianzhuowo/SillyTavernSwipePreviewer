import { TIMELINE_PREFERENCES_KEY as KEY } from '../timeline-preferences.mjs';
import { settleTimeline } from './timeline-test-helpers.mjs';

export async function runTreePreferenceCases() {
    const results = [];
    const $ = selector => document.querySelector(selector);
    const assert = (value, label) => { if (!value) throw new Error(label); };
    const wait = async (fn, label) => {
        for (let n = 0; n < 200; n++) { if (fn()) return; await settleTimeline(); }
        throw new Error('Timed out: ' + label);
    };
    const open = async () => {
        mock.openOptions(); $('#st-swipe-tree-entry').click();
        await wait(() => $('.st-swipe-timeline-node-selected'), 'tree ready');
        await settleTimeline();
    };
    const close = async () => {
        $('.st-swipe-tree-close').click();
        $('#st-swipe-preview-modal-close')?.click();
        await settleTimeline();
    };
    const wheel = () => $('.st-swipe-timeline-viewport').dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -1, cancelable: true }));
    const state = () => ({
        scale: $('.st-swipe-timeline-zoom-label').textContent,
        transform: $('.st-swipe-timeline-stage').style.transform,
        candidates: $('.st-swipe-timeline-toggle-candidates').getAttribute('aria-pressed'),
        char: $('.st-swipe-timeline-only-char').getAttribute('aria-pressed'),
        branches: $('.st-swipe-timeline-only-branches').getAttribute('aria-pressed'),
        expanded: $('.st-swipe-timeline-tools-toggle').getAttribute('aria-expanded'),
        hidden: $('.st-swipe-timeline-controls').hidden,
    });
    const test = async (name, run) => {
        await mock.reset();
        try {
            await run();
            assert(mock.stats.saves === 0, 'display preferences never save chat');
            assert(mock.errors.length === 0, 'no browser errors: ' + mock.errors.join('; '));
            results.push({ name, status: 'passed' });
        } catch (error) { results.push({ name, status: 'failed', error: error.message }); }
    };
    await test('tree preferences restore 110% zoom and all filters before the first rendered window', async () => {
        await open();
        const chat = JSON.stringify(mock.context.chat);
        $('.st-swipe-timeline-tools-toggle').click();
        wheel();
        $('.st-swipe-timeline-only-branches').click();
        $('.st-swipe-timeline-only-char').click();
        $('.st-swipe-timeline-toggle-candidates').click();
        await wait(() => state().transform === 'scale(1.1)', '110% applied');
        const expected = state();
        assert(expected.scale === '110%' && expected.branches === 'true' && expected.candidates === 'false', 'chosen display options');
        await close(); await open();
        assert(JSON.stringify(state()) === JSON.stringify(expected), 'reopen restores controls, ARIA and stage scale');
        assert(document.querySelectorAll('.st-swipe-timeline-node').length === 1
            && $('.st-swipe-timeline-node').dataset.mesId === '0', 'restored filters affect initial actual graph');
        assert(JSON.stringify(mock.context.chat) === chat, 'preferences never mutate messages');
        await mock.context.eventSource.emit('CHAT_CHANGED');
        await wait(() => $('.st-swipe-timeline-node-selected'), 'chat refresh');
        assert(JSON.stringify(state()) === JSON.stringify(expected), 'chat refresh does not reset display settings');
    });
    await test('pending zoom survives immediate dismissal and collapsed tools stay collapsed on reopen', async () => {
        await open();
        wheel(); // Deliberately close before the scheduled animation frame runs.
        await close(); await open();
        assert(state().scale === '110%' && state().hidden && state().expanded === 'false', 'requested scale persisted before rAF');
        $('.st-swipe-timeline-tools-toggle').click();
        $('.st-swipe-timeline-zoom-reset').click();
        $('.st-swipe-timeline-tools-toggle').click();
        await close(); await open();
        assert(state().scale === '100%' && state().hidden, 'reset zoom and collapsed state persist');
    });
    await test('tree preference loading tolerates malformed fields and clamps stored zoom', async () => {
        localStorage.setItem(KEY, '{broken'); await open();
        assert(state().scale === '100%' && state().candidates === 'true' && state().hidden, 'malformed JSON uses defaults');
        await close();
        localStorage.setItem(KEY, JSON.stringify({ scale: 50, onlyBranches: 'true', includeCandidates: false, toolsExpanded: true }));
        await open();
        assert(state().scale === '200%' && state().branches === 'false' && state().candidates === 'false' && !state().hidden, 'typed validation and zoom clamp used by UI');
    });
    await test('blocked localStorage does not prevent display settings from working in the current tree', async () => {
        const get = Storage.prototype.getItem, set = Storage.prototype.setItem;
        Storage.prototype.getItem = function (key) { if (key === KEY) throw new DOMException('Blocked', 'SecurityError'); return get.call(this, key); };
        Storage.prototype.setItem = function (key, value) { if (key === KEY) throw new DOMException('Full', 'QuotaExceededError'); return set.call(this, key, value); };
        try {
            await open(); $('.st-swipe-timeline-tools-toggle').click(); wheel();
            $('.st-swipe-timeline-only-branches').click();
            await wait(() => state().scale === '110%', 'zoom without storage');
            assert(state().branches === 'true', 'filters still usable');
        } finally { Storage.prototype.getItem = get; Storage.prototype.setItem = set; }
    });
    await test('only user display settings write preferences, never scrolling or search text', async () => {
        let writes = 0;
        const set = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) { if (key === KEY) writes++; return set.call(this, key, value); };
        try {
            await open();
            const viewport = $('.st-swipe-timeline-viewport');
            viewport.scrollTop += 50; viewport.dispatchEvent(new Event('scroll'));
            $('.st-swipe-timeline-search-toggle').click();
            const input = $('.st-swipe-tree-search'); input.value = 'private query'; input.dispatchEvent(new Event('input'));
            await wait(() => $('.st-swipe-timeline-match-count').textContent === '0 / 0', 'search');
            await settleTimeline(); assert(writes === 0, 'open/scroll/search do not write settings');
            $('.st-swipe-timeline-tools-toggle').click();
            assert(writes === 1 && !localStorage.getItem(KEY).includes('private query'), 'only display preferences persisted');
        } finally { Storage.prototype.setItem = set; }
    });
    await test('tree backdrop dismisses using the shared top-overlay guard', async () => {
        await open();
        $('#st-swipe-tree-modal').click();
        assert(!$('#st-swipe-tree-modal'), 'backdrop closes without an undefined function error');
    });
    await mock.reset();
    return results;
}
