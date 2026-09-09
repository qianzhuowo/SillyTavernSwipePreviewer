// Native SillyTavern message integration. No wrapper globals or per-message listeners.
export const PREVIEW_BUTTON_SELECTOR = '.st-swipe-previewer-button';
const installations = new WeakMap();
const treeEntries = new WeakMap();

const overlaySelector = '.st-swipe-modal-overlay, [aria-modal="true"]';
function isVisible(element) {
    return !!element?.isConnected && !element.closest('[hidden], [inert]') && element.getClientRects().length > 0
        && element.ownerDocument.defaultView.getComputedStyle(element).visibility !== 'hidden';
}
function topOverlay(document) {
    let top = null, topZ = -Infinity;
    for (const overlay of [...document.querySelectorAll(overlaySelector)].filter(isVisible)) {
        const z = Number.parseFloat(document.defaultView.getComputedStyle(overlay).zIndex) || 0;
        if (z >= topZ) { top = overlay; topZ = z; }
    }
    return top;
}
export function isTopSwipeOverlay(overlay) {
    const document = overlay.ownerDocument;
    return isVisible(overlay) && !document.querySelector('dialog[open]') && topOverlay(document) === overlay;
}

/** Own only this overlay's button keys; prevent keyboard.js's bubbling Enter-to-click. */
export function prepareOverlayKeyboard(overlay) {
    overlay.querySelectorAll('.st-swipe-header-ops div.menu_button').forEach(button => {
        button.tabIndex = 0;
        button.setAttribute('role', 'button');
        button.setAttribute('aria-label', button.title);
    });
    prepareButtonKeyboard(overlay, () => isTopSwipeOverlay(overlay));
}

/** Native buttons also need default-action suppression when the host synthesizes clicks. */
export function prepareButtonKeyboard(root, isActive = () => true) {
    root.addEventListener('keydown', event => {
        if (!['Enter', ' '].includes(event.key)) return;
        const button = event.target.closest?.('button.menu_button, .st-swipe-header-ops div.menu_button, a#st-swipe-tree-entry');
        if (!button || !root.contains(button) || !isActive()) return;
        event.preventDefault();
        event.stopPropagation();
        // Consume these button keys even during IME/repeat/modifiers: the host does not
        // check defaultPrevented or composition before synthesizing another Enter click.
        if (!event.isComposing && event.keyCode !== 229 && !event.repeat
            && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
            && !button.matches(':disabled, [aria-disabled="true"], .disabled')) button.click();
    });
}

