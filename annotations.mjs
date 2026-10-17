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
export function annotationSearchText(message, index) {
    const a = getAnnotation(message, index);
    return `${a.name}\n${a.note}`;
}
