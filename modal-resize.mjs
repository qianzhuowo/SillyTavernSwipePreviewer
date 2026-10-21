// Deliberately browser-local: never use host settings or chat metadata.
export const MODAL_SIZE_KEY = 'st-swipe-previewer:modal-size:v1:';
export function normalizeModalSize(value) {
    return value && Number.isFinite(value.width) && Number.isFinite(value.height)
        && value.width > 0 && value.height > 0
        ? { width: value.width, height: value.height } : null;
}
export function loadModalSize(kind) {
    try { return normalizeModalSize(JSON.parse(globalThis.localStorage.getItem(MODAL_SIZE_KEY + kind))); }
    catch { return null; }
}
export function saveModalSize(kind, size) {
    try { globalThis.localStorage.setItem(MODAL_SIZE_KEY + kind, JSON.stringify(normalizeModalSize(size))); }
    catch { /* Storage restrictions must not disable resizing. */ }
}
export function clampModalSize(size, width, height) {
    return { width: Math.min(width, Math.max(360, size.width)),
        height: Math.min(height, Math.max(280, size.height)) };
}

export function installModalResize(container, { kind, target = container, navigation = null }) {
    const desktop = window.matchMedia('(min-width: 601px) and (hover: hover) and (pointer: fine)');
    const handle = document.createElement('div');
    handle.className = 'st-swipe-resize-handle';
    handle.title = '拖拽调整窗口大小';
    handle.setAttribute('aria-hidden', 'true');
    container.classList.add('st-swipe-resizable');
    container.append(handle);
    const properties = ['width', 'height', 'max-width', 'max-height', 'box-sizing'];
    const original = properties.map(name => [name, target.style.getPropertyValue(name), target.style.getPropertyPriority(name)]);
    let preferred = loadModalSize(kind), drag = null;
    function restore() {
        for (const [name, value, priority] of original) {
            if (value) target.style.setProperty(name, value, priority);
            else target.style.removeProperty(name);
        }
    }
    function apply(size) {
        const navSpace = navigation ? 2 * (navigation.getBoundingClientRect().width + 12) : 0;
        const bounded = clampModalSize(size, Math.max(1, window.innerWidth - navSpace - 24), Math.max(1, window.innerHeight - 24));
        target.style.width = `${bounded.width}px`;
        target.style.height = `${bounded.height}px`;
        target.style.maxWidth = 'none';
        target.style.maxHeight = 'none';
        target.style.boxSizing = 'border-box';
        return bounded;
    }
    function finish(event) {
        if (!drag || (event && event.pointerId !== drag.id)) return;
        const id = drag.id;
        drag = null;
        if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
        if (preferred) saveModalSize(kind, preferred);
    }
    function sync() {
        finish();
        handle.hidden = !desktop.matches;
        if (desktop.matches && preferred) apply(preferred);
        else restore();
    }
    function start(event) {
        if (!desktop.matches || event.button !== 0 || event.pointerType === 'touch') return;
        event.preventDefault();
        event.stopPropagation();
        const rect = target.getBoundingClientRect();
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };
        handle.setPointerCapture(event.pointerId);
    }
    function move(event) {
        if (!drag || event.pointerId !== drag.id) return;
        event.preventDefault();
        // Both dialogs are centered: each edge moves by half the size delta.
        preferred = apply({ width: drag.width + 2 * (event.clientX - drag.x), height: drag.height + 2 * (event.clientY - drag.y) });
    }
    handle.addEventListener('pointerdown', start);
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('lostpointercapture', finish);
    desktop.addEventListener('change', sync);
    window.addEventListener('resize', sync);
    sync();
    return () => {
        finish();
        desktop.removeEventListener('change', sync);
        window.removeEventListener('resize', sync);
        handle.remove();
        container.classList.remove('st-swipe-resizable');
        restore();
    };
}