/** Small per-overlay focus scope. Hidden previews yield to trees, child overlays and native dialogs. */
export function manageOverlayFocus(overlay, { initialFocus, returnFocus, canRestore = () => true, onEscape } = {}) {
    const document = overlay.ownerDocument;
    const window = document.defaultView;
    const previousFocus = returnFocus ?? document.activeElement;
    let disposed = false;
    overlay.tabIndex = -1;
    const usable = element => isVisible(element) && !element.matches(':disabled, [aria-disabled="true"]');
    const focusables = () => [...overlay.querySelectorAll('button, input, select, textarea, a[href], iframe, [tabindex]')]
        .filter(element => element.tabIndex >= 0 && usable(element));
    const enter = () => {
        if (disposed || !isTopSwipeOverlay(overlay)
            || (overlay.contains(document.activeElement) && usable(document.activeElement))) return;
        const preferred = typeof initialFocus === 'function' ? initialFocus() : initialFocus;
        (usable(preferred) ? preferred : focusables()[0] ?? overlay).focus({ preventScroll: true });
    };
    const onKeydown = event => {
        if (!['Tab', 'Escape'].includes(event.key) || !isTopSwipeOverlay(overlay)) return;
        if (event.key === 'Escape') {
            if (!onEscape) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (!event.isComposing && event.keyCode !== 229 && !event.repeat) onEscape(event);
            return;
        }
        if (event.isComposing || event.keyCode === 229) return;
        const elements = focusables();
        const first = elements[0] ?? overlay;
        const last = elements.at(-1) ?? overlay;
        const current = document.activeElement;
        if (!elements.includes(current) || (event.shiftKey ? current === first : current === last)) {
            event.preventDefault();
            event.stopPropagation();
            (event.shiftKey ? last : first).focus({ preventScroll: true });
        }
    };
    const observer = new MutationObserver(() => {
        if (!overlay.isConnected) { dispose(false); return; }
        // Let synchronous tree/child dismissal and its queued return-focus run first.
        queueMicrotask(enter);
    });
    function dispose(restore = true) {
        if (disposed) return;
        const wasTop = isTopSwipeOverlay(overlay);
        disposed = true;
        observer.disconnect();
        window.removeEventListener('keydown', onKeydown, true);
        document.removeEventListener('focusin', enter, true);
        if (restore && wasTop) queueMicrotask(() => {
            const target = typeof previousFocus === 'function' ? previousFocus() : previousFocus;
            const top = topOverlay(document);
            if (!canRestore() || !usable(target) || document.querySelector('dialog[open]') || (top && !top.contains(target))) return;
            // Never steal focus from a replacement preview/tree opened during dismissal.
            if (document.activeElement !== target) target.focus({ preventScroll: true });
        });
    }
    window.addEventListener('keydown', onKeydown, true);
    document.addEventListener('focusin', enter, true);
    observer.observe(document.body, { childList: true });
    observer.observe(overlay, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    enter();
    return dispose;
}

/** Install a native chat-options item, without depending on extension-settings markup. */
export function installNativeTreeEntry({ document, eventSource, eventTypes, onOpen, onError = console.error }) {
    treeEntries.get(document)?.dispose();
    const entry = document.createElement('a');
    entry.id = 'st-swipe-tree-entry';
    entry.className = 'interactable';
    entry.tabIndex = 0;
    entry.setAttribute('role', 'button');
    entry.setAttribute('aria-label', '聊天分支树');
    const icon = document.createElement('i');
    icon.className = 'fa-lg fa-solid fa-code-branch';
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = '聊天分支树';
    entry.append(icon, label);
    prepareButtonKeyboard(entry);
    let disposed = false;
    const subscriptions = [];
    entry.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (disposed || !entry.isConnected) return;
        const menuButton = document.getElementById('options_button');
        // script.js owns isOptionsMenuVisible and Popper; close through its real toggle.
        if (isVisible(document.getElementById('options'))) menuButton?.click();
        menuButton?.focus({ preventScroll: true });
        try { Promise.resolve(onOpen()).catch(onError); }
        catch (error) { onError(error); }
    });
    function sync() {
        if (disposed) return;
        // Also remove the legacy button from extensions_settings2, if still present.
        document.querySelectorAll('#st-swipe-tree-entry').forEach(node => { if (node !== entry) node.remove(); });
        const menu = document.querySelector('#options .options-content');
        if (!menu) { entry.remove(); return; }
        const anchor = menu.querySelector('#option_select_chat');
        if (entry.parentElement !== menu || (anchor?.parentElement === menu && entry.previousElementSibling !== anchor)) {
            menu.insertBefore(entry, anchor?.parentElement === menu ? anchor.nextSibling : null);
        }
    }
    for (const name of ['APP_READY', 'CHAT_CHANGED']) {
        const event = eventTypes?.[name];
        if (!event || !eventSource?.on) continue;
        eventSource.on(event, sync);
        subscriptions.push(event);
    }
    const controller = {
        sync,
        dispose() {
            if (disposed) return;
            disposed = true;
            entry.remove();
            for (const event of subscriptions) {
                if (eventSource?.removeListener) eventSource.removeListener(event, sync);
                else eventSource?.off?.(event, sync);
            }
            if (treeEntries.get(document) === controller) treeEntries.delete(document);
        },
    };
    treeEntries.set(document, controller);
    sync();
    return controller;
}

/** A detached text/swipe view; never normalize or mutate the live chat message. */
export function getNativePreviewMessage(context, mesId) {
    if (!Number.isInteger(mesId) || mesId < 0) return null;
    const source = context?.chat?.[mesId];
    if (!source || typeof source !== 'object') return null;
    const swipes = Array.isArray(source.swipes) && source.swipes.length
        ? [...source.swipes] : [source.mes ?? ''];
    const swipeId = Number.isInteger(source.swipe_id)
        ? Math.min(Math.max(source.swipe_id, 0), swipes.length - 1) : 0;
    // Native edits can leave the active swipes entry stale until the next swipe/save.
    swipes[swipeId] = source.mes ?? '';
    return { ...source, swipes, swipe_id: swipeId };
}

