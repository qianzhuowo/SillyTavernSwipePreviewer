// Preferences belong to the host user, not the browser. localStorage is migration-only.
export const SETTINGS_KEY = 'swipe_previewer';
export const DEFAULT_SETTINGS = Object.freeze({
    moveButtonsToExtraMenu: false, applyTavernRegex: false,
    renderMarkdownInTextView: false, theme: 'dark',
});
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
export function normalizeSettings(value) {
    const source = object(value), result = { ...DEFAULT_SETTINGS };
    for (const key of ['moveButtonsToExtraMenu', 'applyTavernRegex', 'renderMarkdownInTextView']) {
        if (typeof source[key] === 'boolean') result[key] = source[key];
    }
    if (source.theme === 'light') result.theme = 'light';
    return result;
}
function legacy(key) {
    try { return object(JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null')); }
    catch { return {}; }
}
export function getSettingsRecord(context = globalThis.SillyTavern?.getContext?.()) {
    if (!context?.extensionSettings) return null;
    if (!Object.hasOwn(context.extensionSettings, SETTINGS_KEY)) {
        // Mark migration even for empty legacy data so a later browser cannot overwrite host choices.
        context.extensionSettings[SETTINGS_KEY] = {
            ...normalizeSettings(legacy('st-swipe-previewer-settings')),
            timeline: legacy('st-swipe-previewer-tree-preferences'),
        };
        context.saveSettingsDebounced?.();
    }
    return object(context.extensionSettings[SETTINGS_KEY]);
}
export function loadSettings() { return normalizeSettings(getSettingsRecord()); }
export function saveSettingsPatch(patch, context = globalThis.SillyTavern?.getContext?.()) {
    if (!context?.extensionSettings || typeof context.saveSettingsDebounced !== 'function') {
        throw new Error('酒馆设置接口尚未就绪，无法保存分支预览器设置');
    }
    const previous = getSettingsRecord(context);
    const next = { ...previous, ...patch };
    context.extensionSettings[SETTINGS_KEY] = next;
    try { context.saveSettingsDebounced(); }
    catch (error) { context.extensionSettings[SETTINGS_KEY] = previous; throw error; }
    return normalizeSettings(next);
}
export function installTheme(overlay) {
    const ops = overlay.querySelector('.st-swipe-header-ops');
    if (ops && !ops.querySelector('.st-swipe-theme-toggle')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'menu_button st-swipe-theme-toggle';
        button.addEventListener('click', () => {
            try {
                saveSettingsPatch({ theme: loadSettings().theme === 'light' ? 'dark' : 'light' });
                document.querySelectorAll('.st-swipe-modal-overlay').forEach(applyTheme);
            } catch (error) { globalThis.toastr?.error?.(error.message); }
        });
        ops.prepend(button);
    }
    applyTheme(overlay);
}
function applyTheme(overlay) {
    const light = loadSettings().theme === 'light';
    overlay.dataset.swipeTheme = light ? 'light' : 'dark';
    const button = overlay.querySelector('.st-swipe-theme-toggle');
    if (button) {
        button.textContent = light ? '☾' : '☀';
        button.title = light ? '切换夜间模式' : '切换日间模式';
        button.setAttribute('aria-label', button.title);
        button.setAttribute('aria-pressed', String(light));
    }
    overlay.dispatchEvent(new Event('swipe-theme-change'));
}
