(async function () {
  const swipeData = await import('./swipe-data.mjs');
  const nativeApi = await import('/script.js');
  const { eventSource, event_types: nativeEventTypes } = await import('/scripts/events.js');
  const { installNativeMessageButtons, installNativeTreeEntry, getNativePreviewMessage, prepareOverlayKeyboard, manageOverlayFocus, isTopSwipeOverlay } = await import('./native-integration.mjs');
  let closeActivePreview = null;
  let previewRequest = 0;

  async function openBranchTree({ mesId, swipeIdx, source, isValid } = {}) {
    const origin = window.SillyTavern?.getContext?.();
    const originChat = origin?.chat;
    const originChatId = origin?.chatId;
    const fallbackId = Number.isInteger(mesId) ? mesId : (originChat?.length ?? 0) - 1;
    const originMessage = originChat?.[fallbackId];
    try {
      const { showBranchTree } = await import('./branch-tree.js');
      const latest = window.SillyTavern?.getContext?.();
      if (latest?.chat !== originChat || latest?.chatId !== originChatId || (isValid && !isValid())) return;
      showBranchTree({
        focusMesId: fallbackId,
        focusSwipeIdx: swipeIdx,
        onPreview: (id, idx) => onPreviewClick(id, null, idx),
        onClose: (reason) => {
          if (source?.isConnected) source.hidden = false;
          if (reason === 'locate') { closeActivePreview?.(); return; }
          if (reason !== 'dismiss' || source?.isConnected) return;
          const context = window.SillyTavern?.getContext?.();
          if (context?.chat === originChat && context?.chatId === originChatId && originMessage && originChat[fallbackId] === originMessage) {
            void onPreviewClick(fallbackId, null, swipeIdx);
          }
        },
      });
      if (source?.isConnected) source.hidden = true;
    } catch (error) {
      console.error('[Swipe Previewer] tree failed', error);
      window.toastr?.error?.('无法打开分支树');
    }
  }

  const SETTINGS_KEY = "st-swipe-previewer-settings";
  const DEFAULT_SETTINGS = {
    /** 将按钮移动到 ... 菜单（.extraMesButtons） */
    moveButtonsToExtraMenu: false,
    /** 预览时应用酒馆正则（AI 输出 placement=2） */
    applyTavernRegex: false,
    /** 未开启渲染预览（iframe）时，也以“轻量 Markdown”方式渲染文本（加粗/删除线/引用等 + 引号高亮） */
    renderMarkdownInTextView: false,
  };

  let settings = loadSettings();
  let nativeButtons;

  function init() {
    nativeButtons = installNativeMessageButtons({
      document, eventSource, eventTypes: nativeEventTypes,
      getContext: () => window.SillyTavern?.getContext?.(),
      onPreview: onPreviewClick,
      onError: error => console.error('[Swipe Previewer] 消息按钮操作失败', error),
    });
    applyButtonRegistration();
    // A chat-wide native menu entry remains available even for single-candidate chats.
    installNativeTreeEntry({
      document, eventSource, eventTypes: nativeEventTypes,
      onOpen: () => openBranchTree(),
    });
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_SETTINGS, ...(parsed || {}) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  function saveSettings(next) {
    settings = { ...DEFAULT_SETTINGS, ...(next || {}) };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
    catch (error) { console.warn('[Swipe Previewer] 无法持久保存设置', error); }
    return settings;
  }

  function applyButtonRegistration() {
    // Move the same native button in both the live template and existing messages.
    nativeButtons?.setExtraMenu(settings.moveButtonsToExtraMenu);
  }

  async function onPreviewClick(mesId, messageElement, focusIdx) {
    const request = ++previewRequest;
    mesId = Number(mesId);
    const origin = window.SillyTavern?.getContext?.();
    const originChat = origin?.chat;
    const originMessage = originChat?.[mesId];
    const chatId = origin?.chatId;
    try {
      const message = getNativePreviewMessage(origin, mesId);
      if (!message) return;
      const latest = window.SillyTavern?.getContext?.();
      if (request !== previewRequest || latest?.chat !== originChat || latest?.chatId !== chatId || latest?.chat?.[mesId] !== originMessage) return;
      await showModal(mesId, message, messageElement, focusIdx);
    } catch (err) {
      console.error("[Swipe Previewer] 预览失败:", err);
      window.toastr?.error?.("获取分支内容失败");
    }
  }

  function showSettingsModal(opts = {}) {
    const { onSettingsChanged, returnFocus } = opts || {};

    const modalId = "st-swipe-previewer-settings-modal";
    document.getElementById(modalId)?.remove();

    const overlay = document.createElement('div');
    overlay.id = modalId;
    overlay.className = 'st-swipe-modal-overlay';

    overlay.innerHTML = `
      <div class="st-swipe-modal-container" style="max-width: 700px; width: min(95vw, 700px); height: auto; max-height: 85vh;">
        <div class="st-swipe-modal-header">
          <div class="st-swipe-modal-header-top">
            <span class="st-swipe-title">分支预览器设置</span>
            <div class="st-swipe-header-ops">
              <div id="${modalId}-close" class="menu_button fa-solid fa-xmark" title="关闭"></div>
            </div>
          </div>
        </div>

        <div class="st-swipe-modal-content" style="gap: 12px;">
          <div class="st-swipe-setting-grid">
            <label class="st-swipe-setting-card" for="${modalId}-move">
              <div class="st-swipe-setting-card-head">
                <div class="st-swipe-setting-card-title">按钮位置</div>
                <input id="${modalId}-move" class="st-swipe-setting-toggle" type="checkbox" ${settings.moveButtonsToExtraMenu ? 'checked' : ''} />
              </div>
              <div class="st-swipe-setting-card-desc">将本插件按钮移动到消息的 <code>...</code> 菜单内。</div>
            </label>

            <label class="st-swipe-setting-card" for="${modalId}-regex">
              <div class="st-swipe-setting-card-head">
                <div class="st-swipe-setting-card-title">预览正则</div>
                <input id="${modalId}-regex" class="st-swipe-setting-toggle" type="checkbox" ${settings.applyTavernRegex ? 'checked' : ''} />
              </div>
              <div class="st-swipe-setting-card-desc">预览时应用酒馆正则。</div>
            </label>

            <label class="st-swipe-setting-card" for="${modalId}-md-text">
              <div class="st-swipe-setting-card-head">
                <div class="st-swipe-setting-card-title">支持Markdown显示</div>
                <input id="${modalId}-md-text" class="st-swipe-setting-toggle" type="checkbox" ${settings.renderMarkdownInTextView ? 'checked' : ''} />
              </div>
              <div class="st-swipe-setting-card-desc">未开启“渲染预览”时，也对文本做轻量 Markdown 显示（加粗/删除线/引用块等），并高亮引号（中文/英文/『』/「」）内容，便于阅读。</div>
            </label>
          </div>
        </div>
      </div>
    `;

    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '分支预览器设置');
    prepareOverlayKeyboard(overlay);
    document.body.appendChild(overlay);
    const releaseFocus = manageOverlayFocus(overlay, {
      initialFocus: overlay.querySelector(`#${modalId}-close`), returnFocus,
      onEscape: () => closeModal(),
    });
    const closeModal = () => { releaseFocus(); overlay.remove(); };
    overlay.querySelector(`#${modalId}-close`)?.addEventListener('click', closeModal);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });

    const moveEl = overlay.querySelector(`#${modalId}-move`);
    const regexEl = overlay.querySelector(`#${modalId}-regex`);
    const mdTextEl = overlay.querySelector(`#${modalId}-md-text`);

    moveEl?.addEventListener('change', async () => {
      saveSettings({ ...settings, moveButtonsToExtraMenu: !!moveEl.checked });
      try {
        await applyButtonRegistration();
      } catch (e) {
        console.error('[Swipe Previewer] applyButtonRegistration failed', e);
        window.toastr?.error?.('切换按钮位置失败，请刷新页面后重试');
      }
    });

    regexEl?.addEventListener('change', async () => {
      saveSettings({ ...settings, applyTavernRegex: !!regexEl.checked });
      // 让“预览正则”开关能即时影响已经打开的预览窗口
      try { await onSettingsChanged?.(); } catch { }
    });

    mdTextEl?.addEventListener('change', () => {
      saveSettings({ ...settings, renderMarkdownInTextView: !!mdTextEl.checked });
      try { onSettingsChanged?.(); } catch { }
    });
  }

  /**
   * 显示预览模态框
   */
  async function showModal(mesId, message, messageElement, focusIdx) {
    const modalId = "st-swipe-preview-modal";
    const returnFocus = messageElement?.querySelector('.st-swipe-previewer-button')
      ?? document.querySelector(`#chat .mes[mesid="${mesId}"] .st-swipe-previewer-button`)
      ?? document.activeElement;
    closeActivePreview?.();
    const originContext = window.SillyTavern.getContext();
    const originChat = originContext.chat;
    const originMessage = originChat[mesId];
    const originChatId = originContext.chatId;
    const eventTypes = originContext.eventTypes || originContext.event_types;
    let closed = false;
    let busy = false;
    let cancelEdit = null;
    const selected = new Set();
    let selectionMode = false;
    let jumpListWasHidden = false;
    const canDelete = () => Array.isArray(originMessage.swipes) && originMessage.swipes.length > 1
      && !originMessage.is_user && !originMessage.extra?.isSmallSys;
    const signature = () => JSON.stringify([originMessage.swipes, originMessage.swipe_id, originMessage.mes, originMessage.swipe_info, originMessage.extra]);
    let observedSignature = signature();
    const assertContext = () => {
      const ctx = window.SillyTavern.getContext();
      if (closed || ctx.chat !== originChat || ctx.chatId !== originChatId || ctx.chat[mesId] !== originMessage) throw new Error('聊天已切换或楼层已变化，请重新打开预览');
      const swipeState = ctx.swipe?.state?.();
      if (nativeApi.isGenerating?.() || (swipeState && swipeState !== 'none')) throw new Error('请等待生成或分支切换完成后再操作');
      if (document.querySelector('#chat .mes .edit_textarea')) throw new Error('请先完成聊天中的消息编辑');
      if (nativeApi.isChatSaving) throw new Error('酒馆正在保存聊天，请稍后重试');
      if (signature() !== observedSignature) throw new Error('分支已被其他操作更新，请重新打开预览');
      return ctx;
    };

    let swipes = Array.isArray(message?.swipes) ? [...message.swipes] : [];
    let currentSwipeId = Number.isInteger(message?.swipe_id) ? message.swipe_id : 0;

    const modalOverlay = document.createElement('div');
    modalOverlay.id = modalId;
    modalOverlay.className = 'st-swipe-modal-overlay';

    // 先渲染骨架，内容异步填充（因为可能需要跑 regex）
    modalOverlay.innerHTML = `
      <div class="st-swipe-modal-container">
        <div class="st-swipe-modal-header">
          <div class="st-swipe-modal-header-top">
            <span class="st-swipe-title">消息 #${mesId} (${swipes.length} 分支)</span>
            <div class="st-swipe-header-ops">
              <button type="button" id="${modalId}-delete-mode" class="menu_button fa-solid fa-trash-can" title="进入删除选择模式" aria-label="进入删除选择模式" aria-pressed="false" aria-controls="${modalId}-selection-toolbar ${modalId}-jump-list"></button>
              <button id="${modalId}-tree" class="menu_button fa-solid fa-code-branch" title="当前聊天分支树" aria-label="当前聊天分支树"></button>
              <div id="${modalId}-prev" class="menu_button fa-solid fa-chevron-left" title="上一个"></div>
              <div id="${modalId}-next" class="menu_button fa-solid fa-chevron-right" title="下一个"></div>
              <div id="${modalId}-toggle" class="menu_button fa-solid fa-list-ol" title="展开/收起列表"></div>
              <div id="${modalId}-render" class="menu_button fa-solid fa-code" title="渲染预览 (iframe)"></div>
              <div id="${modalId}-settings" class="menu_button fa-solid fa-gear" title="设置"></div>
              <div id="${modalId}-close" class="menu_button fa-solid fa-xmark" title="关闭"></div>
            </div>
          </div>
          <div id="${modalId}-selection-toolbar" class="st-swipe-selection-toolbar" hidden>
            <span class="st-swipe-selection-hint">点击下方编号选择待删分支</span>
            <button type="button" class="menu_button" data-selection="all">全选</button>
            <button type="button" class="menu_button" data-selection="invert">反选</button>
            <button type="button" class="menu_button" data-selection="others">选择非当前分支</button>
            <button type="button" class="menu_button" data-selection="none">取消选择</button>
            <span class="st-swipe-selection-count" role="status" aria-live="polite">已选 0 项</span>
            <button type="button" class="menu_button" data-selection="delete" disabled>确认删除</button>
            <button type="button" class="menu_button" data-selection="exit">退出选择</button>
            <span class="st-swipe-selection-legend"><span>● 当前楼层分支</span><span>✓ 待删选中</span><span>空白：未选中</span></span>
          </div>
          <div id="${modalId}-jump-list" class="st-swipe-jump-list" aria-label="分支导航"></div>
        </div>

        <div class="st-swipe-modal-content" id="${modalId}-content">
          <div class="st-swipe-loading">正在加载分支内容...</div>
        </div>
      </div>
    `;

    modalOverlay.setAttribute('role', 'dialog');
    modalOverlay.setAttribute('aria-modal', 'true');
    modalOverlay.setAttribute('aria-label', `消息 ${mesId} 的分支预览`);
    prepareOverlayKeyboard(modalOverlay);
    document.body.appendChild(modalOverlay);

    // 状态
    let currentViewIdx = Number.isInteger(focusIdx) ? focusIdx : currentSwipeId;
    /** 整体渲染预览（全局开关） */
    let renderPreviewGlobal = false;
    /** 每个分支的单独开关（优先级：单独开关覆盖全局） */
    const renderPreviewByIdx = new Map();

    // iframe 高度通信 token（用于区分不同打开的预览窗口）
    const iframeToken = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const onIframeMessage = (event) => {
      const data = event?.data;
      if (!data || data.type !== 'swipe-previewer:height') return;
      if (data.token !== iframeToken) return;

      const idx = Number(data.idx);
      const height = Number(data.height);
      if (!Number.isFinite(idx) || !Number.isFinite(height)) return;

      const frame = modalOverlay.querySelector(`#${modalId}-frame-${idx}`);
      if (!frame || event.source !== frame.contentWindow) return;

      // 更激进的“去掉空白”：对高度做一点缩减，避免滚动条/边距导致的过高
      const h = Math.min(Math.max(height - 4, 160), 2400);
      frame.style.height = `${h}px`;
    };

    window.addEventListener('message', onIframeMessage);

    const getSwipeText = (swipe) => {
      const text = Array.isArray(swipe)
        ? swipe.map(p => ('text' in p ? p.text : '')).join('')
        : String(swipe ?? '');
      return text;
    };

    let swipeTextsRaw = [];
    let swipeTexts = [];

    const clampSwipeIdx = (idx, total = swipes.length) => {
      if (!Number.isFinite(total) || total <= 0) return 0;
      const n = Number.isFinite(idx) ? Math.trunc(idx) : 0;
      return Math.min(Math.max(n, 0), total - 1);
    };

    const syncSwipesFromChat = () => {
      const ctx = window.SillyTavern?.getContext?.();
      const stMsg = ctx?.chat?.[mesId];

      if (Array.isArray(stMsg?.swipes) && stMsg.swipes.length) {
        swipes = [...stMsg.swipes];
        message.swipes = swipes;
      } else {
        swipes = Array.isArray(message?.swipes) ? message.swipes : [];
      }

      const rawCurrent = Number.isInteger(stMsg?.swipe_id)
        ? stMsg.swipe_id
        : (Number.isInteger(message?.swipe_id) ? message.swipe_id : 0);
      currentSwipeId = clampSwipeIdx(rawCurrent, swipes.length);
      message.swipe_id = currentSwipeId;

      currentViewIdx = clampSwipeIdx(currentViewIdx, swipes.length);
      swipeTextsRaw = swipes.map(getSwipeText);
      if (stMsg && swipeTextsRaw.length) swipeTextsRaw[currentSwipeId] = getSwipeText(stMsg.mes);
      swipeTexts = swipeTextsRaw;
    };

    const contentEl = modalOverlay.querySelector(`#${modalId}-content`);
    const jumpListEl = modalOverlay.querySelector(`#${modalId}-jump-list`);
    const titleEl = modalOverlay.querySelector('.st-swipe-title');

    // 可选：应用酒馆正则（global + scoped + preset）
    async function importRegexEngine() {
      try {
        return await import('/scripts/extensions/regex/engine.js');
      } catch (e) {
        console.warn('[Swipe Previewer] Regex engine import failed', e);
        return null;
      }
    }

    // 懒加载 + 缓存 regex engine（避免每次开关都重复 import）
    let regexEnginePromise = null;
    const getRegexEngine = () => {
      if (!regexEnginePromise) regexEnginePromise = importRegexEngine();
      return regexEnginePromise;
    };

    async function applyAllTavernRegex(text, placement) {
      const engine = await getRegexEngine();
      if (!engine) return text;

      // Use the same display pipeline as messageFormatting: respect disabled extensions,
      // markdownOnly/promptOnly, script order and min/max depth. Don't re-run source edits.
      return engine.getRegexedString?.(String(text ?? ''), placement, {
        isMarkdown: true,
        isPrompt: false,
        depth: originContext.chat.length - mesId - 1,
      }) ?? text;
    }

    // 重新计算（是否应用正则）后的分支文本：用于“设置”里切换开关后实时刷新
    let swipeTextsComputeSeq = 0;
    const recomputeSwipeTexts = async () => {
      const seq = ++swipeTextsComputeSeq;

      if (!settings.applyTavernRegex) {
        swipeTexts = swipeTextsRaw;
        return;
      }

      try {
        const next = await Promise.all(swipeTextsRaw.map(async (t) => {
          return await applyAllTavernRegex(t, originMessage.is_user ? 1 : 2);
        }));

        // 若用户快速连点开关，只应用最后一次结果
        if (seq !== swipeTextsComputeSeq) return;

        swipeTexts = next;
      } catch (e) {
        console.warn('[Swipe Previewer] regex process failed, fallback to raw text', e);
        swipeTexts = swipeTextsRaw;
      }
    };

    const renderTitle = () => {
      if (!titleEl) return;
      titleEl.textContent = `消息 #${mesId} (${swipes.length} 分支)`;
    };

    const renderJumpList = () => {
      if (!jumpListEl) return;
      jumpListEl.innerHTML = swipes.map((_, idx) => `
        <button type="button" class="st-swipe-jump-item ${idx === currentSwipeId ? 'active' : ''}" data-idx="${idx}" ${idx === currentSwipeId ? 'aria-current="true"' : ''}>${idx + 1}</button>
      `).join('');
    };

    const renderCardsMarkup = () => {
      if (!contentEl) return;
      if (!swipes.length) {
        contentEl.innerHTML = '<div class="st-swipe-loading">当前消息没有可展示的分支</div>';
        return;
      }

      contentEl.innerHTML = swipes.map((_, idx) => `
          <div class="st-swipe-card ${idx === currentSwipeId ? 'active' : ''}" id="${modalId}-card-${idx}" data-idx="${idx}">
            <div class="st-swipe-card-header">
              <div class="st-swipe-card-badge">
                <span>分支 #${idx + 1} ${idx === currentSwipeId ? '(当前选中)' : ''}</span>
                <button class="menu_button st-swipe-action-render-one" data-idx="${idx}" title="单独开启/关闭渲染预览">
                  <i class="fa-solid fa-code"></i>
                </button>
              </div>
              <div class="st-swipe-card-actions">
                <button class="menu_button st-swipe-action-switch" data-idx="${idx}">切换楼层内容</button>
                <button class="menu_button st-swipe-action-branch" data-idx="${idx}">创建新存档</button>
                <button class="menu_button st-swipe-action-edit" data-idx="${idx}">编辑分支</button>
                <button class="menu_button st-swipe-action-move-up" data-idx="${idx}" ${idx === 0 ? 'disabled' : ''}>上移</button>
                <button class="menu_button st-swipe-action-move-down" data-idx="${idx}" ${idx === swipes.length - 1 ? 'disabled' : ''}>下移</button>
              </div>
            </div>

            <div class="st-swipe-card-body">
              <div class="st-swipe-card-text" id="${modalId}-text-${idx}"></div>
              <iframe class="st-swipe-card-frame" id="${modalId}-frame-${idx}" sandbox="allow-scripts" referrerpolicy="no-referrer" loading="lazy"></iframe>
            </div>
          </div>
        `).join('');
    };

    // 渲染逻辑（iframe 预览）
    const escapeHtml = (text) => String(text ?? '').replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m]));

    const sanitizeHtml = (html) => {
      try {
        if (window.DOMPurify?.sanitize) {
          return window.DOMPurify.sanitize(html, {
            USE_PROFILES: { html: true },
          });
        }
      } catch { }

      // fallback：做一个非常基础的清理（不如 DOMPurify 完整，但能挡掉明显的脚本注入）
      try {
        const tpl = document.createElement('template');
        tpl.innerHTML = String(html ?? '');

        const blockedTags = ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta'];
        blockedTags.forEach((tag) => tpl.content.querySelectorAll(tag).forEach((n) => n.remove()));

        // 移除 on* 事件属性 + javascript: 协议
        tpl.content.querySelectorAll('*').forEach((el) => {
          for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            const value = String(attr.value || '').trim().toLowerCase();
            if (name.startsWith('on')) {
              el.removeAttribute(attr.name);
            }
            if ((name === 'href' || name === 'src') && value.startsWith('javascript:')) {
              el.removeAttribute(attr.name);
            }
          }
        });

        return tpl.innerHTML;
      } catch {
        return String(html ?? '');
      }
    };

    // iframe 渲染：支持有限 Markdown（``` 代码块、*斜体*、> 引用、# 标题 等），并尽量兼容“Markdown + HTML 混排”。
    // 说明：这里不做完整 Markdown 解析，仅做“显示层面”还原；目标是尽量贴近 SillyTavern 的显示效果。
    const isProbablyHtml = (s) => /<\/?[a-z][\s\S]*?>/i.test(String(s || ''));

    const wrapPlainText = (raw) => {
      // 纯文本：保留换行（pre-wrap），并做 HTML escape
      return `<div class="st-swipe-previewer-plain" style="white-space: pre-wrap; word-break: break-word;">${escapeHtml(raw)}</div>`;
    };

    const markdownToHtmlLite = (input) => {
      const src = String(input ?? '').replace(/\r\n/g, '\n');

      // 保护 <style>/<script> 块：避免其中的 `/* ... */`、`*...*` 等触发 Markdown 特征检测/解析。
      // 同时也避免把 CSS/JS 每行当成段落包裹。
      const htmlBlocks = [];
      const htmlPlaceholder = (i) => `__ST_SWIPE_HTML_BLOCK_${i}__`;

      let stage0 = src.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, (m) => {
        const idx = htmlBlocks.length;
        htmlBlocks.push(String(m));
        return htmlPlaceholder(idx);
      });

      // 1) 提取 ``` fenced code blocks（不解析语言标识）
      const codeBlocks = [];
      const codePlaceholder = (i) => `__ST_SWIPE_CODE_BLOCK_${i}__`;

      stage0 = stage0.replace(/```([\s\S]*?)```/g, (m, code) => {
        const idx = codeBlocks.length;
        codeBlocks.push(String(code || '').replace(/^\n+|\n+$/g, ''));
        return codePlaceholder(idx);
      });

      // 2) 行级 Markdown：标题/引用/段落/空行/分隔线 + 允许行级 HTML 直通
      const lines = stage0.split('\n');
      const out = [];
      let inBlockquote = false;

      const flushBlockquote = () => {
        if (inBlockquote) {
          out.push('</blockquote>');
          inBlockquote = false;
        }
      };

      const inlineMdToHtml = (text) => {
        const raw = String(text ?? '');

        // 保留 HTML tag（例如 <a>、<img> 等），只对纯文本部分做 escape + md-lite。
        const parts = raw.split(/(<[^>]+>)/g);
        return parts.map((part) => {
          if (part.startsWith('<') && part.endsWith('>')) return part;

          let t = escapeHtml(part);

          // inline code: `code`
          t = t.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
          // bold: **text**
          t = t.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
          // italic: *text* （尽量避免误伤）
          t = t.replace(/\*(?!\s)([^*\n]+?)\*(?!\w)/g, '<em>$1</em>');
          // del: ~~text~~
          t = t.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');

          return t;
        }).join('');
      };

      const isHtmlBlockLine = (line) => {
        const t = String(line ?? '').trim();
        if (!t) return false;
        if (!t.startsWith('<')) return false;
        // 简单判定：以标签开头的行（包括关闭标签、注释、<!doctype ...>）
        return /^<\/?[a-z!]|^<!--/i.test(t);
      };

      for (let line of lines) {
        // html block placeholder
        const hph = line.match(/__ST_SWIPE_HTML_BLOCK_(\d+)__/);
        if (hph) {
          flushBlockquote();
          // placeholder 可能与其它字符同一行：先把整行按占位符拆开，拼接回去
          const withBlocks = String(line).replace(/__ST_SWIPE_HTML_BLOCK_(\d+)__/g, (m, i) => htmlBlocks[Number(i)] ?? '');
          out.push(withBlocks);
          continue;
        }

        // code placeholder
        const cph = line.match(/__ST_SWIPE_CODE_BLOCK_(\d+)__/);
        if (cph) {
          flushBlockquote();
          const idx = Number(cph[1]);
          const code = codeBlocks[idx] ?? '';
          out.push(`<pre><code>${escapeHtml(code)}</code></pre>`);
          continue;
        }

        // 行级 HTML：原样直通（避免被 <p> 包裹导致布局错乱）
        if (isHtmlBlockLine(line)) {
          flushBlockquote();
          out.push(String(line));
          continue;
        }

        // heading
        const h = line.match(/^(#{1,6})\s+(.*)$/);
        if (h) {
          flushBlockquote();
          const level = h[1].length;
          out.push(`<h${level}>${inlineMdToHtml(h[2] ?? '')}</h${level}>`);
          continue;
        }

        // blockquote
        const bq = line.match(/^>\s?(.*)$/);
        if (bq) {
          if (!inBlockquote) {
            flushBlockquote();
            out.push('<blockquote>');
            inBlockquote = true;
          }
          out.push(`<div>${inlineMdToHtml(bq[1] ?? '')}</div>`);
          continue;
        }

        // hr
        const t = line.trim();
        if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(t)) {
          flushBlockquote();
          out.push('<hr/>');
          continue;
        }

        // blank line -> keep spacing
        if (t === '') {
          flushBlockquote();
          out.push('<div class="st-swipe-md-blank"></div>');
          continue;
        }

        out.push(`<p>${inlineMdToHtml(line)}</p>`);
      }

      flushBlockquote();

      // 3) 兜底替换：把 HTML 块占位符还原
      let html = out.join('\n');
      html = html.replace(/__ST_SWIPE_HTML_BLOCK_(\d+)__/g, (m, i) => htmlBlocks[Number(i)] ?? '');

      return `<div class="st-swipe-md-root">${html}</div>`;
    };

    // 文本视图：用于“未开启 iframe 渲染预览”时的轻量 Markdown（安全：不直通 HTML 标签）
    const escapeHtmlTextOnly = (text) => String(text ?? '').replace(/[&<>]/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;'
    }[m]));

    const highlightQuotedSegments = (html) => {
      // 目标：给被引号包裹的句子做高亮。
      // 注意：
      // - 只处理“标签外”的文本片段，避免污染标签/属性。
      // - 同时保护 <code>...</code>（不在代码里做引号高亮）。

      const input = String(html ?? '');

      // 1) 保护 code 段
      const codeBlocks = [];
      const codePlaceholder = (i) => `__ST_SWIPE_Q_CODE_${i}__`;

      const withoutCode = input.replace(/<code\b[^>]*>[\s\S]*?<\/code>/gi, (m) => {
        const idx = codeBlocks.length;
        codeBlocks.push(String(m));
        return codePlaceholder(idx);
      });

      // 2) 分段处理：只对“标签外”的文本片段做引号高亮。
      // 插入 <span class="...">，如果后续替换再对整串做正则，
      // 可能误把 class="..." 等属性值当成英文引号内容再次匹配，导致 HTML 被破坏。
      const wrap = (cls, full) => `<span class="st-swipe-quote ${cls}">${full}</span>`;

      const replaceOutsideTags = (inputHtml, re, replacer) => {
        const parts = String(inputHtml ?? '').split(/(<[^>]+>)/g);
        return parts
          .map((p) => (p.startsWith('<') && p.endsWith('>')) ? p : p.replace(re, replacer))
          .join('');
      };

      let out = withoutCode;

      // 中文引号
      out = replaceOutsideTags(out, /“([^”\n]{1,300})”/g, (m) => wrap('q-cn-double', m));
      out = replaceOutsideTags(out, /‘([^’\n]{1,300})’/g, (m) => wrap('q-cn-single', m));
      // 日文引号
      out = replaceOutsideTags(out, /「([^」\n]{1,300})」/g, (m) => wrap('q-jp-kagi', m));
      out = replaceOutsideTags(out, /『([^』\n]{1,300})』/g, (m) => wrap('q-jp-doublekagi', m));
      // 英文引号（注意：会误伤英文缩写中的 '，这里做一个相对保守的长度限制）
      out = replaceOutsideTags(out, /"([^"\n]{1,300})"/g, (m) => wrap('q-en-double', m));
      out = replaceOutsideTags(out, /'([^'\n]{1,300})'/g, (m) => wrap('q-en-single', m));

      // 3) 还原 code 段
      out = out.replace(/__ST_SWIPE_Q_CODE_(\d+)__/g, (m, i) => codeBlocks[Number(i)] ?? m);
      return out;
    };

    const markdownToHtmlTextLite = (input) => {
      const src = String(input ?? '').replace(/\r\n/g, '\n');

      // 1) 提取 ``` fenced code blocks（不解析语言标识）
      const codeBlocks = [];
      const placeholder = (i) => `__ST_SWIPE_TEXT_CODE_BLOCK_${i}__`;

      const withoutCode = src.replace(/```([\s\S]*?)```/g, (m, code) => {
        const idx = codeBlocks.length;
        codeBlocks.push(String(code || '').replace(/^\n+|\n+$/g, ''));
        return placeholder(idx);
      });

      // 2) 逐行处理标题/引用/段落，并保留空行（不直通 HTML）
      const lines = withoutCode.split('\n');
      const out = [];
      let inBlockquote = false;

      const flushBlockquote = () => {
        if (inBlockquote) {
          out.push('</blockquote>');
          inBlockquote = false;
        }
      };

      const inlineMd = (line) => {
        // 安全：先 escape <>&，保留引号以便高亮
        let t = escapeHtmlTextOnly(line);

        // inline code: `code`
        t = t.replace(/`([^`\n]+?)`/g, '<code>$1</code>');
        // bold: **text**
        t = t.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');
        // italic: *text*
        t = t.replace(/\*(?!\s)([^*\n]+?)\*(?!\w)/g, '<em>$1</em>');
        // del: ~~text~~
        t = t.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');

        // 引号高亮
        t = highlightQuotedSegments(t);
        return t;
      };

      for (let line of lines) {
        // code placeholder
        const ph = line.match(/__ST_SWIPE_TEXT_CODE_BLOCK_(\d+)__/);
        if (ph) {
          flushBlockquote();
          const idx = Number(ph[1]);
          const code = codeBlocks[idx] ?? '';
          out.push(`<pre><code>${escapeHtmlTextOnly(code)}</code></pre>`);
          continue;
        }

        // heading
        const h = line.match(/^(#{1,6})\s+(.*)$/);
        if (h) {
          flushBlockquote();
          const level = h[1].length;
          out.push(`<h${level}>${inlineMd(h[2] ?? '')}</h${level}>`);
          continue;
        }

        // blockquote
        const bq = line.match(/^>\s?(.*)$/);
        if (bq) {
          if (!inBlockquote) {
            flushBlockquote();
            out.push('<blockquote>');
            inBlockquote = true;
          }
          out.push(`<div>${inlineMd(bq[1] ?? '')}</div>`);
          continue;
        }

        // hr
        const t = line.trim();
        if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(t)) {
          flushBlockquote();
          out.push('<hr/>');
          continue;
        }

        // blank line -> keep spacing
        if (t === '') {
          flushBlockquote();
          out.push('<div class="st-swipe-md-blank"></div>');
          continue;
        }

        out.push(`<p>${inlineMd(line)}</p>`);
      }

      flushBlockquote();

      // 注意：这里不要 join("\n")，否则在父容器 white-space: pre-wrap 的情况下会把这些换行当成可见空行。
      return `<div class="st-swipe-md-root st-swipe-md-textmode">${out.join('')}</div>`;
    };

    const toHtmlForPreview = (text) => {
      const raw = String(text ?? '');

      // 命中 Markdown 特征：走 md-lite
      // 注意：先剔除 <style>/<script>，避免 CSS/JS 中的 `*...*` 误判为 Markdown。
      const mdProbe = raw.replace(/<(style|script)\b[\s\S]*?<\/\1>/gi, '');

      const emphasisProbe = /\*(?!\s)([^*\n]+?)\*(?!\w)/.test(mdProbe) || /\*\*([^*\n]+?)\*\*/.test(mdProbe);
      const looksLikeMd = /```/.test(mdProbe) || /^(\s{0,3}#{1,6}\s+|\s{0,3}>\s+)/m.test(mdProbe) || emphasisProbe || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/m.test(mdProbe);
      if (looksLikeMd) return markdownToHtmlLite(raw);

      // 纯文本
      if (!isProbablyHtml(raw)) return wrapPlainText(raw);

      // HTML
      return raw;
    };

    const toHtmlForTextView = (text) => {
      const raw = String(text ?? '');
      const probe = raw;

      const emphasisProbe = /\*(?!\s)([^*\n]+?)\*(?!\w)/.test(probe) || /\*\*([^*\n]+?)\*\*/.test(probe);
      const quoteProbe = /[“”‘’"']|[「」『』]/.test(probe);
      const looksLikeLiteMdOrQuote = /```/.test(probe) || /^(\s{0,3}#{1,6}\s+|\s{0,3}>\s+)/m.test(probe) || emphasisProbe || /~~[^~\n]+?~~/.test(probe) || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/m.test(probe) || quoteProbe;

      if (!looksLikeLiteMdOrQuote) {
        // 纯文本（保持原样）
        return wrapPlainText(raw);
      }

      // 轻量 Markdown（安全：不渲染 HTML 标签）
      return markdownToHtmlTextLite(raw);
    };

    const getRootCssVar = (name, fallback = '') => {
      try {
        const v = getComputedStyle(modalOverlay).getPropertyValue(name);
        const s = String(v || '').trim();
        return s || fallback;
      } catch {
        return fallback;
      }
    };

    const buildSrcdoc = (htmlBody, token, idx) => {
      // 注意：此处刻意不做 DOMPurify 清理，以便允许运行用户提供的 <script>
      // 安全依赖于 iframe sandbox（allow-scripts 且不允许 same-origin）。
      const body = String(htmlBody ?? '');

      // 从宿主页面读取 md-lite 配色（iframe 内的 srcdoc 有自己的一套 <style>，不会继承）。
      const mdEmColor = getRootCssVar('--st-swipe-previewer-md-em-color', 'inherit');
      const mdStrongColor = getRootCssVar('--st-swipe-previewer-md-strong-color', 'inherit');
      const mdQuoteColor = getRootCssVar('--st-swipe-previewer-md-quote-color', 'inherit');
      const mdQuoteBg = getRootCssVar('--st-swipe-previewer-md-quote-bg', 'transparent');
      const hostStyle = getComputedStyle(modalOverlay);
      const hostColor = hostStyle.color;
      const hostFont = hostStyle.fontFamily.replace(/</g, '');
      const hostBorder = getRootCssVar('--st-swipe-border', 'GrayText');

      // 自适应高度：在 iframe 内用 ResizeObserver/MO 发送高度给父页面
      const heightScript = `(() => {
        const send = () => {
          const body = document.body;
          const doc = document.documentElement;
          const h = Math.max(
            body ? body.scrollHeight : 0,
            doc ? doc.scrollHeight : 0,
            body ? body.offsetHeight : 0,
            doc ? doc.offsetHeight : 0
          );
          parent.postMessage({
            type: 'swipe-previewer:height',
            token: ${JSON.stringify(token)},
            idx: ${idx},
            height: h
          }, '*');
        };

        const ro = (window.ResizeObserver) ? new ResizeObserver(() => send()) : null;
        if (ro) ro.observe(document.documentElement);
        if (ro && document.body) ro.observe(document.body);

        const mo = new MutationObserver(() => send());
        mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });

        window.addEventListener('load', send);
        setTimeout(send, 0);
        setTimeout(send, 50);
        setTimeout(send, 200);
        // ResizeObserver and mutation/load events cover content changes without a permanent timer.
      })();`;

      return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { color-scheme: normal; }
  body { margin: 0; padding: 12px; font-family: ${hostFont}; font-size: ${hostStyle.fontSize}; background: transparent; color: ${hostColor}; line-height: 1.6; overflow-wrap: anywhere; }
  img { max-width: 100%; height: auto; }

  /* 简洁的代码块 + 自动换行 */
  pre {
    overflow-x: hidden;
    overflow-y: auto;
    padding: 8px 10px;
    background: color-mix(in srgb, currentColor 5%, transparent);
    border: 1px solid ${hostBorder};
    border-radius: 6px;
    margin: 6px 0;
    white-space: pre-wrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.95em;
  }

  code {
    background: color-mix(in srgb, currentColor 6%, transparent);
    padding: 0 4px;
    border-radius: 4px;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  pre code { background: transparent; padding: 0; border-radius: 0; }

  a { color: ${mdQuoteColor}; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid ${hostBorder}; padding: 6px 8px; }
  blockquote { border-left: 3px solid ${hostBorder}; margin: 8px 0; padding-left: 10px; }

  /* md-lite（iframe）样式：让 markdownToHtmlLite / markdownToHtmlTextLite 产出的 .st-swipe-md-root 在 iframe 内也能正确着色 */
  .st-swipe-md-root em { color: ${mdEmColor}; }
  .st-swipe-md-root strong { color: ${mdStrongColor}; }
  .st-swipe-md-root .st-swipe-quote { color: ${mdQuoteColor}; background: ${mdQuoteBg}; padding: 0 3px; border-radius: 4px; }
</style>
<script>${heightScript}</script>
</head>
<body>${body}</body>
</html>`;
    };

    const getEffectiveRender = (idx) => {
      if (renderPreviewByIdx.has(idx)) return !!renderPreviewByIdx.get(idx);
      return !!renderPreviewGlobal;
    };

    const updateRenderButtonStates = () => {
      // 全局按钮
      modalOverlay.querySelector(`#${modalId}-render`)?.classList.toggle('active', !!renderPreviewGlobal);

      // 单卡按钮
      modalOverlay.querySelectorAll('.st-swipe-action-render-one').forEach((btn) => {
        const idx = parseInt(btn.getAttribute('data-idx') || '0', 10);
        btn.classList.toggle('active', getEffectiveRender(idx));
      });
    };

    const renderCard = (idx) => {
      const card = modalOverlay.querySelector(`#${modalId}-card-${idx}`);
      const textEl = modalOverlay.querySelector(`#${modalId}-text-${idx}`);
      const frame = modalOverlay.querySelector(`#${modalId}-frame-${idx}`);
      if (!card || !textEl || !frame) return;

      const text = swipeTexts[idx] ?? '';
      const enabled = getEffectiveRender(idx);
      card.classList.toggle('render-on', enabled);

      if (!enabled) {
        // 文本视图（默认：纯文本；可选：轻量 Markdown）
        if (settings.renderMarkdownInTextView) {
          try {
            // 主页面渲染必须是安全的：toHtmlForTextView 已经不会直通 HTML 标签
            // 但这里仍尝试用 DOMPurify 做一层兜底
            const html = toHtmlForTextView(text);
            textEl.innerHTML = sanitizeHtml(html);
          } catch {
            textEl.textContent = text;
          }
        } else {
          textEl.textContent = text;
        }

        frame.removeAttribute('srcdoc');
        return;
      }

      // iframe 渲染
      const html = toHtmlForPreview(text);
      frame.style.height = '160px';
      frame.setAttribute('srcdoc', buildSrcdoc(html, iframeToken, idx));
    };

    const renderAllCards = () => {
      for (let i = 0; i < swipes.length; i++) renderCard(i);
      updateRenderButtonStates();
    };

    const scrollToIdx = (idx, behavior = 'auto') => {
      if (!swipes.length) {
        currentViewIdx = 0;
        return;
      }

      const targetIdx = clampSwipeIdx(idx, swipes.length);
      currentViewIdx = targetIdx;

      // NOTE(mobile): 直接对卡片做 scrollIntoView 在部分移动端浏览器中会“联动滚动”到页面底层的聊天区域，
      // 导致背景页面被意外滚动甚至回不去。这里强制只滚动模态框内部的内容容器。
      const card = modalOverlay.querySelector(`#${modalId}-card-${targetIdx}`);
      if (!card) return;

      if (contentEl && typeof contentEl.scrollTo === 'function') {
        const contentRect = contentEl.getBoundingClientRect();
        const cardRect = card.getBoundingClientRect();
        const deltaTop = cardRect.top - contentRect.top;

        // 让卡片顶部稍微留出一点空间（避免贴边）
        const nextTop = Math.max(0, contentEl.scrollTop + deltaTop - 8);
        contentEl.scrollTo({ top: nextTop, behavior });
        return;
      }

      // 兜底：仅当没有内容容器时才使用 scrollIntoView
      card.scrollIntoView({ behavior, block: 'start' });
    };

    const swapRenderPreviewState = (a, b) => {
      const hasA = renderPreviewByIdx.has(a);
      const hasB = renderPreviewByIdx.has(b);
      const valA = renderPreviewByIdx.get(a);
      const valB = renderPreviewByIdx.get(b);

      if (hasA) renderPreviewByIdx.set(b, valA);
      else renderPreviewByIdx.delete(b);

      if (hasB) renderPreviewByIdx.set(a, valB);
      else renderPreviewByIdx.delete(a);
    };

    const remapRenderPreviewState = (kept) => {
      const next = new Map();
      kept.forEach((oldIndex, newIndex) => {
        if (renderPreviewByIdx.has(oldIndex)) next.set(newIndex, renderPreviewByIdx.get(oldIndex));
      });
      renderPreviewByIdx.clear();
      for (const [idx, value] of next) renderPreviewByIdx.set(idx, value);
    };

    function updateSelection() {
      const deleteModeButton = modalOverlay.querySelector(`#${modalId}-delete-mode`);
      deleteModeButton.disabled = busy || !canDelete();
      deleteModeButton.classList.toggle('active', selectionMode);
      deleteModeButton.setAttribute('aria-pressed', String(selectionMode));
      deleteModeButton.title = selectionMode ? '退出删除选择模式' : '进入删除选择模式';
      deleteModeButton.setAttribute('aria-label', deleteModeButton.title);
      modalOverlay.classList.toggle('st-swipe-selection-mode', selectionMode);
      modalOverlay.querySelector('.st-swipe-selection-toolbar').hidden = !selectionMode;
      modalOverlay.querySelector('.st-swipe-selection-count').textContent = `已选 ${selected.size} / ${swipes.length} 项（至少保留 1 项）`;
      modalOverlay.querySelectorAll('[data-selection]').forEach(button => { button.disabled = busy; });
      modalOverlay.querySelector('[data-selection="delete"]').disabled = busy || !selectionMode || !selected.size || selected.size >= swipes.length;
      modalOverlay.querySelector(`#${modalId}-toggle`).setAttribute('aria-disabled', String(selectionMode));
      jumpListEl.setAttribute('aria-label', selectionMode ? '选择待删除的分支' : '分支导航');
      jumpListEl.querySelectorAll('.st-swipe-jump-item').forEach(button => {
        const idx = Number(button.dataset.idx);
        const checked = selectionMode && selected.has(idx);
        button.classList.toggle('selected', checked);
        button.disabled = busy;
        if (selectionMode) button.setAttribute('aria-pressed', String(checked));
        else button.removeAttribute('aria-pressed');
        const state = `${idx === currentSwipeId ? '，当前楼层分支' : ''}${checked ? '，待删选中' : selectionMode ? '，未选中' : ''}`;
        button.title = `分支 ${idx + 1}${state}；${selectionMode ? '点击切换选择' : '点击定位预览'}`;
        button.setAttribute('aria-label', button.title);
      });
    }

    function setSelectionMode(enabled) {
      if (enabled && !canDelete()) return;
      if (enabled && !selectionMode) {
        jumpListWasHidden = jumpListEl.classList.contains('hidden');
        jumpListEl.classList.remove('hidden');
      } else if (!enabled && selectionMode) {
        jumpListEl.classList.toggle('hidden', jumpListWasHidden);
      }
      selectionMode = enabled;
      if (!enabled) selected.clear();
      updateSelection();
    }

    // One operation at a time, including the confirmation/editor wait. Revalidate after awaits.
    async function withMutation(operation) {
      if (busy) return;
      try {
        assertContext();
        busy = true;
        modalOverlay.setAttribute('aria-busy', 'true');
        updateSelection();
        await operation();
      } catch (error) {
        console.error('[Swipe Previewer] operation failed', error);
        window.toastr?.error?.(error.message || '操作失败');
      } finally {
        busy = false;
        modalOverlay.removeAttribute('aria-busy');
        if (!closed) updateSelection();
      }
    }

    async function commitMutation(change, eventName = 'MESSAGE_SWIPED', eventArgs = [mesId]) {
      const ctx = assertContext();
      if (typeof ctx.saveChat !== 'function') throw new Error('当前酒馆版本不提供聊天保存接口');
      const backup = structuredClone(originMessage);
      let result;
      try {
        nativeApi.cancelDebouncedChatSave?.();
        if (ctx.chatMetadata) ctx.chatMetadata.tainted = true;
        result = await change(originMessage);
        const afterChange = window.SillyTavern.getContext();
        if (closed || afterChange.chatId !== originChatId || afterChange.chat[mesId] !== originMessage) throw new Error('聊天已切换，未保存此次修改');
        const ensureIdentity = () => {
          const latest = window.SillyTavern.getContext();
          if (closed || latest.chatId !== originChatId || latest.chat[mesId] !== originMessage) throw new Error('聊天已变化，已停止后续更新');
        };
        // Native editing allows listeners to normalize the message before rendering.
        if (eventName === 'MESSAGE_EDITED' && eventTypes?.MESSAGE_EDITED) {
          await ctx.eventSource.emit(eventTypes.MESSAGE_EDITED, ...eventArgs);
          ensureIdentity();
        }
        ctx.updateMessageBlock?.(mesId, originMessage);
        ctx.swipe?.refresh?.(true, false);
        const event = eventName === 'MESSAGE_EDITED' ? eventTypes?.MESSAGE_UPDATED : eventTypes?.[eventName];
        if (event) await ctx.eventSource.emit(event, ...eventArgs);
        ensureIdentity();
        swipeData.prepareSwipes(originMessage);
        if (nativeApi.isChatSaving) throw new Error('酒馆正在保存其他修改，请稍后重试');
        await ctx.saveChat();
        const afterSave = window.SillyTavern.getContext();
        if (afterSave.chatId !== originChatId || afterSave.chat[mesId] !== originMessage) {
          window.toastr?.warning?.('保存期间聊天发生切换，请重新打开原聊天确认修改是否保存');
          closeModal();
        }
      } catch (error) {
        for (const key of Object.keys(originMessage)) delete originMessage[key];
        Object.assign(originMessage, backup);
        if (window.SillyTavern.getContext().chat[mesId] === originMessage) {
          ctx.updateMessageBlock?.(mesId, originMessage);
          ctx.swipe?.refresh?.(true, false);
        }
        throw error;
      } finally {
        observedSignature = signature();
      }
      message.swipes = originMessage.swipes;
      message.swipe_id = originMessage.swipe_id;
      return result;
    }

    let refreshSequence = 0;
    async function refreshModalList(opts = {}) {
      const sequence = ++refreshSequence;
      const { focusIdx = currentViewIdx, keepScroll = true } = opts;
      if (closed) return;
      syncSwipesFromChat();
      await recomputeSwipeTexts();
      if (closed || sequence !== refreshSequence) return;
      renderTitle();
      renderJumpList();
      renderCardsMarkup();
      bindDynamicEvents();
      renderAllCards();
      if (!Array.isArray(originMessage.swipes) || !originMessage.swipes.length || originMessage.is_user || originMessage.extra?.isSmallSys) {
        contentEl.querySelectorAll('.st-swipe-card-actions button').forEach(button => { button.disabled = true; });
      }
      updateSelection();
      if (keepScroll) scrollToIdx(focusIdx, 'auto');
    }

    // 对外操作：将分支应用到聊天中
    const applySwipeToChat = async (targetSwipeIdx) => commitMutation(stMsg => {
      swipeData.prepareSwipes(stMsg);
      swipeData.activateSwipe(stMsg, targetSwipeIdx);
    });

    const jumpToSwipe = async (targetSwipeIdx) => {
      await applySwipeToChat(targetSwipeIdx);
      closeModal();
      // Do not jump to the bottom when changing an historical floor.
      document.querySelector(`#chat .mes[mesid="${mesId}"]`)?.scrollIntoView({ behavior: 'auto', block: 'center' });
    };

    const createBranchFromSwipe = async (targetSwipeIdx) => {
      // Use the native data API rather than depending on a possibly unloaded message DOM.
      const { createBranch } = await import('/scripts/bookmarks.js');
      assertContext();
      await applySwipeToChat(targetSwipeIdx);
      const ctx = assertContext();
      const name = await createBranch(mesId);
      // createBranch adds extra.branches but does not persist the source chat itself.
      const latest = window.SillyTavern.getContext();
      if (closed || latest.chatId !== originChatId || latest.chat[mesId] !== originMessage) throw new Error('聊天已切换，请在聊天列表查看新建分支');
      if (!name) throw new Error('创建分支存档失败');
      swipeData.prepareSwipes(originMessage);
      observedSignature = signature();
      await ctx.saveChat();
      assertContext();
      closeModal();
      if (ctx.groupId) await ctx.openGroupChat(ctx.groupId, name);
      else await ctx.openCharacterChat(name);
    };

    const moveSwipeOrder = async (fromIdx, toIdx) => {
      await commitMutation(stMsg => swipeData.moveSwipe(stMsg, fromIdx, toIdx));
      swapRenderPreviewState(fromIdx, toIdx);
      const hasFrom = selected.has(fromIdx);
      const hasTo = selected.has(toIdx);
      selected.delete(fromIdx);
      selected.delete(toIdx);
      if (hasFrom) selected.add(toIdx);
      if (hasTo) selected.add(fromIdx);
    };

    const deleteSelectedSwipes = async (indices) => {
      assertContext();
      const targets = [...new Set(indices)].sort((a, b) => a - b);
      if (!targets.length || targets.length >= swipes.length) throw new Error('请选择分支，并至少保留一个分支');
      const prompt = `确定删除 ${targets.length} 个分支（#${targets.map(i => i + 1).join('、#')}）？\n${targets.includes(currentSwipeId) ? '包含当前分支，将自动选择下一个可用分支。\n' : ''}此操作会修改当前聊天，无法撤销。`;
      const ctx = window.SillyTavern.getContext();
      const confirmed = ctx.Popup?.show?.confirm
        ? await ctx.Popup.show.confirm('删除分支', prompt)
        : window.confirm(prompt);
      if (!confirmed) return false;
      assertContext();
      const kept = swipes.map((_, index) => index).filter(index => !targets.includes(index));
      const result = await commitMutation(async stMsg => {
        // Descending indices refer to the original selection. Each native event sees
        // the exact intermediate arrays/payload, so extension-owned indices can follow.
        for (const swipeId of [...targets].reverse()) {
          swipeData.deleteSwipes(stMsg, [swipeId]);
          const event = eventTypes?.MESSAGE_SWIPE_DELETED;
          if (event) await ctx.eventSource.emit(event, { messageId: mesId, swipeId, newSwipeId: stMsg.swipe_id });
          const latest = window.SillyTavern.getContext();
          if (closed || latest.chatId !== originChatId || latest.chat[mesId] !== originMessage) throw new Error('聊天已变化，已停止批量删除');
        }
        return { kept, current: stMsg.swipe_id };
      });
      remapRenderPreviewState(result.kept);
      setSelectionMode(false);
      return true;
    };

    const showEditSwipeModal = ({ idx, initialText }) => {
      return new Promise((resolve) => {
        const editModalId = `${modalId}-edit-${Date.now()}-${Math.random().toString(16).slice(2)}`;

        const editOverlay = document.createElement('div');
        editOverlay.id = editModalId;
        editOverlay.className = 'st-swipe-modal-overlay';
        editOverlay.innerHTML = `
          <div class="st-swipe-modal-container" style="max-width: 820px; width: min(95vw, 820px); height: auto; max-height: 90vh;">
            <div class="st-swipe-modal-header">
              <div class="st-swipe-modal-header-top">
                <span class="st-swipe-title">编辑分支 #${idx + 1}</span>
                <div class="st-swipe-header-ops">
                  <div id="${editModalId}-close" class="menu_button fa-solid fa-xmark" title="关闭"></div>
                </div>
              </div>
            </div>
            <div class="st-swipe-modal-content" style="padding-top: 14px;">
              <textarea id="${editModalId}-textarea" class="text_pole st-swipe-edit-textarea" spellcheck="false"></textarea>
              <div class="st-swipe-edit-actions">
                <button id="${editModalId}-cancel" class="menu_button">取消</button>
                <button id="${editModalId}-save" class="menu_button st-swipe-edit-save">保存</button>
              </div>
              <div class="st-swipe-setting-card-desc">提示：支持多行编辑，可使用 Ctrl/⌘ + Enter 快速保存。</div>
            </div>
          </div>
        `;

        editOverlay.setAttribute('role', 'dialog');
        editOverlay.setAttribute('aria-modal', 'true');
        editOverlay.setAttribute('aria-label', `编辑分支 ${idx + 1}`);
        prepareOverlayKeyboard(editOverlay);
        document.body.appendChild(editOverlay);

        const textarea = editOverlay.querySelector(`#${editModalId}-textarea`);
        const releaseEditFocus = manageOverlayFocus(editOverlay, {
          initialFocus: textarea,
          returnFocus: () => modalOverlay.querySelector(`.st-swipe-card[data-idx="${idx}"] .st-swipe-action-edit`),
          canRestore: () => !closed,
        });
        if (textarea) {
          textarea.value = String(initialText ?? '');
          const len = textarea.value.length;
          textarea.setSelectionRange(len, len);
        }

        let editClosed = false;
        const done = (value) => {
          if (editClosed) return;
          editClosed = true;
          releaseEditFocus();
          editOverlay.remove();
          window.removeEventListener('keydown', onKeydown, true);
          cancelEdit = null;
          resolve(value);
        };
        cancelEdit = () => done(null);

        const onKeydown = (e) => {
          if (!isTopSwipeOverlay(editOverlay)) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (!e.isComposing && e.keyCode !== 229 && !e.repeat) done(null);
            return;
          }

          const isSaveHotkey = (e.key === 'Enter') && (e.ctrlKey || e.metaKey);
          if (isSaveHotkey) {
            e.preventDefault();
            e.stopImmediatePropagation();
            if (!e.isComposing && e.keyCode !== 229 && !e.repeat) done(textarea?.value ?? '');
          }
        };
        window.addEventListener('keydown', onKeydown, true);

        editOverlay.querySelector(`#${editModalId}-close`)?.addEventListener('click', () => done(null));
        editOverlay.querySelector(`#${editModalId}-cancel`)?.addEventListener('click', () => done(null));
        editOverlay.querySelector(`#${editModalId}-save`)?.addEventListener('click', () => done(textarea?.value ?? ''));
        editOverlay.addEventListener('click', (e) => {
          if (e.target === editOverlay) done(null);
        });
      });
    };

    const editSwipe = async (targetSwipeIdx) => {
      const stMsg = assertContext().chat[mesId];
      if (!Array.isArray(stMsg.swipes) || targetSwipeIdx < 0 || targetSwipeIdx >= stMsg.swipes.length) throw new Error('目标分支不存在');
      const oldText = targetSwipeIdx === stMsg.swipe_id ? stMsg.mes : String(stMsg.swipes[targetSwipeIdx] ?? '');
      const editedText = await showEditSwipeModal({ idx: targetSwipeIdx, initialText: oldText });
      if (editedText === null || editedText === oldText) return false;
      await commitMutation(message => {
        swipeData.prepareSwipes(message);
        message.swipes[targetSwipeIdx] = editedText;
        // Cached token counts refer to the old text.
        if (message.swipe_info[targetSwipeIdx]?.extra) delete message.swipe_info[targetSwipeIdx].extra.token_count;
        if (message.swipe_id === targetSwipeIdx) swipeData.activateSwipe(message, targetSwipeIdx);
      }, targetSwipeIdx === stMsg.swipe_id ? 'MESSAGE_EDITED' : null);
      return true;
    };

    function bindDynamicEvents() {
      // Delegate below: no per-card listeners are needed after list rebuilds.
    }

    modalOverlay.addEventListener('click', event => {
      const target = event.target.closest('[data-idx], [data-selection]');
      if (!target || busy) return;
      const action = target.dataset.selection;
      if (action) {
        if (!selectionMode || target.disabled) return;
        if (action === 'exit') return setSelectionMode(false);
        if (action === 'delete') {
          void withMutation(async () => {
            if (await deleteSelectedSwipes([...selected])) await refreshModalList();
          });
          return;
        }
        if (action === 'invert') {
          swipes.forEach((_, idx) => {
            if (selected.has(idx)) selected.delete(idx);
            else selected.add(idx);
          });
        } else {
          selected.clear();
          if (action === 'all' || action === 'others') swipes.forEach((_, i) => {
            if (action === 'all' || i !== currentSwipeId) selected.add(i);
          });
        }
        updateSelection();
        return;
      }
      const idx = Number(target.dataset.idx);
      if (target.classList.contains('st-swipe-jump-item')) {
        if (selectionMode) {
          if (selected.has(idx)) selected.delete(idx);
          else selected.add(idx);
          updateSelection();
        } else scrollToIdx(idx);
        return;
      }
      currentViewIdx = idx;
      if (target.classList.contains('st-swipe-action-render-one')) {
        renderPreviewByIdx.set(idx, !getEffectiveRender(idx));
        renderCard(idx);
        updateRenderButtonStates();
        return;
      }
      if (!target.matches('button:not([disabled])')) return;
      event.preventDefault();
      void withMutation(async () => {
        if (target.classList.contains('st-swipe-action-switch')) return jumpToSwipe(idx);
        if (target.classList.contains('st-swipe-action-branch')) return createBranchFromSwipe(idx);
        if (target.classList.contains('st-swipe-action-edit')) {
          if (await editSwipe(idx)) {
            await refreshModalList({ focusIdx: idx });
            // Saving replaces the card DOM after the editor's return-focus microtask.
            // Reacquire its control, but never take focus from a newer overlay/chat.
            if (!closed && isTopSwipeOverlay(modalOverlay)) {
              modalOverlay.querySelector(`.st-swipe-card[data-idx="${idx}"] .st-swipe-action-edit`)?.focus({ preventScroll: true });
            }
          }

        } else if (target.classList.contains('st-swipe-action-move-up') || target.classList.contains('st-swipe-action-move-down')) {
          const next = idx + (target.classList.contains('st-swipe-action-move-up') ? -1 : 1);
          await moveSwipeOrder(idx, next);
          await refreshModalList({ focusIdx: next });
        }
      });
    });

    // Register lifecycle handlers before the first asynchronous render.
    const previewObserver = new MutationObserver(() => { if (!modalOverlay.isConnected) closeModal(); });
    previewObserver.observe(document.body, { childList: true });
    closeActivePreview = closeModal;
    const eventBindings = [];
    const bindChatEvent = (name, handler) => {
      const type = eventTypes?.[name];
      if (!type) return;
      originContext.eventSource.on(type, handler);
      eventBindings.push([type, handler]);
    };
    bindChatEvent('CHAT_CHANGED', closeModal);
    bindChatEvent('GENERATION_STARTED', closeModal);
    const onExternalUpdate = () => {
      if (busy || closed) return;
      // Index-based selection must never survive externally reordered/removed messages.
      closeModal();
    };
    for (const name of ['MESSAGE_SWIPED', 'MESSAGE_UPDATED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPE_DELETED']) bindChatEvent(name, onExternalUpdate);

    modalOverlay.querySelector(`#${modalId}-delete-mode`)?.addEventListener('click', () => {
      if (!busy) setSelectionMode(!selectionMode);
    });
    modalOverlay.querySelector(`#${modalId}-tree`)?.addEventListener('click', () => {
      if (busy || closed) return;
      void openBranchTree({ mesId, swipeIdx: currentViewIdx, source: modalOverlay,
        isValid: () => !closed && modalOverlay.isConnected });
    });

    // Bind dismissal before any initial async rendering/import can stall.
    modalOverlay.querySelector(`#${modalId}-close`)?.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
    const releaseFocus = manageOverlayFocus(modalOverlay, {
      initialFocus: modalOverlay.querySelector(`#${modalId}-close`), returnFocus,
      onEscape: onKeydown,
      canRestore: () => {
        const context = window.SillyTavern?.getContext?.();
        return context?.chat === originChat && context?.chatId === originChatId && context?.chat?.[mesId] === originMessage;
      },
    });

    // 初次打开预览：按当前设置决定是否应用正则，并渲染列表
    try {
      await refreshModalList({ focusIdx: currentViewIdx });
    } catch (error) {
      closeModal();
      throw error;
    }
    if (closed) return;

    modalOverlay.querySelector(`#${modalId}-prev`)?.addEventListener('click', () => scrollToIdx(Math.max(0, currentViewIdx - 1)));
    modalOverlay.querySelector(`#${modalId}-next`)?.addEventListener('click', () => scrollToIdx(Math.min(Math.max(swipes.length - 1, 0), currentViewIdx + 1)));
    modalOverlay.querySelector(`#${modalId}-toggle`)?.addEventListener('click', () => {
      if (!selectionMode) jumpListEl.classList.toggle('hidden');
    });

    // 右上角：渲染预览（全局开关）
    modalOverlay.querySelector(`#${modalId}-render`)?.addEventListener('click', () => {
      renderPreviewGlobal = !renderPreviewGlobal;
      renderAllCards();
    });

    // 右上角：设置按钮
    modalOverlay.querySelector(`#${modalId}-settings`)?.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showSettingsModal({
        returnFocus: modalOverlay.querySelector(`#${modalId}-settings`),
        onSettingsChanged: async () => {
          // 让设置开关即时生效（无需关闭重开预览窗口）
          // - 文本 Markdown：直接重渲染
          // - 预览正则：重新跑 regex 后再重渲染
          try {
            await recomputeSwipeTexts();
          } catch { }
          renderAllCards();
        }
      });
    });

    // 绑定关闭逻辑
    function closeModal() {
      if (closed) return;
      closed = true;
      cancelEdit?.();
      releaseFocus();
      previewObserver.disconnect();
      if (closeActivePreview === closeModal) closeActivePreview = null;
      for (const [type, handler] of eventBindings) originContext.eventSource.removeListener(type, handler);
      modalOverlay.remove();
      window.removeEventListener('message', onIframeMessage);
    }

    function onKeydown(e) {
      if (e.key === 'Escape' && isTopSwipeOverlay(modalOverlay)) {
        if (selectionMode && !busy) {
          e.preventDefault();
          setSelectionMode(false);
          modalOverlay.querySelector(`#${modalId}-delete-mode`)?.focus();
        } else if (!busy) closeModal();
      }
    }

  }

  init();
})();
