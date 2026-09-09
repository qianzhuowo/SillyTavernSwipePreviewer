import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimelineIndex, createTimelineView, positionFor, focusTimelineId, timelineWindow,
    TimelineDisplayCache, TimelineSearch } from '../timeline-virtual.mjs';
import { createTimelineGraph, filterTimelineGraph, layoutTimelineGraph, edgePath } from '../timeline-graph.mjs';
const message = (count = 1, selected = 0, mes = 'body') => ({ name: 'AI', mes, swipe_id: selected,
    swipes: Array.from({ length: count }, (_, n) => `swipe ${n}`) });
const rectAt = (view, id, width = 900, height = 600) => {
    const p = positionFor(view, id); return { left: p.x - width / 2, right: p.x + width / 2,
        top: p.y - height / 2, bottom: p.y + height / 2 };
};

test('lightweight global index has no per-swipe or normalized text objects', () => {
    const chat = Array.from({ length: 5000 }, () => message(100));
    const index = createTimelineIndex(chat);
    assert.equal(index.stats.totalSwipes, 500000);
    assert.equal(index.floors.length, 5000);
    assert.equal(index.nodes, undefined);
    assert.equal(index.edges, undefined);
    assert.ok(index.floors.every(f => !f.nodes && !f.summary));
});

test('analytic layout agrees with legacy pure layout under every display filter', () => {
    const chat = Array.from({ length: 40 }, (_, i) => ({ ...message(i % 8 + 1, i % (i % 8 + 1)), is_user: i % 3 === 0 }));
    chat[9] = null;
    const index = createTimelineIndex(chat), graph = createTimelineGraph(chat);
    for (const onlyChar of [false, true]) for (const onlyBranches of [false, true]) for (const includeCandidates of [false, true]) {
        const options = { onlyChar, onlyBranches, includeCandidates };
        const old = layoutTimelineGraph(filterTimelineGraph(graph, options), options), view = createTimelineView(index, options);
        assert.equal(view.width, old.width); assert.equal(view.height, old.height);
        for (const [id, position] of old.positions) assert.deepEqual(positionFor(view, id), position, id);
        assert.equal(view.entries.filter(e => !e.floor).length, old.gaps.length);
    }
});

test('window and cache stay bounded in both axes, scroll covers first and final candidates', () => {
    const index = createTimelineIndex(Array.from({ length: 2000 }, () => message(1001, 500)));
    const view = createTimelineView(index), cache = new TimelineDisplayCache(index);
    for (const id of ['0:500', '1000:500', '1999:1000', '1999:0']) {
        const window = timelineWindow(view, rectAt(view, id));
        assert.ok(window.nodeIds.includes(id), id);
        assert.ok(window.nodeIds.length < 60, window.nodeIds.length);
        cache.window(window.cacheIds);
        assert.ok(cache.entries.size < 400, cache.entries.size);
        const old = cache.get(id); cache.window(window.cacheIds); assert.equal(cache.get(id), old);
    }
});

test('cross-screen curves survive when both endpoint cards are unmounted', () => {
    const index = createTimelineIndex([message(), message(101)]), view = createTimelineView(index);
    const p = positionFor(view, '0:0'), q = positionFor(view, '1:100');
    const x = (p.x + q.x) / 2 + 112, y = (p.y + 116 + q.y) / 2;
    const window = timelineWindow(view, { left: x - 5, right: x + 5, top: y - 5, bottom: y + 5 }, { overscan: 0 });
    assert.deepEqual(window.nodeIds, []);
    const edge = window.edges.find(e => e.to === '1:100'); assert.ok(edge);
    assert.ok(edgePath(edge, view));
});

test('offscreen main path crossing a collapsed filter gap is retained', () => {
    const chat = [message(2), ...Array.from({ length: 100 }, () => message()), message(2)];
    const view = createTimelineView(createTimelineIndex(chat), { onlyBranches: true });
    const gap = view.entries.find(e => !e.floor);
    const w = timelineWindow(view, { left: view.centerX - 10, right: view.centerX + 10,
        top: gap.y + 10, bottom: gap.y + 20 }, { overscan: 0 });
    assert.equal(w.nodeIds.length, 0); assert.ok(w.edges.some(e => e.from === '0:0' && e.to === '101:0'));
    assert.equal(focusTimelineId(view, 50, 0), '0:0');
    assert.equal(focusTimelineId(view, 100, 0), '101:0');
});

test('analytic edge clipping prunes noncrossing horizontal fans without losing cubic samples', () => {
    const view = createTimelineView(createTimelineIndex([message(), message(10001)]));
    const from = positionFor(view, '0:0');
    for (const swipe of [1, 2, 77, 9999, 10000]) for (const t of [0.1, 0.5, 0.9]) {
        const to = positionFor(view, `1:${swipe}`), x1 = from.x + 112, y1 = from.y + 116;
        const x = x1 + (to.x + 112 - x1) * t * t * (3 - 2 * t);
        const y = y1 + (to.y - y1) * (1.5 * t - 1.5 * t * t + t * t * t);
        const w = timelineWindow(view, { left: x - 0.01, right: x + 0.01, top: y - 0.0001, bottom: y + 0.0001 }, { overscan: 0 });
        assert.ok(w.edges.some(e => e.to === `1:${swipe}`), `${swipe}@${t}`);
        assert.ok(w.edges.length < 10, `noncrossing fan should be culled: ${w.edges.length}`);
    }
});

