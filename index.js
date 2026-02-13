(async function () {
  const PLUGIN_ID = "swipe-previewer";

  const BTN_PREVIEW_ID = PLUGIN_ID;

  const SETTINGS_KEY = "st-swipe-previewer-settings";
  const DEFAULT_SETTINGS = {
    /** 将按钮移动到 ... 菜单（.extraMesButtons） */
    moveButtonsToExtraMenu: false,
    /** 预览时应用酒馆正则（AI 输出 placement=2） */
    applyTavernRegex: false,
    /** 未开启渲染预览（iframe）时，也以“轻量 Markdown”方式渲染文本（加粗/删除线/引用等 + 引号高亮） */
    renderMarkdownInTextView: false,
  };

  /** @type {any} */
  let ST_API;
  let settings = loadSettings();
  /** @type {'mes'|'extra'|null} */
  let registeredMode = null;

  async function init() {
    // 插件依赖于 st-api-wrapper 提供的全局 API
    ST_API = window.ST_API;
    if (!ST_API) {
      console.warn("[Swipe Previewer] ST_API 未就绪，正在等待...");
      setTimeout(init, 1000);
      return;
    }

    await applyButtonRegistration();
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
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return settings;
  }

  async function unregisterButtons() {
    // 注：unregister 是幂等操作，调用不存在的 ID 不会抛错（wrapper 文档如此；同时这里也 catch 以防万一）
    try { await ST_API.ui.unregisterMessageButton({ id: BTN_PREVIEW_ID }); } catch { }
    try { await ST_API.ui.unregisterExtraMessageButton({ id: BTN_PREVIEW_ID }); } catch { }
  }

  async function applyButtonRegistration() {
    const mode = settings.moveButtonsToExtraMenu ? 'extra' : 'mes';
    if (registeredMode === mode) return;

    await unregisterButtons();

    // 仅注册“分支预览”按钮；“设置”按钮移到预览窗口右上角操作区
    if (mode === 'mes') {
      // 注册消息按钮（与 Edit 同级，位于 .mes_buttons）
      await ST_API.ui.registerMessageButton({
        id: BTN_PREVIEW_ID,
        icon: "fa-solid fa-layer-group",
        title: "预览所有生成的回复 (Swipes)",
        index: 0,
        onClick: async (mesId, messageElement) => {
          await onPreviewClick(mesId, messageElement);
        },
      });
    } else {
      // 注册扩展消息按钮（在 ... 展开菜单内，位于 .extraMesButtons）
      await ST_API.ui.registerExtraMessageButton({
        id: BTN_PREVIEW_ID,
        icon: "fa-solid fa-layer-group",
        title: "预览所有生成的回复 (Swipes)",
        index: 0,
        onClick: async (mesId, messageElement) => {
          await onPreviewClick(mesId, messageElement);
        },
      });
    }

    registeredMode = mode;
  }

  async function onPreviewClick(mesId, messageElement) {
    try {
      // 获取包含所有分支的消息数据
      const res = await ST_API.chatHistory.get({
        index: mesId,
        includeSwipes: true
      });
      const message = res.message;

      if (!message.swipes || message.swipes.length <= 1) {
        window.toastr?.info?.("该消息没有多个分支可供预览");
        return;
      }

      await showModal(mesId, message, messageElement);
    } catch (err) {
      console.error("[Swipe Previewer] 预览失败:", err);
      window.toastr?.error?.("获取分支内容失败");
    }
  }

  function showSettingsModal(opts = {}) {
    const { onSettingsChanged } = opts || {};

    const modalId = "st-swipe-previewer-settings-modal";
    document.getElementById(modalId)?.remove();

    const overlay = document.createElement('div');
    overlay.id = modalId;
    overlay.className = 'st-swipe-modal-overlay';

    overlay.innerHTML = `
      <div class="st-swipe-modal-container" style="max-width: 700px; height: auto; max-height: 85vh;">
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

    document.body.appendChild(overlay);

    const closeModal = () => overlay.remove();
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
  async function showModal(mesId, message, messageElement) {
    const modalId = "st-swipe-preview-modal";
    document.getElementById(modalId)?.remove();

    let swipes = Array.isArray(message?.swipes) ? [...message.swipes] : [];
    let currentSwipeId = Number.isInteger(message?.swipeId) ? message.swipeId : 0;

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
              <div id="${modalId}-prev" class="menu_button fa-solid fa-chevron-left" title="上一个"></div>
              <div id="${modalId}-next" class="menu_button fa-solid fa-chevron-right" title="下一个"></div>
              <div id="${modalId}-toggle" class="menu_button fa-solid fa-list-ol" title="展开/收起列表"></div>
              <div id="${modalId}-render" class="menu_button fa-solid fa-code" title="渲染预览 (iframe)"></div>
              <div id="${modalId}-settings" class="menu_button fa-solid fa-gear" title="设置"></div>
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

        <div class="st-swipe-modal-content" id="${modalId}-content">
          <div class="st-swipe-loading">正在加载分支内容...</div>
        </div>
      </div>
    `;

    document.body.appendChild(modalOverlay);

    // 状态
    let currentViewIdx = currentSwipeId;
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
      if (!frame) return;

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

      if (Array.isArray(stMsg?.swipes)) {
        swipes = stMsg.swipes;
        message.swipes = stMsg.swipes;
      } else {
        swipes = Array.isArray(message?.swipes) ? message.swipes : [];
      }

      const rawCurrent = Number.isInteger(stMsg?.swipe_id)
        ? stMsg.swipe_id
        : (Number.isInteger(message?.swipeId) ? message.swipeId : 0);
      currentSwipeId = clampSwipeIdx(rawCurrent, swipes.length);
      message.swipeId = currentSwipeId;

      currentViewIdx = clampSwipeIdx(currentViewIdx, swipes.length);
      swipeTextsRaw = swipes.map(getSwipeText);
      swipeTexts = swipeTextsRaw;
    };

    const contentEl = modalOverlay.querySelector(`#${modalId}-content`);
    const jumpListEl = modalOverlay.querySelector(`#${modalId}-jump-list`);
    const titleEl = modalOverlay.querySelector('.st-swipe-title');

    // 可选：应用酒馆正则（global + scoped + preset）
    async function importRegexEngine() {
      try {
        return await eval('import("/scripts/extensions/regex/engine.js")');
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

      const { getScriptsByType, SCRIPT_TYPES, runRegexScript } = engine;
      if (!getScriptsByType || !SCRIPT_TYPES || !runRegexScript) return text;

      const options = { allowedOnly: true };
      const globalScripts = (getScriptsByType(SCRIPT_TYPES.GLOBAL, options) || []);
      const scopedScripts = (getScriptsByType(SCRIPT_TYPES.SCOPED, options) || []);
      const presetScripts = (getScriptsByType(SCRIPT_TYPES.PRESET, options) || []);

      const scripts = [...globalScripts, ...scopedScripts, ...presetScripts];

      let out = String(text ?? '');
      for (const s of scripts) {
        try {
          if (!s || s.disabled) continue;

          const p = s.placement;
          const placements = Array.isArray(p) ? p : (typeof p === 'number' ? [p] : []);
          if (placements.length > 0 && !placements.includes(placement)) continue;

          // 预览属于用户显示视图：跳过 promptOnly 的脚本
          if (s.promptOnly) continue;

          out = runRegexScript(s, out);
        } catch (e) {
          console.warn('[Swipe Previewer] runRegexScript failed', e);
        }
      }
      return out;
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
          return await applyAllTavernRegex(t, 2);
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
        <div class="st-swipe-jump-item ${idx === currentSwipeId ? 'active' : ''}" data-idx="${idx}">
          ${idx + 1}
        </div>
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
                <button class="menu_button st-swipe-action-delete" data-idx="${idx}" title="删除该分支">删除分支</button>
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
        const v = getComputedStyle(document.documentElement).getPropertyValue(name);
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
      const mdEmColor = getRootCssVar('--st-swipe-previewer-md-em-color', '#67c5ff');
      const mdStrongColor = getRootCssVar('--st-swipe-previewer-md-strong-color', '#ffa011');
      const mdQuoteColor = getRootCssVar('--st-swipe-previewer-md-quote-color', '#7dd3fc');
      const mdQuoteBg = getRootCssVar('--st-swipe-previewer-md-quote-bg', 'rgba(125, 211, 252, 0.10)');

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
        setInterval(send, 1000);
      })();`;

      return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 12px; font-family: var(--main-font, sans-serif); background: #111; color: #eee; line-height: 1.6; }
  img { max-width: 100%; height: auto; }

  /* 简洁的代码块 + 自动换行 */
  pre {
    overflow-x: hidden;
    overflow-y: auto;
    padding: 8px 10px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.10);
    border-radius: 6px;
    margin: 6px 0;
    white-space: pre-wrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.95em;
  }

  code {
    background: rgba(255,255,255,0.06);
    padding: 0 4px;
    border-radius: 4px;
    white-space: pre-wrap;
    word-break: break-word;
    overflow-wrap: anywhere;
  }

  pre code { background: transparent; padding: 0; border-radius: 0; }

  a { color: #6ea8fe; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid rgba(255,255,255,0.15); padding: 6px 8px; }
  blockquote { border-left: 3px solid rgba(255,255,255,0.25); margin: 8px 0; padding-left: 10px; }

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

    const scrollToIdx = (idx, behavior = 'smooth') => {
      if (!swipes.length) {
        currentViewIdx = 0;
        return;
      }

      const targetIdx = clampSwipeIdx(idx, swipes.length);
      currentViewIdx = targetIdx;

      const card = document.getElementById(`${modalId}-card-${targetIdx}`);
      if (card) {
        card.scrollIntoView({ behavior, block: 'start' });
      }
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

    const removeRenderPreviewStateAt = (targetIdx) => {
      const next = new Map();
      for (const [idx, value] of renderPreviewByIdx.entries()) {
        if (idx < targetIdx) next.set(idx, value);
        else if (idx > targetIdx) next.set(idx - 1, value);
      }
      renderPreviewByIdx.clear();
      for (const [idx, value] of next.entries()) {
        renderPreviewByIdx.set(idx, value);
      }
    };

    async function refreshModalList(opts = {}) {
      const { focusIdx = currentViewIdx, keepScroll = true } = opts;
      syncSwipesFromChat();
      await recomputeSwipeTexts();
      renderTitle();
      renderJumpList();
      renderCardsMarkup();
      bindDynamicEvents();
      renderAllCards();
      if (keepScroll) scrollToIdx(focusIdx, 'auto');
    }

    // 对外操作：将分支应用到聊天中
    const applySwipeToChat = async (targetSwipeIdx) => {
      const ctx = window.SillyTavern?.getContext?.();
      const chat = ctx?.chat;
      const stMsg = chat?.[mesId];

      if (!stMsg) throw new Error(`找不到 chat[${mesId}]`);
      if (!Array.isArray(stMsg.swipes) || targetSwipeIdx < 0 || targetSwipeIdx >= stMsg.swipes.length) {
        throw new Error('目标分支不存在');
      }

      // 应用到酒馆内部数据
      stMsg.swipe_id = targetSwipeIdx;
      stMsg.mes = stMsg.swipes[targetSwipeIdx];

      // 尝试同步该分支的媒体信息（如果酒馆提供 swipe_info）
      try {
        const swipeMedia = stMsg.swipe_info?.[targetSwipeIdx]?.extra?.media;
        if (Array.isArray(swipeMedia)) {
          stMsg.extra = { ...(stMsg.extra || {}), media: swipeMedia, media_index: 0, inline_image: true };
        }
      } catch { }

      // 同步 UI
      if (typeof ctx?.updateMessageBlock === 'function') {
        ctx.updateMessageBlock(mesId, stMsg);
      } else {
        // 兜底：触发 chat changed
        ctx?.eventSource?.emit?.(ctx?.event_types?.CHAT_CHANGED);
      }

      // 同步 swipes-counter（例如：1/14）
      try {
        const mesEl = document.querySelector(`#chat .mes[mesid="${mesId}"]`);
        const counter = mesEl?.querySelector?.('.swipes-counter');
        const total = Array.isArray(stMsg.swipes) ? stMsg.swipes.length : null;
        if (counter && total) {
          counter.textContent = `${targetSwipeIdx + 1}/${total}`;
        }
      } catch { }

      // 持久化
      if (typeof ctx?.saveChat === 'function') {
        await ctx.saveChat();
      }

      message.swipes = stMsg.swipes;
      message.swipeId = targetSwipeIdx;
    };

    const jumpToSwipe = async (targetSwipeIdx) => {
      await applySwipeToChat(targetSwipeIdx);
      closeModal();
      setTimeout(() => {
        try {
          ST_API.ui.scrollChat({ target: 'bottom', behavior: 'smooth' });
        } catch { }
      }, 80);
    };

    const createBranchFromSwipe = async (targetSwipeIdx) => {
      await applySwipeToChat(targetSwipeIdx);

      const mesEl = messageElement || document.querySelector(`#chat .mes[mesid="${mesId}"]`);
      const btn = mesEl?.querySelector?.('.mes_create_branch');

      if (!btn) {
        window.toastr?.error?.('找不到“创建分支”按钮，可能不是 AI 楼层或酒馆版本不支持');
        return;
      }

      // 使用酒馆原生功能创建分支
      btn.click();
      closeModal();
    };

    const swapArrayItem = (arr, a, b) => {
      const t = arr[a];
      arr[a] = arr[b];
      arr[b] = t;
    };

    const moveSwipeOrder = async (fromIdx, toIdx) => {
      const ctx = window.SillyTavern?.getContext?.();
      const chat = ctx?.chat;
      const stMsg = chat?.[mesId];

      if (!stMsg) throw new Error(`找不到 chat[${mesId}]`);
      if (!Array.isArray(stMsg.swipes)) throw new Error('当前消息没有分支数据');
      if (fromIdx === toIdx) return;

      const maxIdx = stMsg.swipes.length - 1;
      if (fromIdx < 0 || toIdx < 0 || fromIdx > maxIdx || toIdx > maxIdx) {
        throw new Error('目标分支下标越界');
      }
      swapRenderPreviewState(fromIdx, toIdx);

      swapArrayItem(stMsg.swipes, fromIdx, toIdx);
      if (Array.isArray(stMsg.swipe_info) && stMsg.swipe_info.length > Math.max(fromIdx, toIdx)) {
        swapArrayItem(stMsg.swipe_info, fromIdx, toIdx);
      }

      const current = Number.isInteger(stMsg.swipe_id) ? stMsg.swipe_id : 0;
      let nextCurrent = current;
      if (current === fromIdx) nextCurrent = toIdx;
      else if (current === toIdx) nextCurrent = fromIdx;

      nextCurrent = Math.min(Math.max(nextCurrent, 0), stMsg.swipes.length - 1);
      await applySwipeToChat(nextCurrent);
    };

    const deleteSwipe = async (targetSwipeIdx) => {
      const shouldDelete = typeof window.confirm === 'function'
        ? window.confirm(`确定要删除分支 #${targetSwipeIdx + 1} 吗？\n此操作会直接修改当前聊天记录。`)
        : true;
      if (!shouldDelete) return false;

      const ctx = window.SillyTavern?.getContext?.();
      const chat = ctx?.chat;
      const stMsg = chat?.[mesId];

      if (!stMsg) throw new Error(`找不到 chat[${mesId}]`);
      if (!Array.isArray(stMsg.swipes) || stMsg.swipes.length <= 1) {
        throw new Error('至少需要保留一个分支');
      }
      if (targetSwipeIdx < 0 || targetSwipeIdx >= stMsg.swipes.length) {
        throw new Error('目标分支不存在');
      }
      removeRenderPreviewStateAt(targetSwipeIdx);

      stMsg.swipes.splice(targetSwipeIdx, 1);
      if (Array.isArray(stMsg.swipe_info) && stMsg.swipe_info.length > targetSwipeIdx) {
        stMsg.swipe_info.splice(targetSwipeIdx, 1);
      }

      const current = Number.isInteger(stMsg.swipe_id) ? stMsg.swipe_id : 0;
      const nextCurrent = Math.min(Math.max(targetSwipeIdx < current ? current - 1 : current, 0), stMsg.swipes.length - 1);
      await applySwipeToChat(nextCurrent);
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
              <textarea id="${editModalId}-textarea" class="st-swipe-edit-textarea" spellcheck="false"></textarea>
              <div class="st-swipe-edit-actions">
                <button id="${editModalId}-cancel" class="menu_button">取消</button>
                <button id="${editModalId}-save" class="menu_button st-swipe-edit-save">保存</button>
              </div>
              <div class="st-swipe-setting-card-desc">提示：支持多行编辑，可使用 Ctrl/⌘ + Enter 快速保存。</div>
            </div>
          </div>
        `;

        document.body.appendChild(editOverlay);

        const textarea = editOverlay.querySelector(`#${editModalId}-textarea`);
        if (textarea) {
          textarea.value = String(initialText ?? '');
          textarea.focus();
          const len = textarea.value.length;
          textarea.setSelectionRange(len, len);
        }

        let closed = false;
        const done = (value) => {
          if (closed) return;
          closed = true;
          editOverlay.remove();
          window.removeEventListener('keydown', onKeydown, true);
          resolve(value);
        };

        const onKeydown = (e) => {
          if (!document.getElementById(editModalId)) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            done(null);
            return;
          }

          const isSaveHotkey = (e.key === 'Enter') && (e.ctrlKey || e.metaKey);
          if (isSaveHotkey) {
            e.preventDefault();
            done(textarea?.value ?? '');
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
      const ctx = window.SillyTavern?.getContext?.();
      const chat = ctx?.chat;
      const stMsg = chat?.[mesId];

      if (!stMsg) throw new Error(`找不到 chat[${mesId}]`);
      if (!Array.isArray(stMsg.swipes) || targetSwipeIdx < 0 || targetSwipeIdx >= stMsg.swipes.length) {
        throw new Error('目标分支不存在');
      }

      const oldText = String(stMsg.swipes[targetSwipeIdx] ?? '');
      const editedText = await showEditSwipeModal({ idx: targetSwipeIdx, initialText: oldText });
      if (editedText === null) return false;
      if (editedText === oldText) return false;

      stMsg.swipes[targetSwipeIdx] = editedText;

      const current = Number.isInteger(stMsg.swipe_id) ? stMsg.swipe_id : 0;
      if (current === targetSwipeIdx) {
        await applySwipeToChat(targetSwipeIdx);
      } else {
        if (typeof ctx?.saveChat === 'function') {
          await ctx.saveChat();
        }
        message.swipes = stMsg.swipes;
      }

      return true;
    };

    function bindDynamicEvents() {
      modalOverlay.querySelectorAll('.st-swipe-jump-item').forEach(el => {
        el.addEventListener('click', () => {
          const idx = parseInt(el.getAttribute('data-idx') || '0', 10);
          scrollToIdx(idx);
        });
      });

      modalOverlay.querySelectorAll('.st-swipe-action-switch').forEach(el => {
        el.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const idx = parseInt(el.getAttribute('data-idx') || '0', 10);
          try {
            await jumpToSwipe(idx);
          } catch (err) {
            console.error('[Swipe Previewer] switch floor content failed', err);
            window.toastr?.error?.('切换楼层内容失败');
          }
        });
      });

      modalOverlay.querySelectorAll('.st-swipe-action-branch').forEach(el => {
        el.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const idx = parseInt(el.getAttribute('data-idx') || '0', 10);
          try {
            await createBranchFromSwipe(idx);
          } catch (err) {
            console.error('[Swipe Previewer] create branch failed', err);
            window.toastr?.error?.('创建新存档失败');
          }
        });
      });

      modalOverlay.querySelectorAll('.st-swipe-action-edit').forEach(el => {
        el.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();

          const idx = parseInt(el.getAttribute('data-idx') || '0', 10);
          try {
            const changed = await editSwipe(idx);
            if (!changed) return;
            await refreshModalList({ focusIdx: idx });
            window.toastr?.success?.('分支内容已更新');
          } catch (err) {
            console.error('[Swipe Previewer] edit swipe failed', err);
            window.toastr?.error?.('编辑分支失败');
          }
        });
      });

      modalOverlay.querySelectorAll('.st-swipe-action-move-up').forEach(el => {
        el.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (el.hasAttribute('disabled')) return;

          const idx = parseInt(el.getAttribute('data-idx') || '0', 10);
          if (idx <= 0) return;

          try {
            await moveSwipeOrder(idx, idx - 1);
            await refreshModalList({ focusIdx: idx - 1 });
          } catch (err) {
            console.error('[Swipe Previewer] move swipe up failed', err);
            window.toastr?.error?.('上移分支失败');
          }
        });
      });

      modalOverlay.querySelectorAll('.st-swipe-action-move-down').forEach(el => {
        el.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (el.hasAttribute('disabled')) return;

          const idx = parseInt(el.getAttribute('data-idx') || '0', 10);
          if (idx >= swipes.length - 1) return;

          try {
            await moveSwipeOrder(idx, idx + 1);
            await refreshModalList({ focusIdx: idx + 1 });
          } catch (err) {
            console.error('[Swipe Previewer] move swipe down failed', err);
            window.toastr?.error?.('下移分支失败');
          }
        });
      });

      modalOverlay.querySelectorAll('.st-swipe-action-delete').forEach(el => {
        el.addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();

          const idx = parseInt(el.getAttribute('data-idx') || '0', 10);
          try {
            const deleted = await deleteSwipe(idx);
            if (!deleted) return;
            await refreshModalList({ focusIdx: idx });
          } catch (err) {
            console.error('[Swipe Previewer] delete swipe failed', err);
            window.toastr?.error?.('删除分支失败');
          }
        });
      });

      // 卡片点击：仅用于便捷滚动定位
      modalOverlay.querySelectorAll('.st-swipe-card').forEach(el => {
        el.addEventListener('click', () => {
          const idx = parseInt(el.getAttribute('data-idx') || '0', 10);
          currentViewIdx = idx;
        });
      });

      // 单卡：渲染预览开关（覆盖全局）
      modalOverlay.querySelectorAll('.st-swipe-action-render-one').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          const idx = parseInt(btn.getAttribute('data-idx') || '0', 10);
          const current = renderPreviewByIdx.has(idx) ? !!renderPreviewByIdx.get(idx) : getEffectiveRender(idx);
          renderPreviewByIdx.set(idx, !current);
          renderCard(idx);
          updateRenderButtonStates();
        });
      });
    }

    // 初次打开预览：按当前设置决定是否应用正则，并渲染列表
    await refreshModalList({ keepScroll: false });

    modalOverlay.querySelector(`#${modalId}-prev`)?.addEventListener('click', () => scrollToIdx(Math.max(0, currentViewIdx - 1)));
    modalOverlay.querySelector(`#${modalId}-next`)?.addEventListener('click', () => scrollToIdx(Math.min(Math.max(swipes.length - 1, 0), currentViewIdx + 1)));
    modalOverlay.querySelector(`#${modalId}-toggle`)?.addEventListener('click', () => modalOverlay.querySelector(`#${modalId}-jump-list`)?.classList.toggle('hidden'));

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
      modalOverlay.remove();
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('message', onIframeMessage);
    }

    function onKeydown(e) {
      if (e.key === 'Escape') closeModal();
    }

    modalOverlay.querySelector(`#${modalId}-close`)?.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
    window.addEventListener('keydown', onKeydown);
  }

  init();
})();
