// Host-user display preferences; never stored in chat.
import { getSettingsRecord, saveSettingsPatch } from './settings.mjs';
export const TIMELINE_PREFERENCES_KEY = 'st-swipe-previewer-tree-preferences';
export const DEFAULT_TIMELINE_PREFERENCES = Object.freeze({
    scale: 1,
    includeCandidates: true,
    onlyChar: false,
    onlyBranches: false,
    favoritesOnly: false,
    annotatedOnly: false,
    toolsExpanded: false,
});

export function normalizeTimelinePreferences(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const result = { ...DEFAULT_TIMELINE_PREFERENCES };
    if (typeof source.scale === 'number' && Number.isFinite(source.scale)) {
        result.scale = Math.round(Math.max(0.3, Math.min(2, source.scale)) * 100) / 100;
    }
    for (const key of ['includeCandidates', 'onlyChar', 'onlyBranches', 'toolsExpanded', 'favoritesOnly', 'annotatedOnly']) {
        if (typeof source[key] === 'boolean') result[key] = source[key];
    }
    return result;
}

export function loadTimelinePreferences(storage) {
    if (!storage) return normalizeTimelinePreferences(getSettingsRecord()?.timeline);
    try {
        // Access the browser storage getter inside try: some privacy modes reject it.
        const raw = (storage ?? globalThis.localStorage)?.getItem(TIMELINE_PREFERENCES_KEY);
        return normalizeTimelinePreferences(raw ? JSON.parse(raw) : null);
    } catch { return { ...DEFAULT_TIMELINE_PREFERENCES }; }
}

export function saveTimelinePreferences(value, storage) {
    if (!storage) {
        try { saveSettingsPatch({ timeline: normalizeTimelinePreferences(value) }); return true; }
        catch (error) { globalThis.toastr?.error?.(error.message); return false; }
    }
    try {
        const target = storage ?? globalThis.localStorage;
        if (!target) return false;
        target.setItem(TIMELINE_PREFERENCES_KEY, JSON.stringify(normalizeTimelinePreferences(value)));
        return true;
    } catch { return false; } // Quota/privacy failures must not prevent use of the tree.
}
