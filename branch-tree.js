// Current-chat-only, read-only timeline. Native IDs stay zero based.
import { edgePath, edgePresentation, branchText, snippet, PATH_LABEL, CANDIDATE_LABEL,
    timelineSummaryEntries } from './timeline-graph.mjs';
import { TimelineIndex, createTimelineView, focusTimelineId, timelineWindow,
    TimelineDisplayCache, TimelineSearch } from './timeline-virtual.mjs';
import { prepareOverlayKeyboard, manageOverlayFocus, isTopSwipeOverlay } from './native-integration.mjs';
import { loadTimelinePreferences, saveTimelinePreferences } from './timeline-preferences.mjs';

const MODAL_ID = 'st-swipe-tree-modal';
const SVG_NS = 'http://www.w3.org/2000/svg';
let activeTree = null;

function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}
function button(className, text, title = text) {
    const node = element('button', `menu_button ${className}`, text);
    node.type = 'button';
    node.title = title;
    return node;
}
function iconButton(className, icon, title) {
    const node = button(className, '', title);
    const glyph = element('i', `fa-solid ${icon}`);
    glyph.setAttribute('aria-hidden', 'true');
    node.append(glyph);
    node.setAttribute('aria-label', title);
    return node;
}
function svgElement(tag, attributes = {}) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
}
function getContext() {
    const context = globalThis.SillyTavern?.getContext?.();
    if (!context || !Array.isArray(context.chat)) throw new Error('SillyTavern 聊天 context 尚未就绪');
    return context;
}
function identity(context) {
    return JSON.stringify([context.groupId ?? null, context.characterId ?? null,
        context.getCurrentChatId?.() ?? context.chatId ?? null]);
}
function archiveReferences(message) {
    // Native bookmarks.js stores branch names in extra.branches and one checkpoint name in bookmark_link.
    const refs = new Set();
    const add = name => { if (typeof name === 'string' && name.trim()) refs.add(name); };
    if (Array.isArray(message?.extra?.branches)) {
        for (const name of message.extra.branches) add(name);
    }
    add(message?.extra?.bookmark_link);
    return [...refs];
}

/** @param {{onPreview: Function, onClose?: Function, focusMesId?: number, focusSwipeIdx?: number}} options
 *  @returns {{close: () => void}} Preview callback also owns its async identity guards. */
