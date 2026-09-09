import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimelineGraph, buildTimelineGraph, layoutTimelineGraph, edgePath, edgePresentation,
    CURRENT_SELECTION, CANDIDATE_UNKNOWN, branchText, filterTimelineGraph, timelineFocusTarget } from '../timeline-graph.mjs';

const single = text => ({ name: 'AI', mes: text, extra: {} });
const multi = (count, current) => ({ name: 'AI', swipes: Array.from({ length: count }, (_, i) => `Reply ${i}`),
    swipe_id: current, mes: `Reply ${current}`, extra: {} });

test('current path explicitly represents floor 1 swipe 2 through floor 10 swipe 3', () => {
    const chat = Array.from({ length: 11 }, (_, i) => single(`floor ${i}`));
    chat[1] = multi(3, 1); chat[10] = multi(4, 2);
    const graph = createTimelineGraph(chat);
    assert.equal(graph.path[1], '1:1'); assert.equal(graph.path[10], '10:2');
    const edges = graph.edges.filter(e => e.type === CURRENT_SELECTION);
    assert.equal(edges.length, 10);
    for (let i = 0; i < edges.length; i++) {
        assert.equal(edges[i].from, graph.path[i]); assert.equal(edges[i].to, graph.path[i + 1]);
        assert.equal(edges[i].recordedAncestry, false);
    }
    assert.deepEqual(graph.stats, { floors: 11, totalSwipes: 16, multiSwipeFloors: 2, candidates: 5 });
});

test('candidate branches never claim descendants or recorded ancestry', () => {
    const graph = createTimelineGraph([single('start'), multi(3, 1), single('end')]);
    for (const candidate of graph.nodes.filter(n => !n.isCurrent)) {
        const incoming = graph.edges.find(e => e.to === candidate.id);
        assert.equal(incoming.type, CANDIDATE_UNKNOWN);
        assert.equal(incoming.recordedAncestry, false);
        assert.equal(graph.edges.some(e => e.from === candidate.id), false);
        assert.equal(edgePresentation(incoming.type).arrow, false);
    }
    assert.equal(edgePresentation('unknown-future-type').dashed, true);
});

test('empty and legacy single-message chats have no fabricated swipe or edges', () => {
    const empty = createTimelineGraph([]);
    assert.equal(empty.nodes.length, 0); assert.equal(empty.edges.length, 0);
    const graph = createTimelineGraph([single('one')]);
    assert.equal(graph.nodes.length, 1); assert.equal(graph.nodes[0].swipeRecorded, false);
    assert.equal(graph.nodes[0].swipeIdx, 0); assert.equal(graph.edges.length, 0);
    assert.equal(layoutTimelineGraph(empty).positions.size, 0);
});

test('identical text at different floors or swipes stays distinct', () => {
    const message = { swipes: ['same', 'same'], swipe_id: 1, mes: 'same' };
    const graph = createTimelineGraph([message, structuredClone(message)]);
    assert.equal(new Set(graph.nodes.map(n => n.id)).size, 4);
    assert.deepEqual(graph.path, ['0:1', '1:1']);
});

test('graph construction is read only and current text uses latest mes', () => {
    const chat = [multi(3, 1)]; chat[0].mes = 'latest edit';
    const before = structuredClone(chat);
    const graph = createTimelineGraph(chat);
    assert.deepEqual(chat, before);
    assert.equal(branchText(chat[0], 1), 'latest edit');
    assert.equal(graph.nodes.find(n => n.isCurrent).summary, 'latest edit');
    assert.equal(branchText(chat[0], 0), 'Reply 0');
});

test('layout reserves non-overlapping boxes and keeps current nodes on one axis', () => {
    const graph = createTimelineGraph([multi(8, 5), multi(3, 1), single('end')]);
    const layout = layoutTimelineGraph(graph);
    const current = graph.path.map(id => layout.positions.get(id));
    assert.equal(new Set(current.map(p => p.x)).size, 1);
    for (const floor of graph.floors) {
        const positions = floor.nodes.map(n => layout.positions.get(n.id)).sort((a, b) => a.x - b.x);
        for (let i = 1; i < positions.length; i++) assert.ok(positions[i].x >= positions[i - 1].x + positions[i - 1].width);
    }
    for (const position of layout.positions.values()) {
        assert.ok(position.x >= 0 && position.y >= 0);
        assert.ok(position.x + position.width <= layout.width);
        assert.ok(position.y + position.height <= layout.height);
    }
    for (const edge of graph.edges) assert.match(edgePath(edge, layout), /^M .+ C /);
});

