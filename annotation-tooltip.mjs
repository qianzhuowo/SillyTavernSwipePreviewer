// One delegated tooltip per preview. No message writes or per-candidate listeners.
export function installAnnotationTooltip({ overlay, list, getAnnotation, isAvailable }) {
    const document = overlay.ownerDocument, window = document.defaultView;
    const tooltip = document.createElement('div');
    tooltip.className = 'st-swipe-annotation-tooltip';
    tooltip.id = `${overlay.id}-annotation-tooltip`;
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    overlay.append(tooltip);
    const listeners = [];
    const listen = (target, type, handler, options) => {
        target.addEventListener(type, handler, options);
        listeners.push(() => target.removeEventListener(type, handler, options));
    };
    let anchor = null, press = null, showTimer, hideTimer, suppressed = null, touchUntil = 0;
    const buttonAt = target => {
        const button = target?.closest?.('.st-swipe-jump-item');
        return button && list.contains(button) && !button.disabled ? button : null;
    };
    const eligible = button => button?.isConnected && !button.disabled && isAvailable();
    function hide() {
        const wasVisible = !tooltip.hidden;
        clearTimeout(showTimer); clearTimeout(hideTimer);
        press = null;
        anchor?.removeAttribute('aria-describedby');
        anchor = null;
        tooltip.hidden = true;
        return wasVisible;
    }
    function show(button) {
        hide();
        if (!eligible(button)) return false;
        const value = getAnnotation(Number(button.dataset.idx));
        if (!value.name && !value.note.trim()) return false;
        tooltip.replaceChildren();
        for (const [tag, field] of [['strong', 'name'], ['div', 'note']]) {
            if (!value[field].trim()) continue;
            const node = document.createElement(tag);
            node.className = `st-swipe-annotation-${field}`;
            node.textContent = value[field];
            tooltip.append(node);
        }
        anchor = button;
        button.setAttribute('aria-describedby', tooltip.id);
        tooltip.hidden = false;
        tooltip.scrollTop = 0;
        // Fit to the visual viewport as well as narrow desktop windows.
        const view = window.visualViewport;
        const x = view?.offsetLeft ?? 0, y = view?.offsetTop ?? 0;
        const width = view?.width ?? window.innerWidth, height = view?.height ?? window.innerHeight;
        tooltip.style.maxWidth = `${Math.max(0, width - 24)}px`;
        tooltip.style.maxHeight = `${Math.min(320, height * 0.5)}px`;
        const rect = button.getBoundingClientRect();
        const size = tooltip.getBoundingClientRect();
        const left = Math.max(x + 12, Math.min(rect.left, x + width - size.width - 12));
        const preferredTop = rect.bottom + 8 + size.height <= y + height - 12 ? rect.bottom + 8 : rect.top - size.height - 8;
        const top = Math.max(y + 12, Math.min(preferredTop, y + height - size.height - 12));
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
        return true;
    }
    const deferHide = () => { clearTimeout(hideTimer); hideTimer = setTimeout(hide, 180); };
    listen(list, 'pointerover', event => {
        if (event.pointerType !== 'mouse') return;
        const button = buttonAt(event.target);
        if (!button || button.contains(event.relatedTarget)) return;
        hide();
        showTimer = setTimeout(() => show(button), 180);
    });
    listen(list, 'pointerout', event => {
        // Touch emits pointerout on release; keep its pinned tooltip readable afterward.
        if (event.pointerType !== 'mouse') return;
        const button = buttonAt(event.target);
        if (!button || button.contains(event.relatedTarget)) return;
        clearTimeout(showTimer);
        if (tooltip.contains(event.relatedTarget)) return;
        deferHide();
    });
    listen(tooltip, 'pointerenter', () => clearTimeout(hideTimer));
    listen(tooltip, 'pointerleave', deferHide);
    listen(list, 'focusin', event => {
        if (Date.now() >= touchUntil) show(buttonAt(event.target));
    });
    listen(list, 'focusout', deferHide);
    listen(document, 'pointerdown', event => {
        if (!tooltip.contains(event.target)) hide();
        const button = buttonAt(event.target);
        if (!button || !['touch', 'pen'].includes(event.pointerType) || event.isPrimary === false) return;
        touchUntil = Date.now() + 1500;
        suppressed = null;
        const gesture = { button, id: event.pointerId, x: event.clientX, y: event.clientY };
        press = gesture;
        showTimer = setTimeout(() => {
            if (press !== gesture) return;
            if (show(button)) suppressed = { button, until: Infinity };
            press = gesture;
        }, 500);
    }, true);
    listen(document, 'pointermove', event => {
        if (!press || event.pointerId !== press.id) return;
        if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) hide();
    }, true);
    const endPress = event => {
        if (press && press.id !== event.pointerId) return;
        clearTimeout(showTimer); press = null;
        if (suppressed) suppressed.until = Date.now() + 1200;
        if (event.type === 'pointercancel') hide();
    };
    listen(document, 'pointerup', endPress, true);
    listen(document, 'pointercancel', endPress, true);
    listen(overlay, 'click', event => {
        const button = buttonAt(event.target);
        if (suppressed?.button === button && Date.now() < suppressed.until) {
            event.preventDefault(); event.stopImmediatePropagation(); suppressed = null;
            return;
        }
        if (!tooltip.contains(event.target)) hide();
    }, true);
    listen(list, 'contextmenu', event => {
        if (buttonAt(event.target) && Date.now() < touchUntil) event.preventDefault();
    });
    listen(list, 'keydown', event => { if (['Enter', ' '].includes(event.key)) suppressed = null; });
    listen(document, 'scroll', event => { if (!tooltip.contains(event.target)) hide(); }, true);
    listen(window, 'resize', hide);
    if (window.visualViewport) {
        listen(window.visualViewport, 'resize', hide);
        listen(window.visualViewport, 'scroll', hide);
    }
    // Covers a hidden source preview, a removed candidate, or an open child modal.
    const observer = new MutationObserver(() => {
        if ((anchor && !eligible(anchor)) || (press && !eligible(press.button))) hide();
    });
    observer.observe(overlay, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'disabled'] });
    observer.observe(document.body, { childList: true });
    return {
        hide,
        dispose() { hide(); observer.disconnect(); listeners.forEach(remove => remove()); tooltip.remove(); },
    };
}
