// Swipe data operations mirror script.js: syncMesToSwipe / syncSwipeToMes.
// Keep these DOM-free so index and metadata remapping can be regression-tested.
const clone = value => structuredClone(value);

export function currentIndex(message) {
    const length = message.swipes?.length ?? 0;
    return Math.min(Math.max(Number.isInteger(message.swipe_id) ? message.swipe_id : 0, 0), Math.max(0, length - 1));
}

export function prepareSwipes(message) {
    if (!Array.isArray(message.swipes) || !message.swipes.length) throw new Error('当前消息没有分支数据');
    message.swipe_id = currentIndex(message);
    message.swipe_info = message.swipes.map((_, index) => {
        const info = message.swipe_info?.[index];
        return info && typeof info === 'object' ? clone(info) : {
            send_date: message.send_date, gen_started: undefined, gen_finished: undefined, extra: {},
        };
    });
    // The visible message may contain newer edits/reasoning/media than its cached swipe.
    message.swipes[message.swipe_id] = message.mes ?? message.swipes[message.swipe_id];
    Object.assign(message.swipe_info[message.swipe_id], {
        send_date: message.send_date,
        gen_started: message.gen_started,
        gen_finished: message.gen_finished,
        extra: clone(message.extra ?? {}),
    });
}

export function activateSwipe(message, index) {
    if (!Number.isInteger(index) || index < 0 || index >= message.swipes.length) throw new Error('目标分支不存在');
    const info = message.swipe_info?.[index];
    message.swipe_id = index;
    message.mes = message.swipes[index];
    message.send_date = info?.send_date;
    message.gen_started = info?.gen_started;
    message.gen_finished = info?.gen_finished;
    // Do not merge: media/reasoning/token counts of the previous swipe must not leak.
    message.extra = clone(info?.extra ?? {});
}

export function deleteSwipes(message, indices) {
    const removed = [...new Set(indices)].sort((a, b) => a - b);
    if (!removed.length) throw new Error('请先选择需要删除的分支');
    if (removed.some(i => !Number.isInteger(i) || i < 0 || i >= (message.swipes?.length ?? 0))) throw new Error('目标分支不存在');
    if (removed.length >= message.swipes.length) throw new Error('至少需要保留一个分支');
    prepareSwipes(message);
    const oldCurrent = message.swipe_id;
    const removedSet = new Set(removed);
    const kept = message.swipes.map((_, i) => i).filter(i => !removedSet.has(i));
    // Keep the active candidate if possible; otherwise choose the next, then previous survivor.
    const nextOld = kept.includes(oldCurrent) ? oldCurrent : (kept.find(i => i > oldCurrent) ?? kept.at(-1));
    message.swipes = kept.map(i => message.swipes[i]);
    message.swipe_info = kept.map(i => message.swipe_info[i]);
    activateSwipe(message, kept.indexOf(nextOld));
    return { removed, kept, current: message.swipe_id };
}

export function moveSwipe(message, from, to) {
    if (![from, to].every(i => Number.isInteger(i) && i >= 0 && i < (message.swipes?.length ?? 0))) throw new Error('目标分支下标越界');
    prepareSwipes(message);
    const current = message.swipe_id;
    for (const array of [message.swipes, message.swipe_info]) [array[from], array[to]] = [array[to], array[from]];
    activateSwipe(message, current === from ? to : current === to ? from : current);
}