test('current-only layout hides candidates without rewiring graph', () => {
    const graph = createTimelineGraph([single('start'), multi(4, 2), single('end')]);
    const before = structuredClone(graph.edges);
    const layout = layoutTimelineGraph(graph, { includeCandidates: false });
    assert.deepEqual([...layout.positions.keys()], graph.path);
    for (const edge of graph.edges) assert.equal(edgePath(edge, layout) === null, edge.type === CANDIDATE_UNKNOWN);
    assert.deepEqual(graph.edges, before);
});

test('incremental generator yields each node and returns same complete graph', () => {
    const chat = [multi(4, 2), single('end')];
    const generator = buildTimelineGraph(chat);
    let count = 0, step;
    do { step = generator.next(); if (!step.done) count++; } while (!step.done);
    assert.equal(count, 5);
    assert.deepEqual(step.value, createTimelineGraph(chat));
});

const mixedChat = () => [
    { ...single('system'), is_system: true }, multi(3, 1),
    { ...single('user'), is_user: true }, single('char single'),
    { ...multi(2, 0), is_user: true }, multi(2, 1),
    { ...single('user tail'), is_user: true }, { ...single('system tail'), is_system: true },
    single('char tail'),
];

function freezeDeep(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freezeDeep); Object.freeze(value); }
    return value;
}

test('unfiltered projection preserves native IDs, edges, stats and leaves frozen input untouched', () => {
    const chat = freezeDeep(mixedChat());
    const graph = freezeDeep(createTimelineGraph(chat));
    const before = structuredClone(graph);
    const view = filterTimelineGraph(graph);
    assert.deepEqual(view.nodes, graph.nodes);
    assert.deepEqual(view.floors, graph.floors);
    assert.deepEqual(view.edges, graph.edges);
    assert.deepEqual(view.path, graph.path);
    assert.deepEqual(view.stats, graph.stats);
    assert.deepEqual(view.gaps, []);
    assert.equal(view.displayRows, graph.floors.length);
    assert.deepEqual(graph, before);
});

test('char and branch-junction filters are independent and compose by intersection', () => {
    const graph = createTimelineGraph(mixedChat());
    for (const [options, ids, stats] of [
        [{ onlyChar: true }, [1, 3, 5, 8], { floors: 4, totalSwipes: 7, multiSwipeFloors: 2, candidates: 3 }],
        [{ onlyBranches: true }, [1, 4, 5], { floors: 3, totalSwipes: 7, multiSwipeFloors: 3, candidates: 4 }],
        [{ onlyChar: true, onlyBranches: true }, [1, 5], { floors: 2, totalSwipes: 5, multiSwipeFloors: 2, candidates: 3 }],
    ]) {
        const view = filterTimelineGraph(graph, options);
        assert.deepEqual(view.floors.map(f => f.mesId), ids);
        assert.deepEqual(view.path, ids.map(id => graph.floors[id].currentId));
        assert.deepEqual(view.stats, stats);
        for (const node of view.nodes) assert.equal(node.id, `${node.mesId}:${node.swipeIdx}`);
    }
});

