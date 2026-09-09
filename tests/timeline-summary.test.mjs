import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimelineGraph, filterTimelineGraph, layoutTimelineGraph, timelineSummaryEntries } from '../timeline-graph.mjs';
const single = mes => ({ mes, name: 'AI', extra: {} });
const multi = (count, current = 0) => ({ ...single(`Reply ${current}`), swipes: Array.from({ length: count }, (_, i) => `Reply ${i}`), swipe_id: current });
function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
}

test('layout keeps normal boxes and spacing while compact gaps accumulate actual heights', () => {
    const graph = createTimelineGraph([single('start'), multi(2), multi(3, 1), single('middle'), multi(2, 1), single('end')]);
    const normal = layoutTimelineGraph(graph);
    assert.deepEqual(graph.path.map(id => normal.positions.get(id).y), [44, 232, 420, 608, 796, 984]);
    assert.ok([...normal.positions.values()].every(box => box.height === 116));
    const view = filterTimelineGraph(graph, { onlyBranches: true });
    for (const includeCandidates of [true, false]) {
        const layout = layoutTimelineGraph(view, { includeCandidates });
        assert.deepEqual(view.path.map(id => layout.positions.get(id).y), [86, 274, 446]);
        assert.deepEqual(layout.gaps.map(gap => [gap.y, gap.height]), [[58, 28], [418, 28], [590, 28]]);
        assert.equal(layout.height, 648);
        for (const floor of view.floors) for (const node of floor.nodes) {
            const box = layout.positions.get(node.id);
            if (box) assert.equal(box.y, layout.positions.get(floor.currentId).y, 'candidates share current row');
        }
    }
});

test('summary partitions ordinary runs independently from canvas filtering without mutation', () => {
    const graph = freeze(createTimelineGraph([single('start'), multi(3, 1), single('two'), single('three'),
        { ...multi(2), is_user: true }, multi(2, 1), single('six'), single('seven'), single('eight')]));
    const before = structuredClone(graph);
    const expected = [
        { kind: 'gap', id: '0:0', floors: [graph.floors[0]] },
        { kind: 'floor', floor: graph.floors[1] },
        { kind: 'gap', id: '2:3', floors: graph.floors.slice(2, 4) },
        { kind: 'floor', floor: graph.floors[4] },
        { kind: 'floor', floor: graph.floors[5] },
        { kind: 'gap', id: '6:8', floors: graph.floors.slice(6) },
    ];
    assert.deepEqual(timelineSummaryEntries(graph), expected);
    for (const options of [{ onlyChar: true }, { onlyBranches: true }, { onlyChar: true, onlyBranches: true }]) {
        layoutTimelineGraph(filterTimelineGraph(graph, options), { includeCandidates: false });
        assert.deepEqual(timelineSummaryEntries(graph), expected, 'source summary stays independent');
    }
    assert.deepEqual(graph, before);
    const entries = timelineSummaryEntries(graph);
    assert.equal(entries[1].floor, graph.floors[1], 'native floor metadata retained');
    assert.equal(entries[2].floors[0], graph.floors[2]);
    entries[2].floors.pop();
    assert.deepEqual(timelineSummaryEntries(graph), expected, 'fresh grouping arrays per call');
});

test('summary handles empty, all ordinary, singleton and adjacent junction chats', () => {
    assert.deepEqual(timelineSummaryEntries(createTimelineGraph([])), []);
    for (const count of [1, 4]) {
        const graph = freeze(createTimelineGraph(Array.from({ length: count }, (_, i) => single(`floor ${i}`))));
        assert.deepEqual(timelineSummaryEntries(graph), [{ kind: 'gap', id: `0:${count - 1}`, floors: graph.floors }]);
    }
    const graph = freeze(createTimelineGraph([multi(2), multi(4, 3)]));
    assert.deepEqual(timelineSummaryEntries(graph), graph.floors.map(floor => ({ kind: 'floor', floor })));
});
