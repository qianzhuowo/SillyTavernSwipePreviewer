(async function () {
  const PLUGIN_ID = "swipe-previewer";

  async function init() {
    // 插件依赖于 st-api-wrapper 提供的全局 API
    const ST_API = window.ST_API;
    if (!ST_API) {
      console.warn("[Swipe Previewer] ST_API 未就绪，正在等待...");
      setTimeout(init, 1000);
      return;
    }

    // 注册消息按钮
    await ST_API.ui.registerMessageButton({
      id: PLUGIN_ID,
      icon: "fa-solid fa-layer-group",
      title: "预览所有生成的回复 (Swipes)",
      onClick: async (mesId) => {
        try {
          // 获取包含所有分支的消息数据
          const res = await ST_API.chatHistory.get({
            index: mesId,
            includeSwipes: true
          });
          const message = res.message;

          if (!message.swipes || message.swipes.length <= 1) {
            window.toastr.info("该消息没有多个分支可供预览");
            return;
          }

          showModal(mesId, message);
        } catch (err) {
          console.error("[Swipe Previewer] 预览失败:", err);
          window.toastr.error("获取分支内容失败");
        }
      },
    });
  }

  /**
   * 显示预览模态框
   */
  function showModal(mesId, message) {
    const modalId = "st-swipe-preview-modal";
    document.getElementById(modalId)?.remove();

    const swipes = message.swipes;
    const currentSwipeId = message.swipeId;

    const modalOverlay = document.createElement('div');
    modalOverlay.id = modalId;
    modalOverlay.className = 'st-swipe-modal-overlay';

    modalOverlay.innerHTML = `
            <div class="st-swipe-modal-container">
                <div class="st-swipe-modal-header">
                    <div class="st-swipe-modal-header-top">
                        <span class="st-swipe-title">消息 #${mesId} (${swipes.length} 分支)</span>
                        <div class="st-swipe-header-ops">
                            <div id="${modalId}-prev" class="menu_button fa-solid fa-chevron-left" title="上一个"></div>
                            <div id="${modalId}-next" class="menu_button fa-solid fa-chevron-right" title="下一个"></div>
                            <div id="${modalId}-toggle" class="menu_button fa-solid fa-list-ol" title="展开/收起列表"></div>
                            <div id="${modalId}-close" class="menu_button fa-solid fa-xmark" title="关闭"></div>
                        </div>
                    </div>
                    <div id="${modalId}-jump-list" class="st-swipe-jump-list">
                        ${swipes.map((_, idx) => `
                            <div class="st-swipe-jump-item ${idx === currentSwipeId ? 'active' : ''}" data-idx="${idx}">
                                ${idx + 1}
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="st-swipe-modal-content">
                    ${swipes.map((swipe, idx) => {
      const content = Array.isArray(swipe)
        ? swipe.map(p => 'text' in p ? p.text : '').join('')
        : swipe;
      return `
                            <div class="st-swipe-card ${idx === currentSwipeId ? 'active' : ''}" id="${modalId}-card-${idx}">
                                <div class="st-swipe-card-badge">分支 #${idx + 1} ${idx === currentSwipeId ? '(当前选中)' : ''}</div>
                                <div class="st-swipe-card-text">${escapeHtml(content)}</div>
                            </div>
                        `;
    }).join('')}
                </div>
            </div>
        `;

    document.body.appendChild(modalOverlay);

    let currentViewIdx = currentSwipeId;
    const scrollToIdx = (idx) => {
      const card = document.getElementById(`${modalId}-card-${idx}`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
        currentViewIdx = idx;
      }
    };

    // 绑定导航事件
    modalOverlay.querySelectorAll('.st-swipe-jump-item').forEach(el => {
      el.onclick = () => scrollToIdx(parseInt(el.getAttribute('data-idx')));
    });
    document.getElementById(`${modalId}-prev`).onclick = () => scrollToIdx(Math.max(0, currentViewIdx - 1));
    document.getElementById(`${modalId}-next`).onclick = () => scrollToIdx(Math.min(swipes.length - 1, currentViewIdx + 1));
    document.getElementById(`${modalId}-toggle`).onclick = () => document.getElementById(`${modalId}-jump-list`).classList.toggle('hidden');

    // 绑定关闭逻辑
    const closeModal = () => {
      modalOverlay.remove();
      window.removeEventListener('keydown', onKeydown);
    };
    const onKeydown = (e) => { if (e.key === 'Escape') closeModal(); };

    document.getElementById(`${modalId}-close`).onclick = closeModal;
    modalOverlay.onclick = (e) => { if (e.target === modalOverlay) closeModal(); };
    window.addEventListener('keydown', onKeydown);
  }

  function escapeHtml(text) {
    return text.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]));
  }

  init();
})();