test('leading, internal and trailing omissions become display-only gaps without fabricated nodes', () => {
    const graph = freezeDeep(createTimelineGraph(mixedChat()));
    const view = filterTimelineGraph(graph, { onlyChar: true, onlyBranches: true });
    assert.deepEqual(view.gaps, [
        { id: 'gap:0', order: 0, count: 1, firstMesId: 0, lastMesId: 0, afterId: null, beforeId: '1:1' },
        { id: 'gap:2', order: 2, count: 3, firstMesId: 2, lastMesId: 4, afterId: '1:1', beforeId: '5:1' },
        { id: 'gap:6', order: 4, count: 3, firstMesId: 6, lastMesId: 8, afterId: '5:1', beforeId: null },
    ]);
    assert.deepEqual(view.floors.map(f => f.order), [1, 3]);
    assert.equal(view.displayRows, 5);
    assert.ok(view.nodes.every(n => !n.id.startsWith('gap:')));
    const layout = layoutTimelineGraph(view);
    assert.equal(layout.gaps.length, 3);
    assert.equal(layout.positions.size, 5);
    const ys = [layout.gaps[0].y, layout.positions.get('1:1').y, layout.gaps[1].y,
        layout.positions.get('5:1').y, layout.gaps[2].y];
    assert.deepEqual([...ys].sort((a, b) => a - b), ys);
    assert.deepEqual(ys, [58, 86, 230, 258, 402], 'gap y is its center; normal y is its top');
    assert.ok(layout.gaps.every(gap => gap.height === 28));
    assert.equal(layout.height, 460, 'height accumulates actual compact rows and padding');
    assert.ok(layout.gaps.at(-1).y < layout.height);
    assert.equal(graph.floors.length, 9);
});

test('filtered edges reconnect visible current path and unknown candidates, never candidate descendants', () => {
    const view = filterTimelineGraph(createTimelineGraph(mixedChat()), { onlyChar: true, onlyBranches: true });
    assert.deepEqual(view.edges.map(e => [e.from, e.to, e.type]), [
        ['1:1', '5:0', CANDIDATE_UNKNOWN], ['1:1', '5:1', CURRENT_SELECTION],
    ]);
    for (const edge of view.edges) {
        assert.equal(edge.recordedAncestry, false);
        assert.ok(view.path.includes(edge.from));
        assert.equal(edgePresentation(edge.type).arrow, edge.type === CURRENT_SELECTION);
    }
    const layout = layoutTimelineGraph(view, { includeCandidates: false });
    assert.deepEqual([...layout.positions.keys()], view.path);
    assert.equal(layout.gaps.length, 3);
    for (const edge of view.edges) assert.equal(edgePath(edge, layout) === null, edge.type === CANDIDATE_UNKNOWN);
});

test('all-hidden and empty projections stay safe and expose no focus target or fake ancestry', () => {
    for (const graph of [createTimelineGraph([]), createTimelineGraph([single('one'), single('two')])]) {
        const view = filterTimelineGraph(graph, { onlyBranches: true });
        assert.deepEqual(view.nodes, []); assert.deepEqual(view.path, []); assert.deepEqual(view.edges, []);
        assert.deepEqual(view.stats, { floors: 0, totalSwipes: 0, multiSwipeFloors: 0, candidates: 0 });
        assert.equal(view.gaps.length, graph.floors.length ? 1 : 0);
        if (view.gaps.length) { assert.equal(view.gaps[0].count, 2); assert.equal(view.gaps[0].beforeId, null); }
        assert.equal(layoutTimelineGraph(view).positions.size, 0);
        assert.equal(timelineFocusTarget(view, 1, 0), null);
    }
    assert.equal(timelineFocusTarget(null, 1, 0), null);
});

test('focus targets requested candidate or current swipe, then nearest native visible floor', () => {
    const view = freezeDeep(filterTimelineGraph(createTimelineGraph(mixedChat()), { onlyChar: true, onlyBranches: true }));
    assert.equal(timelineFocusTarget(view, 5, 0), '5:0');
    assert.equal(timelineFocusTarget(view, 5, 0, false), '5:1');
    assert.equal(timelineFocusTarget(view, 5, 99), '5:1');
    assert.equal(timelineFocusTarget(view, 5, undefined), '5:1');
    assert.equal(timelineFocusTarget(view, 4, 0), '5:1', 'hidden floor does not reuse its swipe index');
    assert.equal(timelineFocusTarget(view, 3, 0), '1:1', 'ties choose earlier visible floor');
    assert.equal(timelineFocusTarget(view, -100, 0), '1:1');
    assert.equal(timelineFocusTarget(view, 100, 0), '5:1');
    assert.equal(timelineFocusTarget(view, undefined, 0), '1:1');
    assert.equal(timelineFocusTarget(view, NaN, 0), '1:1');
});
