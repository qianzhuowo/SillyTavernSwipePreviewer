// Read-only, single-chat graph. No text deduplication and no inferred generation ancestry.
export const CURRENT_SELECTION = 'current-selection';
export const CANDIDATE_UNKNOWN = 'candidate-unknown';
export const PATH_LABEL = '当前选择路径 ≠ 已记录生成血缘';
export const CANDIDATE_LABEL = '同层候选归属；生成血缘 / 续接未知';

export function countSwipes(message) {
    return Array.isArray(message?.swipes) && message.swipes.length ? message.swipes.length : 1;
}

export function currentSwipe(message) {
    return Number.isInteger(message?.swipe_id) && message.swipe_id >= 0
        && message.swipe_id < countSwipes(message) ? message.swipe_id : 0;
}

export function branchText(message, index) {
    const value = index === currentSwipe(message)
        ? (message?.mes ?? message?.swipes?.[index]) : message?.swipes?.[index];
    return typeof value === 'string' ? value : '';
}

export function snippet(text, limit = 160) {
    const bounded = text.slice(0, limit * 2).replace(/\s+/g, ' ').trim();
    return (bounded.slice(0, limit) || '（空内容）') + (bounded.length > limit || text.length > limit * 2 ? '…' : '');
}

/** Generator lets browser callers yield while building even a many-swipe floor. */
export function* buildTimelineGraph(chat = []) {
    const graph = { nodes: [], edges: [], floors: [], path: [], pathLabel: PATH_LABEL,
        stats: { floors: 0, totalSwipes: 0, multiSwipeFloors: 0, candidates: 0 } };
    let previous = null;
    for (let mesId = 0; mesId < chat.length; mesId++) {
        const message = chat[mesId];
        if (!message || typeof message !== 'object') continue;
        const count = countSwipes(message);
        const selected = currentSwipe(message);
        const role = message.is_system ? '系统' : message.is_user ? '用户' : '角色';
        const name = typeof message.name === 'string' ? snippet(message.name, 60) : '未命名';
        const floor = { mesId, count, currentSwipe: selected, currentId: `${mesId}:${selected}`,
            role, name, order: graph.floors.length, nodes: [] };
        graph.floors.push(floor);
        graph.path.push(floor.currentId);
        graph.stats.floors++;
        graph.stats.totalSwipes += count;
        graph.stats.candidates += count - 1;
        if (count > 1) graph.stats.multiSwipeFloors++;
        let candidateIndex = 0;
        for (let swipeIdx = 0; swipeIdx < count; swipeIdx++) {
            const isCurrent = swipeIdx === selected;
            const node = { id: `${mesId}:${swipeIdx}`, mesId, swipeIdx, isCurrent, count,
                role, name, order: floor.order, lane: isCurrent ? 0 : ++candidateIndex,
                swipeRecorded: Array.isArray(message.swipes) && message.swipes.length > 0,
                label: `#${mesId} 分支${swipeIdx + 1}`,
                summary: snippet(branchText(message, swipeIdx)) };
            graph.nodes.push(node);
            floor.nodes.push(node);
            if (previous !== null) graph.edges.push({
                id: `${previous}>${node.id}`, from: previous, to: node.id,
                type: isCurrent ? CURRENT_SELECTION : CANDIDATE_UNKNOWN,
                label: isCurrent ? PATH_LABEL : CANDIDATE_LABEL,
                // Neither relation claims a historical parent or a saved continuation.
                recordedAncestry: false,
            });
            yield node;
        }
        previous = floor.currentId;
    }
    return graph;
}

export function createTimelineGraph(chat = []) {
    const builder = buildTimelineGraph(chat);
    let step;
    do { step = builder.next(); } while (!step.done);
    return step.value;
}

/** Display-only projection: preserve native IDs and explicitly mark collapsed floors. */
export function filterTimelineGraph(graph, { onlyChar = false, onlyBranches = false } = {}) {
    const view = { ...graph, floors: [], nodes: [], edges: [], path: [], gaps: [],
        stats: { floors: 0, totalSwipes: 0, multiSwipeFloors: 0, candidates: 0 } };
    let previous = null;
    let omitted = [];
    let order = 0;
    const flushGap = (beforeId = null) => {
        if (!omitted.length) return;
        view.gaps.push({ id: `gap:${omitted[0].mesId}`, order: order++, count: omitted.length,
            firstMesId: omitted[0].mesId, lastMesId: omitted.at(-1).mesId,
            afterId: previous, beforeId });
        omitted = [];
    };
    for (const floor of graph.floors) {
        if ((onlyChar && floor.role !== '角色') || (onlyBranches && floor.count <= 1)) {
            omitted.push(floor);
            continue;
        }
        flushGap(floor.currentId);
        const nodes = floor.nodes.map(node => ({ ...node, order }));
        view.floors.push({ ...floor, order: order++, nodes });
        for (const node of nodes) view.nodes.push(node);
        view.path.push(floor.currentId);
        view.stats.floors++;
        view.stats.totalSwipes += floor.count;
        view.stats.candidates += floor.count - 1;
        if (floor.count > 1) view.stats.multiSwipeFloors++;
        for (const node of nodes) {
            if (previous !== null) view.edges.push({ id: `${previous}>${node.id}`,
                from: previous, to: node.id,
                type: node.isCurrent ? CURRENT_SELECTION : CANDIDATE_UNKNOWN,
                label: node.isCurrent ? PATH_LABEL : CANDIDATE_LABEL, recordedAncestry: false });
        }
        previous = floor.currentId;
    }
    flushGap();
    view.displayRows = order;
    return view;
}

