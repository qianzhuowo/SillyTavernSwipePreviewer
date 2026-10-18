import { installTheme } from './settings.mjs';
import { prepareOverlayKeyboard, prepareButtonKeyboard, manageOverlayFocus, isTopSwipeOverlay } from './native-integration.mjs';

export function editAnnotation(value, { index, returnFocus } = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'st-swipe-modal-overlay';
    overlay.id = 'st-swipe-annotation-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'st-swipe-annotation-title');
    overlay.innerHTML = `<div class="st-swipe-modal-container st-swipe-annotation-editor">
      <header class="st-swipe-annotation-header">
        <div class="st-swipe-annotation-heading"><span class="st-swipe-annotation-eyebrow">分支 #${index + 1}</span><h3 id="st-swipe-annotation-title">命名与备注</h3></div>
        <div class="st-swipe-header-ops"><button type="button" class="menu_button" data-cancel aria-label="关闭命名与备注" title="关闭"><span aria-hidden="true">×</span></button></div>
      </header>
      <form class="st-swipe-modal-content st-swipe-annotation-fields">
        <label class="st-swipe-annotation-field"><span class="st-swipe-annotation-label">名称</span><input name="name" class="text_pole" maxlength="120" placeholder="给这条支线起个名字" autocomplete="off"></label>
        <label class="st-swipe-annotation-field"><span class="st-swipe-annotation-label">备注</span><textarea name="note" class="text_pole" maxlength="4000" rows="6" placeholder="记下剧情计划，或下次想继续的方向…"></textarea></label>
        <p class="st-swipe-annotation-hint">随聊天保存，不改变正文。Ctrl/⌘+Enter 保存。</p>
        <div class="st-swipe-annotation-footer">
          <button type="button" class="menu_button st-swipe-annotation-favorite" aria-pressed="false"><span class="st-swipe-star" aria-hidden="true"></span><span data-favorite-label></span></button>
          <div class="st-swipe-edit-actions"><button type="button" class="menu_button" data-cancel>取消</button><button type="submit" class="menu_button st-swipe-annotation-save">保存</button></div>
        </div>
      </form></div>`;
    const form = overlay.querySelector('form');
    form.elements.name.value = value.name;
    form.elements.note.value = value.note;
    let favorite = value.favorite === true;
    const favoriteButton = overlay.querySelector('.st-swipe-annotation-favorite');
    const renderFavorite = () => {
        favoriteButton.setAttribute('aria-pressed', String(favorite));
        favoriteButton.setAttribute('aria-label', favorite ? '取消收藏此分支' : '收藏此分支');
        favoriteButton.classList.toggle('active', favorite);
        favoriteButton.querySelector('.st-swipe-star').textContent = favorite ? '★' : '☆';
        favoriteButton.querySelector('[data-favorite-label]').textContent = favorite ? '已收藏' : '收藏此分支';
    };
    renderFavorite();
    favoriteButton.addEventListener('click', () => { favorite = !favorite; renderFavorite(); });
    installTheme(overlay);
    prepareOverlayKeyboard(overlay);
    // Own form button Enter/Space before the host's document-level Enter-to-click handler.
    prepareButtonKeyboard(form, () => isTopSwipeOverlay(overlay));
    document.body.append(overlay);
    let finish, done = false;
    const promise = new Promise(resolve => { finish = resolve; });
    const close = result => {
        if (done) return;
        done = true; releaseFocus(); overlay.remove(); finish(result);
    };
    const releaseFocus = manageOverlayFocus(overlay, {
        initialFocus: form.elements.name, returnFocus, onEscape: () => close(null),
    });
    const save = () => close({ name: form.elements.name.value, note: form.elements.note.value, favorite });
    form.addEventListener('submit', event => { event.preventDefault(); save(); });
    overlay.addEventListener('keydown', event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing && event.keyCode !== 229 && !event.repeat) {
            event.preventDefault(); event.stopPropagation(); save();
        }
    }, true);
    overlay.querySelectorAll('[data-cancel]').forEach(button => button.addEventListener('click', () => close(null)));
    overlay.addEventListener('click', event => { if (event.target === overlay) close(null); });
    return { promise, cancel: () => close(null) };
}
