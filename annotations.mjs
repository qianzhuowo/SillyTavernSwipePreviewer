import { currentIndex, prepareSwipes } from './swipe-data.mjs';
export const ANNOTATION_KEY = 'swipe_previewer';
export function normalizeAnnotation(value) {
    return {
        name: typeof value?.name === 'string' ? value.name.slice(0, 120).trim() : '',
        note: typeof value?.note === 'string' ? value.note.slice(0, 4000).replace(/\r\n?/g, '\n') : '',
        favorite: value?.favorite === true,
    };
}
export function getAnnotation(message, index) {
    const extra = index === currentIndex(message) ? message?.extra : message?.swipe_info?.[index]?.extra;
    return normalizeAnnotation(extra?.[ANNOTATION_KEY]);
}
export function setAnnotation(message, index, value) {
    if (message.tt_swipe_cold) throw new Error('请先完整加载分支');
    const count = message.swipes?.length || 1;
    if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error('目标分支不存在');
    const annotation = normalizeAnnotation(value);
    const write = extra => {
        if (annotation.name || annotation.note || annotation.favorite) extra[ANNOTATION_KEY] = structuredClone(annotation);
        else delete extra[ANNOTATION_KEY];
    };
    if (message.swipes?.length) {
        prepareSwipes(message);
        const info = message.swipe_info[index];
        info.extra ??= {};
        write(info.extra);
    }
    if (index === currentIndex(message)) { message.extra ??= {}; write(message.extra); }
    return annotation;
}
// Optimistic compensation for timeline metadata only. Never restore a whole message:
// native listeners may have edited/generated body text while save was awaiting them.
export function createAnnotationRollback(message, index) {
    const owns = (object, key) => Object.prototype.hasOwnProperty.call(object ?? {}, key);
    const field = extra => ({ has: owns(extra, ANNOTATION_KEY), value: structuredClone(extra?.[ANNOTATION_KEY]) });
    const container = owner => ({ has: owns(owner, 'extra'), value: owner?.extra,
        annotation: field(owner?.extra) });
    const swipes = message.swipes, length = swipes?.length, selected = currentIndex(message);
    const targetText = swipes?.[index];
    const oldMessage = container(message), oldInfo = container(message.swipe_info?.[index]);
    let written = null;
    const sameField = (extra, expected) => owns(extra, ANNOTATION_KEY) === expected.has
        && JSON.stringify(extra?.[ANNOTATION_KEY]) === JSON.stringify(expected.value);
    const restore = (owner, before, expected) => {
        const extra = owner?.extra;
        if (!extra || typeof extra !== 'object' || !sameField(extra, expected)) return;
        if (before.annotation.has) extra[ANNOTATION_KEY] = structuredClone(before.annotation.value);
        else delete extra[ANNOTATION_KEY];
        // Remove only an empty container introduced by this write; retain external metadata.
        if (!Object.keys(extra).length && (!before.value || typeof before.value !== 'object')) {
            if (before.has) owner.extra = before.value;
            else delete owner.extra;
        }
    };
    const rollback = ({ prepared } = {}) => {
        if (!written || !Array.isArray(swipes) || message.tt_swipe_cold || !Number.isInteger(index) || index < 0 || index >= length
            || message.swipes !== swipes || swipes.length !== length || currentIndex(message) !== selected
            || (index !== selected && swipes[index] !== targetText)) return;
        // setAnnotation and the shared transaction clone swipe_info as native synchronization.
        // Only accept our recorded replacement, never a later reordered/replaced candidate.
        const ownPrepare = prepared?.before === written.infoArray && prepared.beforeEntries?.[index] === written.info;
        const infoArray = ownPrepare ? prepared.after : written.infoArray;
        const info = ownPrepare ? prepared.afterEntries[index] : written.info;
        if (message.swipe_info !== infoArray || message.swipe_info?.[index] !== info) return;
        restore(info, oldInfo, written.infoAnnotation);
        if (index === selected) restore(message, oldMessage, written.messageAnnotation);
    };
    // Called synchronously immediately after setAnnotation, before native/event awaits.
    rollback.capture = () => {
        written = { infoArray: message.swipe_info, info: message.swipe_info?.[index],
            infoAnnotation: field(message.swipe_info?.[index]?.extra), messageAnnotation: field(message.extra) };
    };
    return rollback;
}

export function annotationSearchText(message, index) {
    const a = getAnnotation(message, index);
    return `${a.name}\n${a.note}`;
}
