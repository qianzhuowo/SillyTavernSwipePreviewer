import { installTheme } from './settings.mjs';
import { prepareOverlayKeyboard, manageOverlayFocus } from './native-integration.mjs';

export function editAnnotation(value, { index, returnFocus } = {}) {
    const overlay = document.createElement('div');
    overlay.className = 'st-swipe-modal-overlay';
    overlay.id = 'st-swipe-annotation-modal';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `分支 ${index + 1} 的命名与备注`);
    overlay.innerHTML = `<div class="st-swipe-modal-container st-swipe-annotation-editor">
      <div class="st-swipe-modal-header-top"><span>命名与备注</span><div class="st-swipe-header-ops"><button type="button" class="menu_button" data-cancel>关闭</button></div></div>
      <form class="st-swipe-modal-content st-swipe-annotation-fields">
        <label>分支名称<input name="name" class="text_pole" maxlength="120" placeholder="例如：回到森林寻找失踪的同伴"></label>
        <label>支线计划 / 备注<textarea name="note" class="text_pole" maxlength="4000" rows="8" placeholder="记下这条候选准备展开的剧情或脑洞…"></textarea></label>
        <label><input name="favorite" type="checkbox"> 收藏此分支</label>
        <span class="st-swipe-setting-card-desc">标记随聊天保存，不修改消息正文。Ctrl/⌘+Enter 保存。</span>
        <div class="st-swipe-edit-actions"><button type="button" class="menu_button" data-cancel>取消</button><button type="submit" class="menu_button">保存标记</button></div>
      </form></div>`;
    const form = overlay.querySelector('form');
    form.elements.name.value = value.name;
    form.elements.note.value = value.note;
    form.elements.favorite.checked = value.favorite;
    installTheme(overlay);
    prepareOverlayKeyboard(overlay);
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
    const save = () => close({ name: form.elements.name.value, note: form.elements.note.value, favorite: form.elements.favorite.checked });
    form.addEventListener('submit', event => { event.preventDefault(); save(); });
    overlay.addEventListener('keydown', event => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing && !event.repeat) {
            event.preventDefault(); save();
        }
    });
    overlay.querySelectorAll('[data-cancel]').forEach(button => button.addEventListener('click', () => close(null)));
    overlay.addEventListener('click', event => { if (event.target === overlay) close(null); });
    return { promise, cancel: () => close(null) };
}
