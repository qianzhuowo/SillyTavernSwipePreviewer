import { collectTimeline, revealTimeline, settleTimeline } from './timeline-test-helpers.mjs';

// Browser assertions for virtualization/incremental refresh: no model hooks, no
// private caches, no host network. Offscreen targets must be reached through UI.
export async function runVirtualizationCases() {
    const results = [];
    const $ = selector => document.querySelector(selector);
    const all = selector => [...document.querySelectorAll(selector)];
    const assert = (value, text) => { if (!value) throw new Error(text); };
    const equal = (actual, expected, text) => assert(JSON.stringify(actual) === JSON.stringify(expected), `${text}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
    const wait = async (fn, text) => {
        const deadline = performance.now() + 6000;
        while (!fn()) { if (performance.now() > deadline) throw new Error(`Timed out: ${text}`); await settleTimeline(); }
    };
    const single = id => ({ name: 'Virtual AI', mes: `Floor ${id}`, extra: {} });
    const multi = (id, count) => ({ ...single(id), swipes: Array.from({ length: count }, (_, i) => `Floor ${id} candidate ${i}`), swipe_id: 0, mes: `Floor ${id} candidate 0` });
    const node = id => `.st-swipe-timeline-node[data-node-id="${id}"]`;
    const open = async chat => {
        mock.context.chat = chat;
        $('#st-swipe-tree-entry').click();
        await wait(() => $('.st-swipe-timeline-node-selected'), 'initial virtual window');
        await settleTimeline();
    };
    const search = async (query, count, first) => {
        if ($('.st-swipe-timeline-toolbar').hidden) $('.st-swipe-timeline-search-toggle').click();
        const input = $('.st-swipe-tree-search');
        input.value = query; input.dispatchEvent(new Event('input', { bubbles: true }));
        await wait(() => $('.st-swipe-timeline-match-count').textContent === `${count ? 1 : 0} / ${count}`
            && (!first || $('.st-swipe-timeline-node-match-active')?.dataset.nodeId === first), `search ${query}`);
    };
    async function test(name, run) {
        await mock.reset();
        try {
            await run();
            equal(mock.errors, [], 'no uncaught browser errors');
            equal(mock.stats.saves, 0, 'graph UI never saves chat');
            results.push({ name, status: 'passed' });
        } catch (error) { results.push({ name, status: 'failed', error: error.message }); }
    }

    await test('virtual graph bounds DOM while raw offscreen search and both ends remain reachable', async () => {
        const chat = Array.from({ length: 240 }, (_, id) => id % 2 ? multi(id, 8) : single(id));
        for (const id of [19, 219]) chat[id].swipes[7] += ' long body '.repeat(400) + ' deep-virtual-needle';
        await open(chat);
        const before = JSON.stringify(chat);
        const bounds = () => {
            assert(all('.st-swipe-timeline-node').length > 0 && all('.st-swipe-timeline-node').length < 100, 'bounded two-dimensional node window');
            assert(all('.st-swipe-timeline-edge').length < 100, 'bounded SVG path window');
            assert(all('.st-swipe-timeline-path-step,.st-swipe-timeline-summary-gap').length < 40, 'bounded summary window');
        };
        bounds();
        assert(!$(node('19:7')), 'first raw-text match starts offscreen');
        await search('deep-virtual-needle', 2, '19:7'); bounds();
        $('.st-swipe-timeline-match-next').click();
        await wait(() => $('.st-swipe-timeline-node-match-active')?.dataset.nodeId === '219:7', 'next offscreen raw-text match');
        equal($('.st-swipe-timeline-match-count').textContent, '2 / 2', 'global result count remains exact'); bounds();
        $('.st-swipe-timeline-match-next').click();
        await wait(() => $('.st-swipe-timeline-node-match-active')?.dataset.nodeId === '19:7', 'match navigation wraps');
        $('.st-swipe-timeline-tools-toggle').click();
        $('.st-swipe-timeline-go-head').click();
        await wait(() => document.activeElement.dataset.nodeId === '0:0', 'virtual head focus'); bounds();
        $('.st-swipe-timeline-go-tail').click();
        await wait(() => document.activeElement.dataset.nodeId === '239:0', 'virtual tail focus'); bounds();
        // Search must cancel obsolete work rather than publish a prior query's highlights.
        const input = $('.st-swipe-tree-search');
        for (const query of ['Floor', 'not-a-match', 'deep-virtual-needle']) {
            input.value = query; input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        await wait(() => $('.st-swipe-timeline-match-count').textContent === '1 / 2'
            && $('.st-swipe-timeline-node-match-active')?.dataset.nodeId === '19:7', 'latest query wins');
        await mock.switchChat();
        await wait(() => $('.st-swipe-tree-search').value === '' && all('.st-swipe-timeline-node').length === 1, 'chat switch clears old search/window');
        equal(all('.st-swipe-timeline-node-match').length, 0, 'no stale old-chat matches');
        equal(JSON.stringify(chat), before, 'virtual navigation never mutates original chat');
    });

    await test('batched candidate SVG paths retain every real curve and unknown ancestry semantics', async () => {
        await open([single(0), multi(1, 9), single(2)]);
        const nodes = await collectTimeline('.st-swipe-timeline-node');
        equal(nodes.length, 11, 'every virtual candidate reachable');
        const positions = new Map(nodes.map(n => [n.dataset.nodeId, {
            x: parseFloat(n.style.left), y: parseFloat(n.style.top), width: parseFloat(n.style.width), height: parseFloat(n.style.height),
        }]));
        const expectedCurve = (fromId, toId) => {
            const from = positions.get(fromId), to = positions.get(toId);
            return [from.x + from.width / 2, from.y + from.height, to.x + to.width / 2, to.y].join(',');
        };
        const signatures = paths => [...new Set(paths.flatMap(path => [...path.getAttribute('d').matchAll(/M[^M]+/g)].map(match => {
            const coordinates = match[0].match(/-?\d+(?:\.\d+)?/g).map(Number);
            equal(coordinates.length, 8, 'each batched segment is a complete cubic curve');
            return [coordinates[0], coordinates[1], coordinates[6], coordinates[7]].join(',');
        })))].sort();
        const candidates = await collectTimeline('.st-swipe-timeline-edge-candidate');
        assert(candidates.length < 8, 'candidate curves are actually batched, not one DOM path per candidate');
        assert(candidates.every(path => !path.hasAttribute('marker-end') && path.dataset.relation === 'candidate-unknown'), 'candidate paths never claim current-path ancestry');
        equal(signatures(candidates), Array.from({ length: 8 }, (_, i) => expectedCurve('0:0', `1:${i + 1}`)).sort(), 'all eight candidate endpoints preserved despite batching');
        const current = await collectTimeline('.st-swipe-timeline-edge-current');
        assert(current.every(path => path.hasAttribute('marker-end')), 'current path retains directional markers');
        equal(signatures(current), [expectedCurve('0:0', '1:0'), expectedCurve('1:0', '2:0')].sort(), 'current path remains exact');
    });

    await test('incremental native updates retain unaffected mounted DOM and refresh raw search cache', async () => {
        const chat = Array.from({ length: 20 }, (_, id) => single(id));
        await open(chat);
        const neighbor = $(node('18:0'));
        assert(neighbor, 'unaffected neighbor initially mounted');
        chat[19].mes = 'Updated last floor';
        await mock.context.eventSource.emit('MESSAGE_UPDATED', 19);
        await wait(() => $(node('19:0'))?.textContent.includes('Updated last floor'), 'edited floor snippet refresh');
        assert($(node('18:0')) === neighbor, 'unaffected neighbor DOM identity retained');
        await search('cache-invalidation-needle', 0);
        chat[19].mes += ' body '.repeat(500) + ' cache-invalidation-needle';
        await mock.context.eventSource.emit('MESSAGE_EDITED', 19);
        await mock.context.eventSource.emit('MESSAGE_UPDATED', 19);
        await wait(() => $('.st-swipe-timeline-match-count').textContent.endsWith('/ 1'), 'same-query match cache invalidated on edit');
        $('.st-swipe-timeline-match-next').click();
        await wait(() => $('.st-swipe-timeline-node-match-active')?.dataset.nodeId === '19:0', 'updated raw body searchable');
        chat[19].mes = 'needle removed';
        await mock.context.eventSource.emit('MESSAGE_UPDATED', 19);
        await wait(() => $('.st-swipe-timeline-match-count').textContent === '0 / 0', 'removed match evicted from cache');
        $('.st-swipe-timeline-search-toggle').click();
        chat.push(multi(20, 3));
        await mock.context.eventSource.emit('MESSAGE_RECEIVED', 20);
        await wait(() => $('.st-swipe-tree-status').textContent === '显示 21 / 21 个楼层 + 2 个旁支。', 'new message indexed incrementally');
        (await revealTimeline(node('20:2'))).click();
        assert($('.st-swipe-timeline-detail').textContent.includes('Floor 20 candidate 2'), 'new candidate detail uses live message');
        chat[20].swipe_id = 2; chat[20].mes = chat[20].swipes[2];
        await mock.context.eventSource.emit('MESSAGE_SWIPED', 20);
        await wait(() => $(node('20:2'))?.classList.contains('st-swipe-timeline-node-current'), 'native swipe updates current marker');
        const afterNativeChanges = JSON.stringify(chat);
        $('.st-swipe-timeline-detail-collapse')?.click();
        await settleTimeline();
        equal(JSON.stringify(chat), afterNativeChanges, 'graph does not add mutations to host event fixture');
    });
    await mock.reset();
    return results;
}