test('incremental floor updates preserve unaffected record/cache identities and repair adjacent edges', () => {
    const chat = Array.from({ length: 30 }, () => message(3));
    const index = createTimelineIndex(chat), view = createTimelineView(index), cache = new TimelineDisplayCache(index);
    const oldFloor = index.byId.get(8), oldNode = cache.get('8:0'); cache.get('9:0');
    chat[9].swipe_id = 2; chat[9].mes = 'changed';
    assert.equal(index.update(9).layoutChanged, false); cache.invalidate(9);
    assert.equal(index.byId.get(8), oldFloor); assert.equal(cache.get('8:0'), oldNode);
    assert.equal(cache.get('9:2').summary, 'changed');
    const edges = timelineWindow(view, rectAt(view, '9:2')).edges;
    assert.ok(edges.some(e => e.from === '8:0' && e.to === '9:2' && e.type === 'current-selection'));
    assert.ok(edges.some(e => e.from === '9:2' && e.to === '10:0'));
    assert.ok(!edges.some(e => e.from === '9:0'));
    chat[9].swipes.push('new'); assert.equal(index.update(9).layoutChanged, true);
    assert.equal(index.stats.totalSwipes, 91);
    assert.equal(index.stats.candidates, 61);
    chat.push(message()); assert.equal(index.update(9).structural, true);
});

test('source and tail focus resolve without mounted cards, with hidden candidates fallback', () => {
    const index = createTimelineIndex(Array.from({ length: 2000 }, () => message(4, 2)));
    const view = createTimelineView(index);
    assert.equal(focusTimelineId(view, 1999, 3), '1999:3');
    assert.equal(focusTimelineId(view, 1999, 999), '1999:2');
    assert.equal(focusTimelineId(createTimelineView(index, { includeCandidates: false }), 1999, 3), '1999:2');
    assert.equal(focusTimelineId(createTimelineView(createTimelineIndex([])), 0, 0), null);
});

test('search scans unmounted floors and counts only actual filters as hidden', async () => {
    const chat = Array.from({ length: 3000 }, () => message()); chat[2999] = message(2, 0, 'needle current'); chat[2999].swipes[1] = 'needle candidate';
    const index = createTimelineIndex(chat), search = new TimelineSearch(index);
    const view = createTimelineView(index, { includeCandidates: false });
    const result = await search.search('needle', { visible: id => view.positions.has(id) });
    assert.deepEqual(result.matches, ['2999:0']); assert.equal(result.hidden, 1);
    assert.equal(result.all.size, 2); assert.ok(search.cache.size <= 512); assert.ok(search.chars <= search.maxChars);
});

test('normalized cache is bounded and invalidation touches only the edited floor', async () => {
    const chat = [message(2, 0, 'MiXeD'), message(2, 0, 'Mixed other')], index = createTimelineIndex(chat);
    const search = new TimelineSearch(index, { maxChars: 100, maxEntries: 4 });
    await search.search('mixed'); const other = search.cache.get('1:0');
    chat[0].mes = 'new needle'; index.update(0); search.invalidate(0);
    assert.equal(search.cache.get('1:0'), other); assert.ok(!search.cache.has('0:0'));
    const result = await search.search('needle', { floors: [index.byId.get(0)] });
    assert.deepEqual(result.matches, ['0:0']); assert.equal(search.cache.get('1:0'), other);
    const tiny = new TimelineSearch(index, { maxChars: 8, maxEntries: 1 }); await tiny.search('absent');
    assert.ok(tiny.chars <= 8); assert.ok(tiny.cache.size <= 1);
});

test('search yields on 8ms budget and an old query cannot publish after cancellation', async () => {
    const index = createTimelineIndex(Array.from({ length: 100 }, () => message(2)));
    let ticks = 0, yields = 0, release;
    const search = new TimelineSearch(index, { now: () => ticks += 2,
        pause: () => { yields++; return new Promise(resolve => { release = resolve; }); } });
    const task = search.search('swipe');
    assert.equal(yields, 1); search.cancel(); release(); assert.equal(await task, null);
    assert.ok(search.cache.size < 10);
});

test('huge bodies search in chunks including chunk boundaries, without cache residency', async () => {
    const text = 'x'.repeat(32766) + 'Needle' + 'y'.repeat(80000);
    const index = createTimelineIndex([message(1, 0, text)]);
    let ticks = 0, yields = 0;
    const search = new TimelineSearch(index, { now: () => ticks += 9, pause: async () => { yields++; } });
    assert.deepEqual((await search.search('needle')).matches, ['0:0']); assert.ok(yields > 0);
    assert.equal(search.cache.size, 0);
    assert.deepEqual((await search.search('y'.repeat(100))).matches, ['0:0']);
});