export function showBranchTree({ onPreview, onClose, focusMesId, focusSwipeIdx } = {}) {
    activeTree?.close('replace');
    if (typeof onPreview !== 'function') throw new TypeError('showBranchTree 需要 onPreview 回调');
    const initialContext = getContext();
    const preferences = loadTimelinePreferences();
    let { scale, includeCandidates, onlyChar, onlyBranches } = preferences;
    document.getElementById(MODAL_ID)?.remove();
    const previousFocus = document.activeElement;
    const originChat = initialContext.chat, originKey = identity(initialContext);
    const overlay = element('div', 'st-swipe-modal-overlay st-swipe-tree-overlay');
    overlay.id = MODAL_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', `${MODAL_ID}-title`);
    const container = element('div', 'st-swipe-modal-container st-swipe-timeline-container');
    const header = element('div', 'st-swipe-modal-header st-swipe-timeline-header');
    const headerTop = element('div', 'st-swipe-modal-header-top');
    const title = element('span', 'st-swipe-title', '分支时间线');
    title.id = `${MODAL_ID}-title`;
    const titleGroup = element('div', 'st-swipe-timeline-title-group');
    const helpToggle = iconButton('st-swipe-timeline-help-toggle', 'fa-circle-exclamation', '图例与操作说明');
    helpToggle.removeAttribute('title'); // Avoid a second, browser-native tooltip.
    const helpPanel = element('div', 'st-swipe-timeline-help-panel');
    helpPanel.id = `${MODAL_ID}-help`;
    helpPanel.hidden = true;
    helpPanel.tabIndex = 0; // Allow keyboard scrolling when the viewport is very short.
    helpPanel.setAttribute('role', 'note');
    helpPanel.setAttribute('aria-label', '时间线图例与操作说明');
    helpToggle.setAttribute('aria-controls', helpPanel.id);
    helpToggle.setAttribute('aria-describedby', helpPanel.id);
    helpToggle.setAttribute('aria-expanded', 'false');
    titleGroup.append(title, helpToggle);
    const operations = element('div', 'st-swipe-header-ops');
    const refreshButton = button('st-swipe-tree-refresh', '刷新');
    const closeButton = button('st-swipe-tree-close', '关闭');
    operations.append(refreshButton, closeButton);
    const roleLegend = element('div', 'st-swipe-timeline-role-legend');
    roleLegend.append(element('span', 'st-swipe-timeline-legend-char', '● char 楼层'),
        element('span', 'st-swipe-timeline-legend-user', '● user 楼层'),
        element('span', '', '● 系统楼层'));
    headerTop.append(titleGroup, roleLegend, operations);
    const stats = element('div', 'st-swipe-tree-stats st-swipe-timeline-stats');
    const legend = element('div', 'st-swipe-timeline-legend');
    const pathLegend = element('strong', 'st-swipe-timeline-path-label', '实线箭头：当前选择路径');
    pathLegend.title = PATH_LABEL;
    const candidateLegend = element('span', 'st-swipe-timeline-candidate-label', '虚线：同层候选归属 / 续接未知（不与下一层相连）');
    candidateLegend.title = CANDIDATE_LABEL;
    legend.append(pathLegend, candidateLegend);
    const summary = element('div', 'st-swipe-timeline-path-summary');
    summary.setAttribute('aria-label', '主路径摘要；默认仅展示分支路口，可展开省略楼层');
    summary.tabIndex = 0;
    summary.id = `${MODAL_ID}-summary`;
    const summaryTrack = element('div', 'st-swipe-timeline-summary-track');
    summary.append(summaryTrack);
    const summaryShell = element('div', 'st-swipe-timeline-summary-shell');
    const summaryScroll = element('input', 'st-swipe-timeline-summary-scroll');
    summaryScroll.type = 'range';
    summaryScroll.min = '0';
    summaryScroll.max = '0';
    summaryScroll.step = '1';
    summaryScroll.value = '0';
    summaryScroll.hidden = true;
    summaryScroll.setAttribute('aria-label', '横向滚动路径摘要');
    summaryScroll.setAttribute('aria-controls', summary.id);
    summaryShell.append(summary, summaryScroll);
    const toolbar = element('div', 'st-swipe-timeline-toolbar');
    toolbar.id = `${MODAL_ID}-search-panel`;
    toolbar.hidden = true;
    const searchToggle = button('st-swipe-timeline-search-toggle', '', '展开/收起搜索');
    searchToggle.append(element('i', 'fa-solid fa-magnifying-glass'));
    searchToggle.setAttribute('aria-label', '展开/收起搜索');
    searchToggle.setAttribute('aria-controls', toolbar.id);
    searchToggle.setAttribute('aria-expanded', 'false');
    const search = element('input', 'text_pole st-swipe-tree-search st-swipe-timeline-search');
    search.type = 'search';
    search.placeholder = '搜索楼层、角色或正文（高亮，不删路径）';
    search.setAttribute('aria-label', search.placeholder);
    search.autocomplete = 'off';
    const previousMatch = button('st-swipe-timeline-match-prev', '上一匹配');
    const nextMatch = button('st-swipe-timeline-match-next', '下一匹配');
    const matchCount = element('span', 'st-swipe-timeline-match-count', '0 / 0');
    matchCount.setAttribute('aria-live', 'polite');
    toolbar.append(search, previousMatch, nextMatch, matchCount);
    const controls = element('div', 'st-swipe-timeline-controls');
    controls.id = `${MODAL_ID}-controls`;
    controls.hidden = !preferences.toolsExpanded;
    const toolsToggle = iconButton('st-swipe-timeline-tools-toggle', 'fa-sliders', '展开/收起画布工具栏');
    toolsToggle.setAttribute('aria-controls', controls.id);
    toolsToggle.setAttribute('aria-expanded', String(preferences.toolsExpanded));
    const toggleCandidates = button('st-swipe-timeline-toggle-candidates', includeCandidates ? '全部' : '主干',
        includeCandidates ? '当前显示全部；点击仅显示主干' : '当前仅显示主干；点击显示全部');
    toggleCandidates.setAttribute('aria-pressed', String(includeCandidates));
    const zoomOut = iconButton('st-swipe-timeline-zoom-out', 'fa-minus', '缩小画布');
    const zoomIn = iconButton('st-swipe-timeline-zoom-in', 'fa-plus', '放大画布');
    const zoomReset = iconButton('st-swipe-timeline-zoom-reset', 'fa-rotate-left', '重置缩放为 100%');
    const zoomLabel = element('span', 'st-swipe-timeline-zoom-label', `${Math.round(scale * 100)}%`);
    const onlyCharButton = button('st-swipe-timeline-only-char', 'char', '仅显示 char 楼层');
    const onlyBranchesButton = button('st-swipe-timeline-only-branches', '隐藏无分支楼层');
    onlyCharButton.setAttribute('aria-pressed', String(onlyChar));
    onlyBranchesButton.setAttribute('aria-pressed', String(onlyBranches));
    const goHead = iconButton('st-swipe-timeline-go-head', 'fa-angles-up', '跳转首');
    const goTail = iconButton('st-swipe-timeline-go-tail', 'fa-angles-down', '跳转尾');
    const goSource = iconButton('st-swipe-timeline-go-source', 'fa-bullseye', '当前楼层');
    const zoomGroup = element('div', 'st-swipe-timeline-control-row');
    const navigationGroup = element('div', 'st-swipe-timeline-control-row');
    const filterGroup = element('div', 'st-swipe-timeline-control-row');
    zoomGroup.append(zoomIn, zoomOut, zoomReset);
    navigationGroup.append(goHead, goTail, goSource);
    filterGroup.append(toggleCandidates, onlyCharButton, onlyBranchesButton);
    controls.append(zoomGroup, navigationGroup, filterGroup);
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', '画布工具栏');
    const hint = element('div', 'st-swipe-timeline-hint', '楼层 # 从 0 开始。点击节点看详情；双击预览，不会切换 swipe。滚动查看，Ctrl/⌘+滚轮缩放，拖动空白平移。');
    const status = element('div', 'st-swipe-tree-status st-swipe-timeline-status', '正在读取当前聊天…');
    status.setAttribute('role', 'status');
    const locationStatus = element('div', 'st-swipe-timeline-status');
    locationStatus.setAttribute('role', 'status');
    const statusRow = element('div', 'st-swipe-timeline-status-row');
    statusRow.append(status, searchToggle);
    helpPanel.append(legend, hint);
    header.append(headerTop, stats, summaryShell, statusRow, toolbar, locationStatus);
    const content = element('div', 'st-swipe-modal-content st-swipe-tree-content st-swipe-timeline-content');
    const viewport = element('div', 'st-swipe-timeline-viewport');
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', '时间线图画布，可横向与纵向滚动；Tab访问节点');
    const spacer = element('div', 'st-swipe-timeline-spacer');
    const stage = element('div', 'st-swipe-timeline-stage');
    const edges = svgElement('svg', { class: 'st-swipe-timeline-edges', 'aria-hidden': 'true' });
    const nodes = element('div', 'st-swipe-timeline-nodes');
    stage.append(edges, nodes);
    spacer.append(stage);
    viewport.append(spacer);
    const detail = element('aside', 'st-swipe-timeline-detail');
    detail.hidden = true;
    detail.setAttribute('aria-label', '节点详情');
    const detailPane = element('div', 'st-swipe-timeline-detail-pane');
    detailPane.id = `${MODAL_ID}-detail-pane`;
    const detailCollapse = element('button', 'st-swipe-timeline-detail-collapse');
    detailCollapse.type = 'button';
    detailCollapse.title = '收起节点详情';
    detailCollapse.setAttribute('aria-label', '收起节点详情');
    detailCollapse.setAttribute('aria-controls', detailPane.id);
    detailCollapse.addEventListener('click', () => {
        detail.hidden = true;
        nodeElements.get(selectedId)?.focus({ preventScroll: true });
    });
    detail.append(detailCollapse, detailPane);
    const canvas = element('div', 'st-swipe-timeline-canvas');
    const tools = element('div', 'st-swipe-timeline-tools');
    const toolsHeading = element('div', 'st-swipe-timeline-tools-heading');
    toolsHeading.append(toolsToggle, zoomLabel);
    tools.append(toolsHeading, controls);
    canvas.append(viewport, tools);
    content.append(canvas, detail);
    container.append(header, content);
    // The help floats outside the scroll-clipped header/container, but within the focus scope.
    overlay.append(container, helpPanel);
    prepareOverlayKeyboard(overlay);
    document.body.append(overlay);

    let closed = false;
    let chatKey = identity(initialContext);
    let chatArray = initialContext.chat;
    let revision = 0;
    let graphToken = -1;
    let searchRevision = 0;
    let renderRevision = 0;
    let summaryRevision = 0;
    const expandedSummary = new Set();
    let refreshTimer;
    let messageTimer = 0;
    let searchTimer;
    let graph = null;
    let visibleGraph = null;
    let anchorMesId = focusMesId;
    let anchorSwipeIdx = focusSwipeIdx;
    let sourceAvailable = true;
    let layout = null;
    let stageOffsetX = 0;
    let lastViewportWidth = 0;
    let selectedId = null;
    let matches = [];
    let matchIndex = -1;
    let drag = null;
    const nodeElements = new Map();
    const edgeElements = new Map(), gapElements = new Map(), summaryElements = new Map();
    const dirtyFloors = new Set();
    const SUMMARY_STEP = 112; // 96px chip + 16px gap; keep timeline.css in sync.
    let summaryItems = [], displayCache, searchIndex;
    let matchIds = new Set(), pendingFocus = null, needsResize = false, pendingZoom = null;
    let completedQuery = null, searchPending = false;
    const rows = new Map();
    const subscriptions = [];
    const pendingYields = new Map();
    let observer;
    let resizeObserver;
    let resizeFrame = 0;
    let helpPinned = false;
    let helpHideTimer = 0;

    function hideHelp() {
        const restoreFocus = helpPanel.contains(document.activeElement);
        clearTimeout(helpHideTimer);
        helpHideTimer = 0;
        helpPinned = false;
        helpPanel.hidden = true;
        helpToggle.setAttribute('aria-expanded', 'false');
        if (!closed && restoreFocus) helpToggle.focus({ preventScroll: true });
    }
    function positionHelp() {
        if (helpPanel.hidden || closed) return;
        const anchor = helpToggle.getBoundingClientRect();
        const root = overlay.getBoundingClientRect();
        const box = helpPanel.getBoundingClientRect();
        const width = document.documentElement.clientWidth;
        const height = document.documentElement.clientHeight;
        const margin = 12, gap = 8;
        const left = Math.max(margin, Math.min(anchor.left, width - box.width - margin));
        const below = anchor.bottom + gap;
        const above = anchor.top - gap - box.height;
        const top = below + box.height <= height - margin ? below
            : above >= margin ? above : Math.max(margin, height - box.height - margin);
        helpPanel.style.left = `${left - root.left}px`;
        helpPanel.style.top = `${top - root.top}px`;
    }
    function showHelp() {
        if (closed || !isTopSwipeOverlay(overlay)) return;
        clearTimeout(helpHideTimer);
        helpPanel.hidden = false;
        helpToggle.setAttribute('aria-expanded', 'true');
        positionHelp();
    }
    function scheduleHelpHide() {
        clearTimeout(helpHideTimer);
        if (closed || helpPinned) return;
        // Keep the help readable while the pointer crosses the small anchor/panel gap.
        helpHideTimer = setTimeout(() => {
            if (!helpPinned && !helpToggle.matches(':hover') && !helpPanel.matches(':hover')
                && !helpPanel.contains(document.activeElement)) hideHelp();
        }, 140);
    }
    helpToggle.addEventListener('pointerenter', event => { if (event.pointerType === 'mouse') showHelp(); });
    helpToggle.addEventListener('pointerleave', scheduleHelpHide);
    helpPanel.addEventListener('pointerenter', () => clearTimeout(helpHideTimer));
    helpPanel.addEventListener('pointerleave', scheduleHelpHide);
    helpPanel.addEventListener('focusout', scheduleHelpHide);
    helpToggle.addEventListener('click', () => {
        if (!isTopSwipeOverlay(overlay)) return;
        if (helpPinned) hideHelp();
        else { helpPinned = true; showHelp(); }
    });
    overlay.addEventListener('click', event => {
        if (helpPanel.hidden || !isTopSwipeOverlay(overlay)
            || helpPanel.contains(event.target) || helpToggle.contains(event.target)) return;
        hideHelp();
        // A backdrop click dismisses the small help first, not the whole tree as well.
        if (event.target === overlay) { event.preventDefault(); event.stopPropagation(); }
    }, true);
    header.addEventListener('scroll', hideHelp, { passive: true });

    function pause() {
        return new Promise(resolve => {
            const timer = setTimeout(() => { pendingYields.delete(timer); resolve(); }, 0);
            pendingYields.set(timer, resolve);
        });
    }
    function close(reason = 'dismiss') {
        if (closed) return;
        closed = true;
        hideHelp();
        revision++;
        searchRevision++;
        searchIndex?.cancel();
        renderRevision++;
        summaryRevision++;
        clearTimeout(refreshTimer);
        clearTimeout(messageTimer); messageTimer = 0;
        clearTimeout(searchTimer);
        for (const [timer, resolve] of pendingYields) { clearTimeout(timer); resolve(); }
        pendingYields.clear();
        observer?.disconnect();
        resizeObserver?.disconnect();
        cancelAnimationFrame(resizeFrame);
        releaseFocus(reason === 'dismiss');
        for (const [source, event, handler] of subscriptions) source.removeListener(event, handler);
        stopDrag();
        overlay.remove();
        rows.clear();
        nodeElements.clear(); edgeElements.clear(); gapElements.clear(); summaryElements.clear();
        displayCache?.entries.clear(); summaryItems = []; matchIds.clear(); matches = [];
        searchIndex = null; displayCache = null; visibleGraph = null; layout = null;
        graph = null;
        if (activeTree?.close === close) activeTree = null;
        onClose?.(reason);
    }
    function sameChat() {
        if (closed || !overlay.isConnected) return false;
        try {
            const context = getContext();
            return identity(context) === chatKey && context.chat === chatArray;
        } catch { return false; }
    }
    function valid(token) { return token === revision && sameChat(); }
    function rowIsCurrent(row, token) {
        return row && valid(token) && !dirtyFloors.has(row.id)
            && graph?.byId.get(row.id)?.version === row.version && getContext().chat[row.id] === row.message;
    }
    function report(error, fallback) {
        console.error('[Swipe Previewer] 时间线:', error);
        if (!closed) status.textContent = `${fallback}：${error?.message || String(error)}`;
        else globalThis.toastr?.error?.(fallback);
    }
    async function locate(row, node, token) {
        node.disabled = true;
        try {
            if (!rowIsCurrent(row, token)) return;
            const selector = `#chat .mes[mesid="${row.id}"]`;
            let target = document.querySelector(selector);
            if (!target) {
                const { showMoreMessages } = await import('/script.js');
                if (!rowIsCurrent(row, token)) return;
                while (!target) {
                    const first = document.querySelector('#chat .mes[mesid]');
                    const firstId = first ? Number(first.getAttribute('mesid')) : chatArray.length;
                    if (!Number.isInteger(firstId) || firstId <= row.id) break;
                    await showMoreMessages(Math.min(100, firstId - row.id));
                    if (!rowIsCurrent(row, token)) return;
                    target = document.querySelector(selector);
                    const next = document.querySelector('#chat .mes[mesid]');
                    if (!target && (!next || Number(next.getAttribute('mesid')) >= firstId)) break;
                    if (!target) {
                        await pause();
                        if (!rowIsCurrent(row, token)) return;
                    }
                }
            }
            if (!rowIsCurrent(row, token)) return;
            if (!target) throw new Error('历史消息尚未能加载，请刷新后重试');
            close('locate');
            target.scrollIntoView({ behavior: 'auto', block: 'center' });
        } catch (error) { report(error, '定位消息失败'); }
        finally { node.disabled = false; }
    }
    async function preview(row, data, node, token) {
        if (!rowIsCurrent(row, token)) return;
        node.disabled = true;
        try {
            close('preview'); // Do not restore/open another preview during this transition.
            await onPreview(row.id, data.swipeIdx);
        } catch (error) { report(error, '打开分支预览失败'); }
        finally { node.disabled = false; }
    }
    function showDetail(data, token) {
        const row = rows.get(data.mesId);
        if (!row || !rowIsCurrent(row, token)) return;
        if (selectedId) nodeElements.get(selectedId)?.classList.remove('st-swipe-timeline-node-selected');
        selectedId = data.id;
        anchorMesId = data.mesId;
        anchorSwipeIdx = data.swipeIdx;
        nodeElements.get(data.id)?.classList.add('st-swipe-timeline-node-selected');
        const heading = element('div', 'st-swipe-timeline-detail-heading');
        heading.append(element('strong', '', `${data.label} · ${data.isCurrent ? '当前选择' : '同层候选'}`));
        const body = element('p', 'st-swipe-timeline-detail-text', snippet(branchText(row.message, data.swipeIdx), 1400));
        const metadata = element('p', 'st-swipe-timeline-detail-meta', `${data.name} · ${data.count} 个候选`);
        const actions = element('div', 'st-swipe-timeline-detail-actions');
        const previewButton = button('st-swipe-tree-preview st-swipe-timeline-preview', '预览', '只预览，不更改聊天或 swipe');
        previewButton.dataset.mesId = String(data.mesId);
        previewButton.dataset.swipeIdx = String(data.swipeIdx);
        previewButton.addEventListener('click', () => void preview(row, data, previewButton, token));
        const locateButton = button('st-swipe-tree-locate st-swipe-timeline-locate', '定位楼层');
        locateButton.addEventListener('click', () => void locate(row, locateButton, token));
        actions.append(previewButton, locateButton);
        heading.append(actions);
        const references = element('div', 'st-swipe-timeline-references');
        const refs = archiveReferences(row.message);
        references.append(element('span', 'st-swipe-timeline-reference-status', refs.length ? '有独立存档引用' : '无独立存档引用'));
        if (refs.length) {
            const list = element('ul', 'st-swipe-timeline-reference-list');
            for (const name of refs) list.append(element('li', 'st-swipe-timeline-reference', name));
            references.append(list);
        }
        detailPane.replaceChildren(heading, metadata, body, references);
        detail.hidden = false;
        detailPane.scrollTop = 0;
    }
    function focusGraphNode(id, keyboard = false) {
        if (!valid(graphToken) || !layout) return;
        const position = layout.positions.get(id);
        if (!position) return;
        viewport.scrollLeft = Math.max(0, stageOffsetX + (position.x + position.width / 2) * scale - viewport.clientWidth / 2);
        const inset = toolsToggle.offsetHeight + 28;
        viewport.scrollTop = Math.max(0, inset + (position.y + position.height / 2) * scale - (viewport.clientHeight + inset) / 2);
        [anchorMesId, anchorSwipeIdx] = id.split(':').map(Number);
        if (keyboard) pendingFocus = id;
        scheduleFrame();
    }
    function resizeStage(preserveCenter = false) {
        if (!layout) return;
        const centerX = lastViewportWidth
            ? (viewport.scrollLeft + lastViewportWidth / 2 - stageOffsetX) / scale : layout.centerX;
        const inset = toolsToggle.offsetHeight + 28;
        lastViewportWidth = viewport.clientWidth;
        stageOffsetX = Math.max(0, (lastViewportWidth - layout.width * scale) / 2);
        spacer.style.width = `${Math.max(lastViewportWidth, layout.width * scale)}px`;
        spacer.style.height = `${layout.height * scale + inset + Math.max(0, viewport.clientHeight - inset) / 2}px`;
        stage.style.left = `${stageOffsetX}px`;
        stage.style.top = `${inset}px`;
        stage.style.width = `${layout.width}px`;
        stage.style.height = `${layout.height}px`;
        stage.style.transform = `scale(${scale})`;
        zoomLabel.textContent = `${Math.round(scale * 100)}%`;
        zoomOut.disabled = scale <= 0.3;
        zoomIn.disabled = scale >= 2;
        if (preserveCenter) viewport.scrollLeft = Math.max(0, centerX * scale + stageOffsetX - lastViewportWidth / 2);
    }
    function persistPreferences() {
        saveTimelinePreferences({ scale: pendingZoom ?? scale, includeCandidates, onlyChar, onlyBranches,
            toolsExpanded: !controls.hidden });
    }
    function setZoom(next) {
        if (!layout || !valid(graphToken)) return;
        pendingZoom = Math.max(0.3, Math.min(2, Math.round(next * 100) / 100));
        // Persist the requested zoom before rAF, even if the user closes immediately.
        persistPreferences();
        scheduleFrame();
    }
    function applyZoom(next) {
        if (!layout || !valid(graphToken)) return;
        const x = (viewport.scrollLeft + viewport.clientWidth / 2 - stageOffsetX) / scale;
        const inset = toolsToggle.offsetHeight + 28;
        const y = (viewport.scrollTop + (viewport.clientHeight - inset) / 2) / scale;
        scale = Math.max(0.3, Math.min(2, Math.round(next * 100) / 100));
        resizeStage();
        viewport.scrollLeft = Math.max(0, x * scale + stageOffsetX - viewport.clientWidth / 2);
        viewport.scrollTop = Math.max(0, y * scale - (viewport.clientHeight - inset) / 2);
        scheduleFrame();
    }
    function makeNode(data, token) {
        const node = button('st-swipe-timeline-node', '');
        node.append(element('strong', 'st-swipe-timeline-node-label'),
            element('span', 'st-swipe-timeline-node-role'), element('span', 'st-swipe-timeline-node-snippet'));
        // Detached nodes and changed floors must not dispatch stale actions. Unchanged cards keep their listeners.
        const current = () => nodeElements.get(data.id) === node && node.isConnected && valid(token)
            && node._data?.version === graph.byId.get(data.mesId)?.version && !dirtyFloors.has(data.mesId);
        node.addEventListener('click', () => { if (current()) showDetail(node._data, token); });
        node.addEventListener('dblclick', event => {
            event.preventDefault(); if (current()) void preview(rows.get(data.mesId), node._data, node, token);
        });
        nodeElements.set(data.id, node);
        return node;
    }
    function updateNode(node, data) {
        if (node._data !== data) {
            node._data = data;
            node.title = `${data.label}；点击详情，双击纯预览`;
            Object.assign(node.dataset, { nodeId: data.id, mesId: String(data.mesId), swipeIdx: String(data.swipeIdx),
                role: data.role === '角色' ? 'char' : data.role === '用户' ? 'user' : 'system', current: String(data.isCurrent) });
            node.classList.toggle('st-swipe-timeline-node-current', data.isCurrent);
            node.classList.toggle('st-swipe-timeline-node-candidate', !data.isCurrent);
            if (data.isCurrent) node.setAttribute('aria-current', 'true'); else node.removeAttribute('aria-current');
            node.children[0].textContent = `${data.label} · ${data.isCurrent ? '当前' : '候选'}`;
            node.children[1].textContent = `${data.name}（${data.role}） · ${data.count}选1`;
            node.children[2].textContent = data.summary;
        }
        const p = layout.positions.get(data.id);
        const position = `${p.x},${p.y}`;
        if (node.dataset.position !== position) {
            Object.assign(node.style, { left: `${p.x}px`, top: `${p.y}px`, width: `${p.width}px`, height: `${p.height}px` });
            node.dataset.position = position;
        }
        node.classList.toggle('st-swipe-timeline-node-selected', data.id === selectedId);
        node.classList.toggle('st-swipe-timeline-node-match', matchIds.has(data.id));
        node.classList.toggle('st-swipe-timeline-node-match-active', data.id === matches[matchIndex]);
    }
    function removeMounted(map, keep) {
        for (const [id, node] of map) if (!keep.has(id)) {
            if (node.contains(document.activeElement)) viewport.focus({ preventScroll: true });
            node.remove(); map.delete(id);
        }
    }
    function renderWindow() {
        if (!layout || !valid(graphToken)) return;
        const inset = toolsToggle.offsetHeight + 28;
        const rect = { left: (viewport.scrollLeft - stageOffsetX) / scale,
            right: (viewport.scrollLeft + viewport.clientWidth - stageOffsetX) / scale,
            top: (viewport.scrollTop - inset) / scale, bottom: (viewport.scrollTop + viewport.clientHeight - inset) / scale };
        const window = timelineWindow(layout, rect);
        // The SVG surface itself is viewport-sized. Curves use world coordinates and are clipped by viewBox,
        // avoiding an enormous SVG raster surface while retaining offscreen endpoint crossings.
        const svgX = rect.left - 180, svgY = rect.top - 180;
        const svgWidth = rect.right - rect.left + 360, svgHeight = rect.bottom - rect.top + 360;
        edges.style.left = `${svgX}px`; edges.style.top = `${svgY}px`;
        edges.setAttribute('width', String(svgWidth)); edges.setAttribute('height', String(svgHeight));
        edges.setAttribute('viewBox', `${svgX} ${svgY} ${svgWidth} ${svgHeight}`);
        displayCache.window(window.cacheIds);
        removeMounted(nodeElements, new Set(window.nodeIds));
        for (const id of window.nodeIds) {
            const data = displayCache.get(id); if (!data) continue;
            const node = nodeElements.get(id) ?? makeNode(data, graphToken);
            updateNode(node, data); if (!node.isConnected) nodes.append(node);
        }
        // Batch offscreen candidate fan-outs per target floor: crossing curves survive without unbounded SVG DOM.
        const paths = new Map();
        for (const edge of window.edges) {
            const key = edge.type === 'current-selection' ? edge.id : `candidates:${edge.to.split(':')[0]}`;
            const path = edgePath(edge, layout);
            const record = paths.get(key);
            if (record) record.parts.push(path); else paths.set(key, { edge, parts: [path] });
        }
        removeMounted(edgeElements, new Set(paths.keys()));
        for (const [key, { edge, parts }] of paths) {
            let line = edgeElements.get(key);
            if (!line) {
                const presentation = edgePresentation(edge.type);
                line = svgElement('path', { class: `st-swipe-timeline-edge ${presentation.dashed ? 'st-swipe-timeline-edge-candidate' : 'st-swipe-timeline-edge-current'}`,
                    'data-relation': edge.type, 'data-from': edge.from, 'data-to': edge.to });
                if (presentation.arrow) line.setAttribute('marker-end', 'url(#st-swipe-timeline-arrow)');
                const title = svgElement('title'); title.textContent = presentation.label; line.append(title);
                edgeElements.set(key, line); edges.append(line);
            }
            const d = parts.join(' '); if (line.getAttribute('d') !== d) line.setAttribute('d', d);
            line.dataset.from = edge.from; line.dataset.to = edge.to;
        }
        removeMounted(gapElements, new Set(window.gaps.map(g => g.id)));
        for (const gap of window.gaps) {
            let marker = gapElements.get(gap.id);
            if (!marker) { marker = element('div', 'st-swipe-timeline-gap'); gapElements.set(gap.id, marker); nodes.append(marker); }
            marker.textContent = `… 省略 ${gap.count} 楼 …`;
            marker.title = `已隐藏 #${gap.firstMesId} 至 #${gap.lastMesId}`;
            marker.style.left = `${gap.x}px`; marker.style.top = `${gap.y}px`;
        }
        if (pendingFocus) { nodeElements.get(pendingFocus)?.focus({ preventScroll: true }); pendingFocus = null; }
    }
    function scheduleFrame(resize = false) {
        needsResize ||= resize;
        if (closed || resizeFrame) return;
        resizeFrame = requestAnimationFrame(() => {
            resizeFrame = 0;
            if (closed) return;
            if (pendingZoom !== null) { const zoom = pendingZoom; pendingZoom = null; applyZoom(zoom); }
            if (needsResize) { needsResize = false; resizeStage(true); }
            renderWindow(); renderSummaryWindow(); syncSummaryScroll(); positionHelp();
        });
    }
    async function renderGraph(token, center = true, changedFloors = null) {
        if (!graph || !valid(token)) return;
        ++renderRevision;
        visibleGraph = layout = createTimelineView(graph, { onlyChar, onlyBranches, includeCandidates });
        if (!edges.querySelector('defs')) {
            const defs = svgElement('defs');
            const marker = svgElement('marker', { id: 'st-swipe-timeline-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5,
                markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' });
            marker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'st-swipe-timeline-arrow' }));
            defs.append(marker); edges.prepend(defs);
        }
        resizeStage();
        const targetId = focusTimelineId(layout, anchorMesId, anchorSwipeIdx);
        locationStatus.textContent = !targetId && graph.floors.length ? '当前筛选下没有可见楼层，请调整展示选项。' : '';
        if (center && targetId) {
            const requested = anchorMesId; selectedId = targetId; focusGraphNode(targetId);
            if (Number.isInteger(requested) && anchorMesId !== requested)
                locationStatus.textContent = `当前/定位楼层 #${requested} 已隐藏，已定位最近可见楼层 #${anchorMesId}。`;
        }
        scheduleFrame();
        await applySearch(false, changedFloors);
    }
    function syncSummaryScroll() {
        if (closed) return;
        const max = Math.max(0, summary.scrollWidth - summary.clientWidth);
        summaryScroll.hidden = max <= 1; summaryScroll.max = String(max);
        summaryScroll.value = String(Math.max(0, Math.min(max, summary.scrollLeft)));
        summaryScroll.setAttribute('aria-valuetext', `摘要横向位置 ${max ? Math.round(summary.scrollLeft / max * 100) : 0}%`);
    }
    function locateSummaryFloor(floor, token) {
        if (!valid(token) || dirtyFloors.has(floor.mesId) || !visibleGraph) return;
        const targetId = focusTimelineId(visibleGraph, floor.mesId, floor.currentSwipe);
        if (!targetId) { locationStatus.textContent = '当前筛选下没有可见楼层，请调整展示选项。'; return; }
        selectedId = targetId; focusGraphNode(targetId, true);
        locationStatus.textContent = anchorMesId !== floor.mesId
            ? `楼层 #${floor.mesId} 已被画布筛选隐藏，已定位最近可见楼层 #${anchorMesId}。` : '';
    }
    function buildSummary() {
        summaryRevision++;
        summaryItems = [];
        for (const entry of timelineSummaryEntries(graph)) {
            if (entry.kind === 'floor') summaryItems.push({ key: `floor:${entry.floor.mesId}`, floor: entry.floor });
            else {
                summaryItems.push({ key: `gap:${entry.id}`, gap: entry });
                if (expandedSummary.has(entry.id)) for (const floor of entry.floors) summaryItems.push({ key: `floor:${floor.mesId}`, floor });
            }
        }
        summaryTrack.style.width = `${summaryItems.length * SUMMARY_STEP}px`;
        scheduleFrame();
    }
    function renderSummaryWindow() {
        if (!valid(graphToken)) return;
        const start = Math.max(0, Math.floor(summary.scrollLeft / SUMMARY_STEP) - 2);
        const end = Math.min(summaryItems.length, Math.ceil((summary.scrollLeft + summary.clientWidth) / SUMMARY_STEP) + 2);
        const keep = new Set();
        for (let i = start; i < end; i++) {
            const item = summaryItems[i]; keep.add(item.key);
            let chip = summaryElements.get(item.key);
            if (!chip) {
                chip = button(item.floor ? 'st-swipe-timeline-path-step' : 'st-swipe-timeline-summary-gap', '');
                const token = graphToken;
                chip.addEventListener('click', () => {
                    if (!valid(token) || summaryElements.get(item.key) !== chip || !chip.isConnected) return;
                    const current = chip._item;
                    if (current.floor) locateSummaryFloor(current.floor, token);
                    else {
                        const id = current.gap.id;
                        if (expandedSummary.has(id)) expandedSummary.delete(id); else expandedSummary.add(id);
                        buildSummary();
                    }
                });
                summaryElements.set(item.key, chip); summaryTrack.append(chip);
            }
            chip._item = item;
            chip.style.left = `${i * SUMMARY_STEP}px`;
            if (item.floor) {
                const f = item.floor;
                chip.textContent = `#${f.mesId}${f.count > 1 ? `分支${f.count}` : ''}`;
                chip.title = `定位 #${f.mesId} 当前分支${f.currentSwipe + 1}，共 ${f.count} 个候选`;
                chip.dataset.mesId = String(f.mesId); chip.dataset.swipeIdx = String(f.currentSwipe);
                chip.classList.toggle('st-swipe-timeline-path-multiple', f.count > 1);
            } else {
                const e = item.gap, expanded = expandedSummary.has(e.id);
                chip.textContent = expanded ? '收起' : '...'; chip.dataset.gapId = e.id;
                chip.title = `${expanded ? '收起' : '展开'} ${e.floors.length} 楼（#${e.floors[0].mesId} 至 #${e.floors.at(-1).mesId}）`;
                chip.setAttribute('aria-expanded', String(expanded)); chip.setAttribute('aria-label', chip.title);
            }
        }
        for (const [key, chip] of summaryElements) if (!keep.has(key)) {
            if (chip === document.activeElement) summary.focus({ preventScroll: true });
            chip.remove(); summaryElements.delete(key);
        }
    }
    function updateMatchCount() {
        matchCount.textContent = `${matchIndex < 0 ? 0 : matchIndex + 1} / ${matches.length}`;
        previousMatch.disabled = nextMatch.disabled = !matches.length;
    }
    function moveMatch(delta, keyboard = true) {
        if (!matches.length || !valid(graphToken)) return;
        matchIndex = matchIndex < 0 ? (delta < 0 ? matches.length - 1 : 0)
            : (matchIndex + delta + matches.length) % matches.length;
        focusGraphNode(matches[matchIndex], keyboard); updateMatchCount();
    }
    async function applySearch(navigate = true, changedFloors = null) {
        const token = graphToken;
        if (!graph || !valid(token)) return;
        const run = ++searchRevision, query = search.value.trim();
        const incremental = changedFloors && !searchPending && completedQuery === query;
        searchPending = true;
        const result = await searchIndex.search(query, { current: () => run === searchRevision && valid(token),
            visible: id => layout.positions.has(id),
            floors: incremental ? changedFloors.map(id => graph.byId.get(id)).filter(Boolean) : graph.floors });
        if (!result || run !== searchRevision || !valid(token)) return;
        if (incremental) {
            const dirty = new Set(changedFloors);
            for (const id of matchIds) if (!dirty.has(Number(id.split(':')[0]))) result.all.add(id);
            result.all = new Set([...result.all].sort((a, b) => {
                const [am, as] = a.split(':').map(Number), [bm, bs] = b.split(':').map(Number); return am - bm || as - bs;
            }));
            result.matches = [...result.all].filter(id => layout.positions.has(id));
            result.hidden = result.all.size - result.matches.length;
        }
        searchPending = false; completedQuery = query;
        matches = result.matches; matchIds = result.all; matchIndex = -1;
        status.textContent = !graph.floors.length ? '当前聊天没有消息。'
            : query ? `匹配 ${matches.length} 个可见节点${result.hidden ? `；另有 ${result.hidden} 个匹配被展示选项隐藏` : ''}；搜索不会隐藏楼层。`
                : `显示 ${visibleGraph.stats.floors} / ${graph.stats.floors} 个楼层${includeCandidates ? ` + ${visibleGraph.stats.candidates} 个旁支` : '（旁支已隐藏）'}。`;
        if (matches.length && navigate) moveMatch(1, false); else updateMatchCount();
        scheduleFrame();
    }
    function updateStats() {
        const c = graph.stats;
        stats.textContent = `总楼层：${c.floors}个 · 多分支楼层：${c.multiSwipeFloors}个 · 旁支：${c.candidates}`;
    }
    async function refresh(preserveScroll = false) {
        clearTimeout(refreshTimer); clearTimeout(messageTimer); messageTimer = 0; clearTimeout(searchTimer);
        if (closed) return;
        const context = getContext(), nextKey = identity(context);
        if (nextKey !== chatKey || context.chat !== chatArray) {
            search.value = ''; anchorMesId = undefined; anchorSwipeIdx = undefined;
            sourceAvailable = false; goSource.disabled = true; preserveScroll = false;
        }
        chatKey = nextKey; chatArray = context.chat;
        const token = ++revision;
        searchIndex?.cancel(); searchRevision++; renderRevision++; graphToken = -1;
        dirtyFloors.clear(); expandedSummary.clear(); summaryRevision++;
        rows.clear(); nodeElements.clear(); edgeElements.clear(); gapElements.clear(); summaryElements.clear();
        nodes.replaceChildren(); edges.replaceChildren(); summaryTrack.replaceChildren();
        detail.hidden = true; selectedId = null; matches = []; matchIds.clear(); matchIndex = -1; updateMatchCount();
        status.textContent = '正在分片建立楼层索引…';
        const index = new TimelineIndex(chatArray), builder = index.build();
        let deadline = performance.now() + 8;
        for (const id of builder) {
            if (!valid(token)) return;
            if (index.byId.has(id)) rows.set(id, { id, message: chatArray[id], version: 0 });
            if (performance.now() >= deadline) { await pause(); deadline = performance.now() + 8; }
        }
        if (!valid(token)) return;
        graph = index; graphToken = token; completedQuery = null; searchPending = false;
        displayCache = new TimelineDisplayCache(index); searchIndex = new TimelineSearch(index, { pause });
        updateStats(); buildSummary(); await renderGraph(token, !preserveScroll);
    }
    function scheduleRefresh(chatChanged = false) {
        if (closed) return;
        revision++; searchRevision++; renderRevision++; searchIndex?.cancel(); dirtyFloors.clear();
        clearTimeout(messageTimer); messageTimer = 0;
        matches = []; matchIds.clear(); matchIndex = -1; updateMatchCount(); detail.hidden = true;
        status.textContent = chatChanged ? '聊天已切换，正在刷新…' : '楼层结构已变化，正在刷新…';
        if (chatChanged) {
            hideHelp();
            search.value = ''; nodeElements.clear(); edgeElements.clear(); gapElements.clear(); summaryElements.clear();
            nodes.replaceChildren(); edges.replaceChildren(); summaryTrack.replaceChildren(); stats.textContent = '';
        }
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => void refresh(!chatChanged).catch(error => report(error, '刷新时间线失败')), chatChanged ? 0 : 80);
    }
    function scheduleMessage(name, payload) {
        if (closed) return;
        if (!sameChat() || !graph || !valid(graphToken) || chatArray.length !== graph.length || name === 'MESSAGE_DELETED'
            || name === 'CHARACTER_FIRST_MESSAGE_SELECTED') { scheduleRefresh(!sameChat()); return; }
        const value = payload && typeof payload === 'object' ? payload.mesId ?? payload.messageId ?? payload.message_id ?? payload.id : payload;
        const id = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : NaN;
        if (!Number.isInteger(id) || !graph.byId.has(id)) {
            // Generation lifecycle signals carry no ID. Native generation edits the last floor.
            if (name === 'GENERATION_ENDED' || name === 'GENERATION_STOPPED') {
                if (chatArray.length) scheduleMessage('MESSAGE_UPDATED', chatArray.length - 1);
            } else scheduleRefresh();
            return;
        }
        dirtyFloors.add(id); searchRevision++; searchIndex.cancel();
        if (Number(selectedId?.split(':')[0]) === id) detail.hidden = true;
        // Throttle instead of debouncing: sustained generation updates cannot starve the window.
        if (messageTimer) return;
        messageTimer = setTimeout(() => {
            messageTimer = 0;
            if (!valid(graphToken)) return;
            let reflow = false;
            for (const mesId of dirtyFloors) {
                const result = graph.update(mesId);
                if (result.structural) { scheduleRefresh(); return; }
                reflow ||= result.layoutChanged;
                rows.set(mesId, { id: mesId, message: chatArray[mesId], version: result.floor.version });
                displayCache.invalidate(mesId); searchIndex.invalidate(mesId);
            }
            const changed = [...dirtyFloors];
            dirtyFloors.clear(); updateStats();
            if (reflow) {
                const centerX = (viewport.scrollLeft + viewport.clientWidth / 2 - stageOffsetX) / scale - layout.centerX;
                buildSummary();
                const update = renderGraph(graphToken, false, changed);
                viewport.scrollLeft = Math.max(0, (layout.centerX + centerX) * scale + stageOffsetX - viewport.clientWidth / 2);
                scheduleFrame();
                void update.catch(error => report(error, '更新楼层布局失败'));
            } else { scheduleFrame(); void applySearch(false, changed).catch(error => report(error, '更新搜索失败')); }
        }, 40);
    }
    function stopDrag() {
        if (drag && viewport.hasPointerCapture?.(drag.id)) viewport.releasePointerCapture(drag.id);
        drag = null;
        viewport.classList.remove('st-swipe-timeline-panning');
    }

    viewport.addEventListener('scroll', () => scheduleFrame(), { passive: true });
    summary.addEventListener('scroll', () => scheduleFrame(), { passive: true });
    summaryScroll.addEventListener('input', () => {
        summary.scrollLeft = Number(summaryScroll.value);
        scheduleFrame();
    });
    refreshButton.addEventListener('click', () => void refresh().catch(error => report(error, '刷新时间线失败')));
    closeButton.addEventListener('click', () => close());
    overlay.addEventListener('click', event => { if (event.target === overlay && isTopSwipeOverlay(overlay)) close(); });
    search.addEventListener('input', () => {
        searchRevision++;
        searchIndex?.cancel(); matchIds.clear(); scheduleFrame();
        matches = [];
        matchIndex = -1;
        updateMatchCount();
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => void applySearch().catch(error => report(error, '搜索失败')), 180);
    });
    search.addEventListener('keydown', event => {
        if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); moveMatch(event.shiftKey ? -1 : 1); }
    });
    previousMatch.addEventListener('click', () => moveMatch(-1));
    nextMatch.addEventListener('click', () => moveMatch(1));
    toggleCandidates.addEventListener('click', () => {
        if (!valid(graphToken)) return;
        includeCandidates = !includeCandidates;
        toggleCandidates.textContent = includeCandidates ? '全部' : '主干';
        toggleCandidates.title = includeCandidates ? '当前显示全部；点击仅显示主干' : '当前仅显示主干；点击显示全部';
        toggleCandidates.setAttribute('aria-pressed', String(includeCandidates));
        persistPreferences();
        void renderGraph(graphToken).catch(error => report(error, '切换图模式失败'));
    });
    toolsToggle.addEventListener('click', () => {
        controls.hidden = !controls.hidden;
        toolsToggle.setAttribute('aria-expanded', String(!controls.hidden));
        persistPreferences();
        scheduleFrame(true);
    });
    searchToggle.addEventListener('click', () => {
        toolbar.hidden = !toolbar.hidden;
        searchToggle.setAttribute('aria-expanded', String(!toolbar.hidden));
        if (!toolbar.hidden) search.focus({ preventScroll: true });
        else {
            search.value = '';
            clearTimeout(searchTimer);
            void applySearch(false).catch(error => report(error, '搜索失败'));
            searchToggle.focus({ preventScroll: true });
        }
    });
    const changeFilter = () => {
        if (!valid(graphToken)) return;
        void renderGraph(graphToken).catch(error => report(error, '切换展示选项失败'));
    };
    onlyCharButton.addEventListener('click', () => {
        if (!valid(graphToken)) return;
        onlyChar = !onlyChar;
        onlyCharButton.setAttribute('aria-pressed', String(onlyChar));
        persistPreferences();
        changeFilter();
    });
    onlyBranchesButton.addEventListener('click', () => {
        if (!valid(graphToken)) return;
        onlyBranches = !onlyBranches;
        onlyBranchesButton.setAttribute('aria-pressed', String(onlyBranches));
        persistPreferences();
        changeFilter();
    });
    zoomIn.addEventListener('click', () => setZoom((pendingZoom ?? scale) + 0.15));
    zoomOut.addEventListener('click', () => setZoom((pendingZoom ?? scale) - 0.15));
    zoomReset.addEventListener('click', () => setZoom(1));
    goHead.addEventListener('click', () => { if (visibleGraph?.floors.length) focusGraphNode(visibleGraph.floors[0].currentId, true); });
    goTail.addEventListener('click', () => { if (visibleGraph?.floors.length) focusGraphNode(visibleGraph.floors.at(-1).currentId, true); });
    goSource.disabled = !Number.isInteger(focusMesId) || focusMesId < 0;
    goSource.addEventListener('click', () => {
        if (!sourceAvailable || !valid(graphToken)) return;
        anchorMesId = focusMesId;
        anchorSwipeIdx = focusSwipeIdx;
        changeFilter();
    });
    viewport.addEventListener('wheel', event => {
        if (!event.ctrlKey && !event.metaKey) return; // Ordinary wheel/touch scroll remains native.
        event.preventDefault();
        setZoom((pendingZoom ?? scale) + (event.deltaY < 0 ? 0.1 : -0.1));
    }, { passive: false });
    viewport.addEventListener('pointerdown', event => {
        if (event.pointerType !== 'mouse' || event.button !== 0 || event.target.closest('button')) return;
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop };
        viewport.setPointerCapture?.(event.pointerId);
        viewport.classList.add('st-swipe-timeline-panning');
        event.preventDefault();
    });
    viewport.addEventListener('pointermove', event => {
        if (!drag || drag.id !== event.pointerId) return;
        viewport.scrollLeft = drag.left - (event.clientX - drag.x);
        viewport.scrollTop = drag.top - (event.clientY - drag.y);
    });
    viewport.addEventListener('pointerup', stopDrag);
    viewport.addEventListener('pointercancel', stopDrag);
    viewport.addEventListener('lostpointercapture', stopDrag);
    const source = initialContext.eventSource;
    const types = initialContext.eventTypes || initialContext.event_types;
    if (source?.on && source?.removeListener && types) {
        const subscribe = (name, handler) => {
            if (!types[name]) return;
            source.on(types[name], handler);
            subscriptions.push([source, types[name], handler]);
        };
        subscribe('CHAT_CHANGED', () => scheduleRefresh(true));
        for (const name of ['MESSAGE_SWIPED', 'MESSAGE_UPDATED', 'MESSAGE_EDITED', 'MESSAGE_DELETED',
            'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'MESSAGE_SWIPE_DELETED', 'GENERATION_ENDED',
            'GENERATION_STOPPED', 'CHARACTER_FIRST_MESSAGE_SELECTED']) subscribe(name, payload => scheduleMessage(name, payload));
    }
    observer = new MutationObserver(() => { if (!overlay.isConnected) close('removed'); });
    observer.observe(document.body, { childList: true });
    if (typeof ResizeObserver === 'function') {
        resizeObserver = new ResizeObserver(() => scheduleFrame(true));
        resizeObserver.observe(viewport);
        resizeObserver.observe(summary);
        resizeObserver.observe(tools);
        resizeObserver.observe(canvas);
    }
    const releaseFocus = manageOverlayFocus(overlay, {
        initialFocus: closeButton, returnFocus: previousFocus,
        onEscape: () => { if (!helpPanel.hidden) hideHelp(); else close(); },
        canRestore: () => {
            try { const context = getContext(); return context.chat === originChat && identity(context) === originKey; }
            catch { return false; }
        },
    });
    activeTree = { close };
    void refresh().catch(error => report(error, '读取时间线失败'));
    return activeTree;
}