/**
 * script.js clones the live #message_template .mes for both new and older messages.
 * Patch that template and existing rows, then reconcile native render/history events.
 * Reinstalling for the same document tears down the previous event/delegation handlers.
 */
export function installNativeMessageButtons({ document, eventSource, eventTypes, getContext, onPreview, onError = console.error }) {
    installations.get(document)?.dispose();
    let extra = false;
    let disposed = false;
    const subscriptions = [];

    function syncMessage(message) {
        const container = message.querySelector(extra ? '.extraMesButtons' : '.mes_buttons');
        if (!container) return;
        const buttons = [...message.querySelectorAll(PREVIEW_BUTTON_SELECTOR)];
        let button = buttons.shift();
        for (const duplicate of buttons) duplicate.remove();
        if (!button) {
            button = document.createElement('div');
            button.className = 'mes_button st-swipe-previewer-button fa-solid fa-layer-group interactable';
            button.title = '预览所有生成的回复 (Swipes)';
            button.setAttribute('aria-label', button.title);
            button.setAttribute('role', 'button');
            button.tabIndex = 0;
        }
        if (button.parentElement === container) return;
        // Normal mode remains next to Edit; extra mode occupies the first menu slot.
        const anchor = extra ? container.firstElementChild : container.querySelector('.mes_edit');
        container.insertBefore(button, anchor?.parentElement === container ? anchor : null);
    }

    function sync() {
        if (disposed) return;
        document.querySelectorAll('#message_template .mes, #chat .mes').forEach(syncMessage);
    }

    function syncRendered(mesId) {
        if (disposed) return;
        if (!Number.isInteger(mesId) || mesId < 0) { sync(); return; }
        document.querySelectorAll(`#chat .mes[mesid="${mesId}"]`).forEach(syncMessage);
    }

    function activate(event) {
        if (event.type === 'keydown' && !['Enter', ' '].includes(event.key)) return;
        const button = event.target?.closest?.(PREVIEW_BUTTON_SELECTOR);
        const message = button?.closest('#chat .mes');
        if (!message || !document.getElementById('chat')?.contains(message)) return;
        const rawId = message.getAttribute('mesid');
        if (!/^\d+$/.test(rawId ?? '')) return;
        const mesId = Number(rawId);
        if (!Number.isSafeInteger(mesId) || !getContext()?.chat?.[mesId]) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.type === 'keydown' && (event.repeat || event.isComposing || event.keyCode === 229
            || event.altKey || event.ctrlKey || event.shiftKey || event.metaKey)) return;
        try { Promise.resolve(onPreview(mesId, message)).catch(onError); }
        catch (error) { onError(error); }
    }

    function subscribe(name, handler) {
        const event = eventTypes?.[name];
        if (!event || !eventSource?.on) return;
        eventSource.on(event, handler);
        subscriptions.push([event, handler]);
    }

    for (const name of ['APP_READY', 'CHAT_CHANGED', 'MORE_MESSAGES_LOADED', 'MESSAGE_DELETED']) subscribe(name, sync);
    for (const name of ['USER_MESSAGE_RENDERED', 'CHARACTER_MESSAGE_RENDERED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED']) subscribe(name, syncRendered);
    document.addEventListener('click', activate);
    // keyboard.js synthesizes Enter clicks from a document bubble listener. Capture only
    // our keys first so native keyboard support and our Space fallback cannot double-open.
    document.addEventListener('keydown', activate, true);

    const controller = {
        setExtraMenu(value) { extra = !!value; sync(); },
        sync,
        dispose() {
            if (disposed) return;
            disposed = true;
            document.removeEventListener('click', activate);
            document.removeEventListener('keydown', activate, true);
            for (const [event, handler] of subscriptions) {
                if (eventSource?.removeListener) eventSource.removeListener(event, handler);
                else eventSource?.off?.(event, handler);
            }
            if (installations.get(document) === controller) installations.delete(document);
        },
    };
    installations.set(document, controller);
    return controller;
}
