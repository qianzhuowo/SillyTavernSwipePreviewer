// Lightweight floor index. No per-swipe objects or normalized bodies live in the global index.
import { countSwipes, currentSwipe, snippet, branchText, CURRENT_SELECTION, CANDIDATE_UNKNOWN } from './timeline-graph.mjs';
const W = 224, H = 116, STEP = 260, PAD = 44;
const clock = () => globalThis.performance?.now() ?? Date.now();
export function floorRecord(message, mesId, version = 0) {
    if (!message || typeof message !== 'object') return null;
    const count = countSwipes(message), selected = currentSwipe(message);
    return { mesId, count, currentSwipe: selected, currentId: `${mesId}:${selected}`, version,
        role: message.is_system ? '系统' : message.is_user ? '用户' : '角色',
        name: typeof message.name === 'string' ? snippet(message.name, 60) : '未命名' };
}
function addStats(stats, floor, sign) {
    if (!floor) return;
    stats.floors += sign; stats.totalSwipes += sign * floor.count;
    stats.candidates += sign * (floor.count - 1); stats.multiSwipeFloors += sign * Number(floor.count > 1);
}
export class TimelineIndex {
    constructor(chat) {
        this.chat = chat; this.floors = []; this.byId = new Map();
        this.stats = { floors: 0, totalSwipes: 0, candidates: 0, multiSwipeFloors: 0 };
        this.length = chat.length;
    }
    *build() {
        for (let id = 0; id < this.chat.length; id++) {
            const floor = floorRecord(this.chat[id], id);
            if (floor) { this.floors.push(floor); this.byId.set(id, floor); addStats(this.stats, floor, 1); }
            yield id;
        }
        return this;
    }
    update(id) {
        const old = this.byId.get(id), next = floorRecord(this.chat[id], id, (old?.version ?? 0) + 1);
        if (this.chat.length !== this.length || !old || !next) return { structural: true };
        addStats(this.stats, old, -1); addStats(this.stats, next, 1);
        // Keep the record identity: projections, summary chips and neighbors reference it.
        const layoutChanged = old.count !== next.count || old.role !== next.role;
        Object.assign(old, next);
        return { structural: false, layoutChanged, floor: old };
    }
    node(id) {
        const [mesId, swipeIdx] = String(id).split(':').map(Number), floor = this.byId.get(mesId);
        if (!floor || !Number.isInteger(swipeIdx) || swipeIdx < 0 || swipeIdx >= floor.count) return null;
        const isCurrent = swipeIdx === floor.currentSwipe;
        return { ...floor, id: `${mesId}:${swipeIdx}`, swipeIdx, isCurrent,
            label: `#${mesId} 分支${swipeIdx + 1}`, summary: snippet(branchText(this.chat[mesId], swipeIdx)) };
    }
}
export function createTimelineIndex(chat) {
    const index = new TimelineIndex(chat); for (const _ of index.build()) { /* synchronous test convenience */ } return index;
}
function lowerBound(entries, value, key) {
    let lo = 0, hi = entries.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (key(entries[mid]) < value) lo = mid + 1; else hi = mid; }
    return lo;
}
export function createTimelineView(index, { onlyChar = false, onlyBranches = false, includeCandidates = true } = {}) {
    const floors = [], entries = [], byId = new Map();
    let gap = null, maxCount = 1;
    const stats = { floors: 0, totalSwipes: 0, candidates: 0, multiSwipeFloors: 0 };
    for (const floor of index.floors) {
        if ((onlyChar && floor.role !== '角色') || (onlyBranches && floor.count <= 1)) {
            if (!gap) { gap = { id: `gap:${floor.mesId}`, firstMesId: floor.mesId, lastMesId: floor.mesId, count: 0, height: 28 }; entries.push(gap); }
            gap.count++; gap.lastMesId = floor.mesId; continue;
        }
        gap = null;
        const entry = { floor, height: H, index: floors.length };
        floors.push(floor); entries.push(entry); byId.set(floor.mesId, entry);
        maxCount = Math.max(maxCount, floor.count); addStats(stats, floor, 1);
    }
    let y = PAD;
    entries.forEach((entry, i) => { entry.y = y; y += entry.height;
        if (i + 1 < entries.length) y += !entry.floor || !entries[i + 1].floor ? 14 : 72; });
    const centerX = PAD + (includeCandidates ? Math.ceil((maxCount - 1) / 2) : 0) * STEP + W / 2;
    const view = { index, floors, entries, byId, stats, includeCandidates, centerX,
        width: centerX * 2, height: Math.max(240, y + PAD), nodeWidth: W, nodeHeight: H };
    view.positions = { get: id => positionFor(view, id), has: id => Boolean(positionFor(view, id)) };
    return view;
}
export function positionFor(view, id) {
    const [mesId, swipe] = String(id).split(':').map(Number), entry = view.byId.get(mesId);
    if (!entry || !Number.isInteger(swipe) || swipe < 0 || swipe >= entry.floor.count) return null;
    const selected = entry.floor.currentSwipe;
    if (!view.includeCandidates && swipe !== selected) return null;
    const candidate = swipe < selected ? swipe + 1 : swipe;
    const lane = swipe === selected ? 0 : Math.ceil(candidate / 2) * (candidate % 2 ? -1 : 1);
    return { x: view.centerX - W / 2 + lane * STEP, y: entry.y, width: W, height: H };
}
export function focusTimelineId(view, mesId, swipeIdx) {
    if (!view?.floors.length) return null;
    let n = Number.isInteger(mesId) ? lowerBound(view.floors, mesId, f => f.mesId) : 0;
    n = Math.min(n, view.floors.length - 1);
    if (n && Math.abs(view.floors[n - 1].mesId - mesId) <= Math.abs(view.floors[n].mesId - mesId)) n--;
    const f = view.floors[n];
    return f.mesId === mesId && view.includeCandidates && Number.isInteger(swipeIdx) && swipeIdx >= 0 && swipeIdx < f.count
        ? `${f.mesId}:${swipeIdx}` : f.currentId;
}
function swipeAtLane(floor, lane) {
    if (!lane) return floor.currentSwipe;
    const candidate = Math.abs(lane) * 2 - (lane < 0 ? 1 : 0);
    if (candidate >= floor.count) return -1;
    return candidate <= floor.currentSwipe ? candidate - 1 : candidate;
}
function visibleSwipes(view, floor, rect) {
    if (!view.includeCandidates) return view.centerX + W / 2 >= rect.left && view.centerX - W / 2 <= rect.right ? [floor.currentSwipe] : [];
    const min = Math.max(-Math.ceil((floor.count - 1) / 2), Math.ceil((rect.left - view.centerX - W / 2) / STEP));
    const max = Math.min(Math.floor((floor.count - 1) / 2), Math.floor((rect.right - view.centerX + W / 2) / STEP));
    const result = [];
    for (let lane = min; lane <= max; lane++) { const swipe = swipeAtLane(floor, lane); if (swipe >= 0) result.push(swipe); }
    return result;
}
// Cubic y is monotone: y(t)=y1+(y2-y1)*(1.5t-1.5t²+t³).
// Invert once per floor, then analytically restrict candidate lanes at the visible y interval.
function edgeSwipes(view, floor, y1, y2, box) {
    if (y2 < box.top || y1 > box.bottom) return [];
    const invert = (y, upper) => {
        if (y <= y1) return 0; if (y >= y2) return 1;
        const ratio = (y - y1) / (y2 - y1);
        let lo = 0, hi = 1;
        for (let i = 0; i < 24; i++) { const t = (lo + hi) / 2;
            if (1.5 * t - 1.5 * t * t + t * t * t < ratio) lo = t; else hi = t; }
        return upper ? hi : lo; // conservative rounding cannot discard a crossing
    };
    const smooth = t => t * t * (3 - 2 * t);
    const s0 = smooth(invert(box.top, false)), s1 = smooth(invert(box.bottom, true));
    const result = box.left <= view.centerX && view.centerX <= box.right ? [floor.currentSwipe] : [];
    if (!view.includeCandidates) return result;
    for (const sign of [-1, 1]) {
        const low = sign > 0 ? box.left - view.centerX : view.centerX - box.right;
        const high = sign > 0 ? box.right - view.centerX : view.centerX - box.left;
        if (high < 0 || (!s1 && low > 0)) continue;
        const maxLane = sign > 0 ? Math.floor((floor.count - 1) / 2) : Math.ceil((floor.count - 1) / 2);
        const first = s1 ? Math.max(1, Math.ceil(low / (STEP * s1) - 1e-9)) : 1;
        const last = s0 ? Math.min(maxLane, Math.floor(high / (STEP * s0) + 1e-9)) : maxLane;
        for (let lane = first; lane <= last; lane++) result.push(swipeAtLane(floor, lane * sign));
    }
    return result;
}
/** All crossing edges survive even when both endpoint cards are outside the window.
 * Candidate fan-out is batched per floor by the renderer, not one SVG element per swipe. */