/** Compact header summary is independent of the canvas filters. */
export function timelineSummaryEntries(graph) {
    const entries = [];
    let ordinary = [];
    const flush = () => {
        if (!ordinary.length) return;
        entries.push({ kind: 'gap', id: `${ordinary[0].mesId}:${ordinary.at(-1).mesId}`, floors: ordinary });
        ordinary = [];
    };
    for (const floor of graph.floors) {
        if (floor.count > 1) {
            flush();
            entries.push({ kind: 'floor', floor });
        } else ordinary.push(floor);
    }
    flush();
    return entries;
}

/** Resolve hidden source floors/swipes to the nearest visible current-path node. */
export function timelineFocusTarget(graph, mesId, swipeIdx, includeCandidates = true) {
    if (!graph?.floors.length) return null;
    const floor = Number.isInteger(mesId)
        ? graph.floors.reduce((best, item) => Math.abs(item.mesId - mesId) < Math.abs(best.mesId - mesId) ? item : best)
        : graph.floors[0];
    const requested = floor.mesId === mesId && includeCandidates
        ? floor.nodes.find(node => node.swipeIdx === swipeIdx) : null;
    return requested?.id ?? floor.currentId;
}

/** Fixed-size boxes, main path on the center axis, candidates on alternating sides. */
export function layoutTimelineGraph(graph, { includeCandidates = true } = {}) {
    const nodeWidth = 224;
    const nodeHeight = 116;
    const columnGap = 36;
    const rowGap = 72;
    const padding = 44;
    let lanes = 0;
    if (includeCandidates) {
        for (const floor of graph.floors) lanes = Math.max(lanes, Math.ceil((floor.count - 1) / 2));
    }
    const centerX = padding + lanes * (nodeWidth + columnGap) + nodeWidth / 2;
    const width = centerX * 2;
    const gapHeight = 28;
    const gapSpacing = 14;
    const entries = [...graph.floors, ...(graph.gaps ?? [])].sort((a, b) => a.order - b.order);
    const rowPositions = new Map();
    let y = padding;
    for (let index = 0; index < entries.length; index++) {
        const entry = entries[index];
        const isGap = entry.firstMesId !== undefined;
        rowPositions.set(entry.order, y);
        y += isGap ? gapHeight : nodeHeight;
        const next = entries[index + 1];
        if (next) y += isGap || next.firstMesId !== undefined ? gapSpacing : rowGap;
    }
    const height = Math.max(240, y + padding);
    const positions = new Map();
    for (const node of graph.nodes) {
        if (!includeCandidates && !node.isCurrent) continue;
        const lane = node.isCurrent ? 0 : Math.ceil(node.lane / 2) * (node.lane % 2 ? -1 : 1);
        positions.set(node.id, { x: centerX - nodeWidth / 2 + lane * (nodeWidth + columnGap),
            y: rowPositions.get(node.order), width: nodeWidth, height: nodeHeight });
    }
    const gaps = (graph.gaps ?? []).map(gap => ({ ...gap, x: centerX,
        y: rowPositions.get(gap.order) + gapHeight / 2, height: gapHeight }));
    return { width, height, centerX, positions, gaps, nodeWidth, nodeHeight };
}

/** Unknown future relation types must never inherit a solid/path appearance. */
export function edgePresentation(type) {
    return type === CURRENT_SELECTION
        ? { dashed: false, arrow: true, label: PATH_LABEL }
        : { dashed: true, arrow: false, label: CANDIDATE_LABEL };
}

export function edgePath(edge, layout) {
    const from = layout.positions.get(edge.from);
    const to = layout.positions.get(edge.to);
    if (!from || !to) return null;
    const x1 = from.x + from.width / 2;
    const y1 = from.y + from.height;
    const x2 = to.x + to.width / 2;
    const y2 = to.y;
    const middle = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${middle}, ${x2} ${middle}, ${x2} ${y2}`;
}