export function timelineWindow(view, rect, { overscan = 180, cacheFloors = 20 } = {}) {
    const box = { left: rect.left - overscan, right: rect.right + overscan, top: rect.top - overscan, bottom: rect.bottom + overscan };
    const start = lowerBound(view.entries, box.top, e => e.y + e.height);
    const end = lowerBound(view.entries, box.bottom + 1, e => e.y);
    const nodeIds = [], cacheIds = [], gaps = [], edges = [];
    for (let i = Math.max(0, start - cacheFloors); i < Math.min(view.entries.length, end + cacheFloors); i++) {
        const e = view.entries[i];
        if (!e.floor) { if (i >= start && i < end) gaps.push({ ...e, x: view.centerX, y: e.y + 14 }); continue; }
        for (const swipe of visibleSwipes(view, e.floor, box)) {
            const id = `${e.floor.mesId}:${swipe}`; cacheIds.push(id); if (i >= start && i < end) nodeIds.push(id);
        }
    }
    // First target after bottom is essential: its incoming edge may cross the entire viewport.
    const firstFloor = Math.max(1, lowerBound(view.floors, box.top, f => view.byId.get(f.mesId).y));
    for (let n = firstFloor; n < view.floors.length; n++) {
        const target = view.floors[n], previous = view.floors[n - 1];
        const from = positionFor(view, previous.currentId), to = positionFor(view, target.currentId);
        if (from.y + H > box.bottom) break;
        if (to.y < box.top) continue;
        for (const swipe of edgeSwipes(view, target, from.y + H, to.y, box)) {
            const id = `${target.mesId}:${swipe}`;
            edges.push({ id: `${previous.currentId}>${id}`, from: previous.currentId, to: id,
                type: swipe === target.currentSwipe ? CURRENT_SELECTION : CANDIDATE_UNKNOWN });
        }
    }
    return { nodeIds, cacheIds, gaps, edges };
}
export class TimelineDisplayCache {
    constructor(index) { this.index = index; this.entries = new Map(); }
    window(ids) {
        const keep = new Set(ids);
        for (const id of this.entries.keys()) if (!keep.has(id)) this.entries.delete(id);
        for (const id of keep) this.get(id);
    }
    get(id) {
        const floor = this.index.byId.get(Number(id.split(':')[0]));
        const old = this.entries.get(id);
        if (old && old.version === floor?.version) return old;
        const node = this.index.node(id); if (node) this.entries.set(id, node); return node;
    }
    invalidate(mesId) { for (const [id, node] of this.entries) if (node.mesId === mesId) this.entries.delete(id); }
}
/** LRU bounded by both UTF-16 characters and entries, invalidation is floor-local. */
export class TimelineSearch {
    constructor(index, { maxChars = 2 * 1024 * 1024, maxEntries = 512, sliceMs = 8,
        now = clock, pause = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
        Object.assign(this, { index, maxChars, maxEntries, sliceMs, now, pause });
        this.cache = new Map(); this.floorKeys = new Map(); this.chars = 0; this.run = 0;
    }
    cancel() { this.run++; }
    remove(key) {
        const item = this.cache.get(key); if (!item) return;
        this.chars -= item.text.length; this.cache.delete(key);
        const keys = this.floorKeys.get(item.mesId); keys?.delete(key); if (!keys?.size) this.floorKeys.delete(item.mesId);
    }
    invalidate(mesId) { this.cancel(); for (const key of [...(this.floorKeys.get(mesId) ?? [])]) this.remove(key); }
    normalized(floor, swipe) {
        const key = `${floor.mesId}:${swipe}`, hit = this.cache.get(key);
        if (hit?.version === floor.version) { this.cache.delete(key); this.cache.set(key, hit); return hit.text; }
        this.remove(key);
        const text = branchText(this.index.chat[floor.mesId], swipe).toLowerCase();
        if (text.length <= this.maxChars && this.maxEntries > 0) {
            while (this.cache.size && (this.chars + text.length > this.maxChars || this.cache.size >= this.maxEntries)) this.remove(this.cache.keys().next().value);
            this.cache.set(key, { text, mesId: floor.mesId, version: floor.version }); this.chars += text.length;
            if (!this.floorKeys.has(floor.mesId)) this.floorKeys.set(floor.mesId, new Set()); this.floorKeys.get(floor.mesId).add(key);
        }
        return text;
    }
    async search(query, { current = () => true, visible = () => true, floors = this.index.floors } = {}) {
        const run = ++this.run, valid = () => run === this.run && current();
        query = query.trim().toLowerCase();
        const matches = [], all = new Set(); let hidden = 0, deadline = this.now() + this.sliceMs;
        if (!query) return { matches, all, hidden };
        for (const floor of floors) {
            for (let swipe = 0; swipe < floor.count; swipe++) {
                if (!valid()) return null;
                const id = `${floor.mesId}:${swipe}`;
                const metadata = `#${floor.mesId} 分支${swipe + 1} 楼层 ${floor.mesId} ${floor.name} ${floor.role}`.toLowerCase();
                let match = metadata.includes(query);
                const raw = branchText(this.index.chat[floor.mesId], swipe);
                if (!match && raw.length <= 65536) match = this.normalized(floor, swipe).includes(query);
                else if (!match) {
                    // Huge single swipes cannot monopolize a task or occupy the entire LRU.
                    // Carry normalized suffix across chunks so boundary-spanning queries still match.
                    let suffix = '';
                    for (let offset = 0; offset < raw.length && !match; offset += 32768) {
                        if (!valid()) return null;
                        const text = suffix + raw.slice(offset, offset + 32768).toLowerCase();
                        match = text.includes(query); suffix = query.length > 1 ? text.slice(-(query.length - 1)) : '';
                        if (this.now() >= deadline) { await this.pause(); if (!valid()) return null; deadline = this.now() + this.sliceMs; }
                    }
                }
                if (match) {
                    all.add(id); if (visible(id)) matches.push(id); else hidden++;
                }
                if (this.now() >= deadline) { await this.pause(); if (!valid()) return null; deadline = this.now() + this.sliceMs; }
            }
        }
        return valid() ? { matches, all, hidden } : null;
    }
}
