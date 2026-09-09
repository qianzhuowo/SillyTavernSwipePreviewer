// Real product DOM tests; only the SillyTavern host is mocked.
import { collectTimeline, revealTimeline, settleTimeline } from './timeline-test-helpers.mjs';
export async function runTimelineUiCases() {
    const results = [];
    const $ = selector => document.querySelector(selector);
    const all = selector => [...document.querySelectorAll(selector)];
    const assert = (ok, text) => { if (!ok) throw new Error(text); };
    const equal = (actual, expected, text) => assert(JSON.stringify(actual) === JSON.stringify(expected), `${text}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const wait = async (fn, label) => {
        for (let i = 0; i < 150; i++) { if (await fn()) return; await pause(20); }
        throw new Error(`Timed out: ${label}`);
    };
    const click = async selector => {
        if (selector === '#st-swipe-tree-entry') mock.openOptions();
        const node = /node\[|path-step\[|summary-gap\[/.test(selector)
            ? await revealTimeline(selector) : $(selector);
        assert(node && !node.closest('[hidden]') && node.getClientRects().length, `visible control required: ${selector}`);
        node.click();
        await settleTimeline();
    };
    const single = (i, user = false) => ({ name: user ? 'User' : 'AI', mes: `Floor ${i}`, is_user: user, extra: {} });
    const junction = (i, user = false) => ({ ...single(i, user), swipes: [`Floor ${i}`, `Alternative ${i}`], swipe_id: 0 });
    const mixed = () => [single(0), junction(1), single(2, true), single(3), junction(4, true), junction(5), single(6), single(7), single(8)];
    const floors = async () => (await collectTimeline('.st-swipe-timeline-node-current')).map(n => Number(n.dataset.mesId));
    const chips = async () => (await collectTimeline('.st-swipe-timeline-path-step')).map(n => Number(n.dataset.mesId));
    const gap = id => `.st-swipe-timeline-summary-gap[data-gap-id="${id}"]`;
    const canvasState = async () => JSON.stringify((await collectTimeline('.st-swipe-timeline-node,.st-swipe-timeline-edge,.st-swipe-timeline-gap')).map(n => [n.className.baseVal ?? n.className, n.dataset.nodeId, n.dataset.from, n.dataset.to, n.getAttribute('style'), n.getAttribute('d'), n.textContent]));
    async function open(chat = mixed()) {
        mock.context.chat = chat;
        await click('#st-swipe-tree-entry');
        const candidates = chat.reduce((sum, m) => sum + (m.swipes?.length || 1) - 1, 0);
        await wait(async () => $('.st-swipe-tree-status')?.textContent === `显示 ${chat.length} / ${chat.length} 个楼层 + ${candidates} 个旁支。`
            && $('.st-swipe-timeline-node-selected') && $('.st-swipe-timeline-summary-gap'), 'tree ready');
    }
    async function test(name, run) {
        await mock.reset();
        try {
            await run();
            equal(mock.errors, [], 'uncaught errors');
            equal(mock.stats.saves, 0, 'UI never saves chat');
            results.push({ name, status: 'passed' });
        } catch (error) { results.push({ name, status: 'failed', error: error.message }); }
    }
    await test('tree tools default collapsed, three real rows and independent header search', async () => {
        await open();
        const toggle = $('.st-swipe-timeline-tools-toggle'), controls = $('.st-swipe-timeline-controls');
        assert(controls.hidden && getComputedStyle(controls).display === 'none', 'controls hidden in actual layout');
        equal(toggle.getAttribute('aria-expanded'), 'false', 'collapsed tools ARIA');
        equal(toggle.getAttribute('aria-controls'), controls.id, 'tools controls link');
        const zoomLabel = $('.st-swipe-timeline-zoom-label');
        const assertZoomHeading = () => {
            assert(zoomLabel.parentElement === toggle.parentElement && !zoomLabel.closest('[hidden]'), 'zoom remains in visible tools heading');
            const labelBox = zoomLabel.getBoundingClientRect(), toggleBox = toggle.getBoundingClientRect();
            assert(labelBox.left >= toggleBox.right && Math.abs(labelBox.top + labelBox.height / 2 - toggleBox.top - toggleBox.height / 2) < 2, 'zoom is right of toggle on same row');
        };
        assertZoomHeading();
        const header = $('.st-swipe-timeline-header'), title = header.querySelector('.st-swipe-title');
        equal(title.textContent, '分支时间线', 'compact title');
        const top = title.closest('.st-swipe-modal-header-top');
        assert(top.contains($('.st-swipe-timeline-role-legend')) && top.contains($('.st-swipe-tree-refresh')) && top.contains($('.st-swipe-tree-close')), 'title role legend refresh close share top row');
        const status = $('.st-swipe-timeline-status-row'), searchToggle = $('.st-swipe-timeline-search-toggle');
        assert(status.children.length === 2 && status.children[0] === $('.st-swipe-tree-status') && status.children[1] === searchToggle, 'search follows status text');
        assert(header.contains(status) && header.contains($('.st-swipe-timeline-toolbar')), 'search and toolbar in header');
        const statusBox = $('.st-swipe-tree-status').getBoundingClientRect(), searchBox = searchToggle.getBoundingClientRect();
        assert(searchBox.left >= statusBox.right - 1 && Math.abs(searchBox.top + searchBox.height / 2 - statusBox.top - statusBox.height / 2) < 2, 'search physically right of status, on same row');
        const stats = $('.st-swipe-timeline-stats').textContent;
        assert(stats.includes('总楼层：9个') && stats.includes('多分支楼层：3个') && stats.includes('旁支：3'), 'compact stats retain essential totals');
        assert(!$('.st-swipe-timeline-tools').contains(searchToggle), 'search not part of tools');
        await click('.st-swipe-timeline-search-toggle');
        assert(!$('.st-swipe-timeline-toolbar').hidden && controls.hidden, 'search opens without tools');
        assert(document.activeElement === $('.st-swipe-tree-search'), 'search input focused');
        await click('.st-swipe-timeline-tools-toggle');
        assert(!controls.hidden && controls.getClientRects().length, 'menu really expanded');
        equal(toggle.getAttribute('aria-expanded'), 'true', 'expanded tools ARIA');
        const rows = all('.st-swipe-timeline-control-row');
        equal(rows.length, 3, 'three control rows');
        const expected = [
            ['zoom-in', 'zoom-out', 'zoom-reset'],
            ['go-head', 'go-tail', 'go-source'],
            ['toggle-candidates', 'only-char', 'only-branches'],
        ];
        rows.forEach((row, index) => equal([...row.children].map(n => expected[index].find(s => n.classList.contains(`st-swipe-timeline-${s}`))), expected[index], `row ${index}`));
        assertZoomHeading();
        equal($('.st-swipe-timeline-only-branches').textContent, '隐藏无分支楼层', 'explicit floor filter label');
        const modes = $('.st-swipe-timeline-toggle-candidates');
        equal(modes.textContent, '全部', 'all mode label');
        await click('.st-swipe-timeline-toggle-candidates');
        await wait(async () => !(await collectTimeline('.st-swipe-timeline-node-candidate')).length, 'trunk mode applied');
        equal(modes.textContent, '主干', 'trunk mode label');
        equal(modes.getAttribute('aria-pressed'), 'false', 'trunk mode state');
        await click('.st-swipe-timeline-toggle-candidates');
        await wait(async () => (await collectTimeline('.st-swipe-timeline-node-candidate')).length === 3, 'all mode restored');
        equal(modes.textContent, '全部', 'all label restored');
        assert($('.st-swipe-timeline-zoom-reset i.fa-rotate-left') && $('.st-swipe-timeline-go-source i.fa-bullseye'), 'reset and current floor icons');
        equal($('.st-swipe-timeline-zoom-reset').textContent.trim(), '', 'reset is icon only');
        equal($('.st-swipe-timeline-go-source').getAttribute('aria-label'), '当前楼层', 'current floor accessible name');
        await click('.st-swipe-timeline-zoom-in'); equal($('.st-swipe-timeline-zoom-label').textContent, '115%', 'zoom in');
        await click('.st-swipe-timeline-zoom-out'); equal($('.st-swipe-timeline-zoom-label').textContent, '100%', 'zoom out');
        await click('.st-swipe-timeline-zoom-in'); await click('.st-swipe-timeline-zoom-reset');
        equal($('.st-swipe-timeline-zoom-label').textContent, '100%', 'icon reset works');
        await click('.st-swipe-timeline-tools-toggle');
        assert(controls.hidden && !$('.st-swipe-timeline-toolbar').hidden, 'collapsing tools leaves search open');
        assertZoomHeading();
        $('.st-swipe-timeline-viewport').dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }));
        await settleTimeline();
        equal(zoomLabel.textContent, '110%', 'collapsed tools still show live wheel zoom');
        await click('.st-swipe-timeline-search-toggle');
        assert($('.st-swipe-timeline-toolbar').hidden, 'search independently collapses');
    });
    await test('tree overview chips use compact width with matching virtual spacing', async () => {
        await open();
        const mounted = all('.st-swipe-timeline-summary-track > button').sort((a, b) => parseFloat(a.style.left) - parseFloat(b.style.left));
        assert(mounted.length > 1, 'multiple visible overview entries');
        for (const chip of mounted) assert(Math.abs(chip.getBoundingClientRect().width - 96) < 1, 'overview button width is 96px');
        for (let i = 1; i < mounted.length; i++) equal(parseFloat(mounted[i].style.left) - parseFloat(mounted[i - 1].style.left), 112, 'virtual overview step is 112px');
        const junction = $('.st-swipe-timeline-path-multiple');
        assert(junction.title.includes('候选'), 'full overview text remains available in title');
    });
    await test('tree summary locally expands separate runs without changing canvas and survives independent filters', async () => {
        await open();
        const dataBefore = JSON.stringify(mock.context.chat), initialCanvas = (await canvasState());
        equal((await chips()), [1, 4, 5], 'summary defaults only junctions, while canvas has all floors');
        equal((await floors()), [0, 1, 2, 3, 4, 5, 6, 7, 8], 'canvas default unaffected');
        equal((await collectTimeline('.st-swipe-timeline-summary-gap')).map(n => [n.dataset.gapId, n.textContent, n.getAttribute('aria-expanded')]),
            [['0:0', '...', 'false'], ['2:3', '...', 'false'], ['6:8', '...', 'false']], 'separate collapsed run buttons');
        await click(gap('2:3')); await wait(async () => (await chips()).length === 5, 'middle expanded');
        equal((await chips()), [1, 2, 3, 4, 5], 'only middle ordinary floors expanded');
        equal($(gap('2:3')).textContent, '收起', 'collapse button visible');
        equal($(gap('2:3')).getAttribute('aria-expanded'), 'true', 'expanded summary ARIA');
        await click(gap('6:8')); await wait(async () => (await chips()).length === 8, 'tail expanded');
        await click(gap('2:3')); await wait(async () => (await chips()).length === 6, 'middle collapsed');
        equal((await chips()), [1, 4, 5, 6, 7, 8], 'collapsing one group leaves other expanded');
        equal((await canvasState()), initialCanvas, 'summary edits preserve canvas DOM geometry and edges');
        await click('.st-swipe-timeline-tools-toggle');
        await click('.st-swipe-timeline-only-char'); await wait(async () => (await floors()).join() === '0,1,3,5,6,7,8', 'char filter');
        await click('.st-swipe-timeline-only-branches'); await wait(async () => (await floors()).join() === '1,5', 'junction filter');
        equal((await chips()), [1, 4, 5, 6, 7, 8], 'canvas filters keep full summary and expanded tail');
        await click('.st-swipe-timeline-path-step[data-mes-id="4"]');
        equal($('.st-swipe-timeline-node-selected').dataset.nodeId, '5:0', 'hidden user junction falls back to nearest visible floor');
        assert(all('.st-swipe-timeline-status').some(n => n.textContent.includes('#4') && n.textContent.includes('#5')), 'fallback explained');
        await click(gap('2:3')); await wait(async () => (await chips()).includes(3), 'hidden ordinary group expanded');
        await click('.st-swipe-timeline-path-step[data-mes-id="3"]');
        equal($('.st-swipe-timeline-node-selected').dataset.nodeId, '1:0', 'equidistant hidden ordinary floor chooses earlier visible floor');
        equal((await floors()), [1, 5], 'summary navigation never relaxes canvas filter');
        const compactCanvas = (await canvasState());
        await click(gap('2:3')); await click(gap('6:8'));
        await wait(async () => (await chips()).join() === '1,4,5', 'all restored collapsed');
        equal((await canvasState()), compactCanvas, 'collapsing filtered summary leaves selected canvas untouched');
        equal(JSON.stringify(mock.context.chat), dataBefore, 'chat unchanged');
    });
    await test('tree compact canvas gaps are 28px and adjacent spacing is 14px', async () => {
        await open(); await click('.st-swipe-timeline-tools-toggle'); await click('.st-swipe-timeline-only-branches');
        await wait(async () => (await floors()).join() === '1,4,5', 'filtered compact canvas');
        const rows = (await collectTimeline('.st-swipe-timeline-node-current,.st-swipe-timeline-gap')).map(n => ({ gap: n.classList.contains('st-swipe-timeline-gap'), box: { ...n._box, bottom: n._box.top + n._box.height } })).sort((a, b) => a.box.top - b.box.top);
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            assert(Math.abs(row.box.height - (row.gap ? 28 : 116)) < 1, `row height ${row.box.height}`);
            if (i) {
                const prior = rows[i - 1], spacing = row.box.top - prior.box.bottom;
                assert(Math.abs(spacing - (row.gap || prior.gap ? 14 : 72)) < 1, `row spacing ${spacing}`);
            }
        }
    });
    await test('tree summary range syncs input, native scrolling and ResizeObserver without replacing touch scroll', async () => {
        await open(Array.from({ length: 90 }, (_, i) => single(i)));
        const summary = $('.st-swipe-timeline-path-summary'), slider = $('.st-swipe-timeline-summary-scroll');
        assert(slider.closest('.st-swipe-timeline-summary-shell') === summary.parentElement, 'slider inside summary shell');
        equal(slider.type, 'range', 'native range control');
        equal(slider.getAttribute('aria-controls'), summary.id, 'range controls summary');
        assert(slider.hidden, 'single collapsed run does not overflow');
        await click(gap('0:89')); await wait(async () => (await chips()).length === 90 && !slider.hidden, 'expanded summary overflows');
        const max = () => summary.scrollWidth - summary.clientWidth;
        // Showing the slider can cause the header's vertical scrollbar to appear.
        // Its 15px width change is synchronized by ResizeObserver on the next layout.
        await wait(async () => Number(slider.max) === max(), 'range catches header width change after expansion');
        equal(Number(slider.max), max(), 'range max is exact overflow');
        equal(getComputedStyle(summary).scrollbarWidth, 'none', 'native scrollbar hidden without disabling scroll');
        equal(getComputedStyle(summary, '::-webkit-scrollbar').display, 'none', 'Chromium native scrollbar hidden');
        assert(slider.getBoundingClientRect().height > 0, 'custom scrollbar remains visible');
        const sliderStyle = getComputedStyle(slider);
        assert(/(?:38|55)%/.test(sliderStyle.getPropertyValue('--st-swipe-summary-thumb')), 'thumb uses low-contrast body color blend, including hover state');
        assert(!sliderStyle.getPropertyValue('--st-swipe-summary-thumb').includes('st-swipe-accent'), 'thumb does not use bright accent');
        slider.value = String(Math.floor(max() * .6)); slider.dispatchEvent(new Event('input', { bubbles: true }));
        assert(Math.abs(summary.scrollLeft - Number(slider.value)) <= 1, 'range input maps to native scrollLeft');
        summary.scrollLeft = Math.floor(max() * .2);
        await wait(async () => Math.abs(Number(slider.value) - summary.scrollLeft) <= 1, 'native scroll event reverse sync');
        const originalWidth = summary.clientWidth, oldMax = Number(slider.max);
        summary.style.width = `${Math.floor(originalWidth / 2)}px`;
        await wait(async () => Number(slider.max) === max() && Number(slider.max) > oldMax, 'ResizeObserver updates after width-only change');
        summary.style.removeProperty('width');
        await wait(async () => summary.clientWidth === originalWidth && Number(slider.max) === max(), 'ResizeObserver restores range max');
        assert(['auto', 'scroll'].includes(getComputedStyle(summary).overflowX), 'native horizontal touch scrolling preserved');
        assert(getComputedStyle(summary).touchAction !== 'none', 'touch scrolling not disabled');
        await click(gap('0:89')); await wait(async () => slider.hidden, 'collapse removes overflow and slider');
        equal(Number(slider.max), 0, 'collapsed range max reset');
        equal(Number(slider.value), 0, 'collapsed range value clamped');
    });
    await test('tree detail puts preview and locate right of title without redundant explanations', async () => {
        await open();
        const original = JSON.stringify(mock.context.chat);
        await click('.st-swipe-timeline-node[data-node-id="1:1"]');
        const detail = $('.st-swipe-timeline-detail');
        assert(!detail.hidden, 'detail open');
        const heading = detail.querySelector('.st-swipe-timeline-detail-heading');
        const title = heading.querySelector('strong');
        const actions = heading.querySelector('.st-swipe-timeline-detail-actions');
        const preview = actions?.querySelector('.st-swipe-timeline-preview');
        const locate = actions?.querySelector('.st-swipe-timeline-locate');
        assert(preview && locate, 'both actions belong to title row');
        equal(title.textContent, '#1 分支2 · 同层候选', 'candidate heading retained');
        equal(preview.textContent, '预览', 'preview label simplified');
        equal(locate.textContent, '定位楼层', 'locate label retained');
        assert(!detail.querySelector('.st-swipe-timeline-detail-relation,.st-swipe-timeline-detail-recorded'), 'redundant paragraphs removed');
        assert(!detail.textContent.includes('候选编号来自当前消息的 swipes'), 'recording explanation absent');
        const t = title.getBoundingClientRect(), a = actions.getBoundingClientRect(), d = detail.getBoundingClientRect();
        assert(a.left >= t.right - 1 && a.top < t.bottom && a.bottom > t.top, 'actions physically right of title on same row');
        assert(a.right <= d.right && detail.scrollWidth <= detail.clientWidth + 1, 'detail actions do not overflow narrow panel');
        assert(detail.querySelector('.st-swipe-timeline-detail-collapse'), 'edge collapse bar available');
        assert(!detail.querySelector('.st-swipe-timeline-detail-close'), 'old dismiss button removed');
        equal(detail.querySelector('.st-swipe-timeline-detail-meta').textContent, 'AI · 2 个候选', 'metadata is concise');
        await click('.st-swipe-timeline-preview');
        await wait(async () => !$('#st-swipe-tree-modal') && $('#st-swipe-preview-modal .st-swipe-card'), 'preview still opens target content');
        equal(JSON.stringify(mock.context.chat), original, 'preview does not switch or mutate swipe');
    });
    await test('tree detail edge bar follows desktop or mobile layout and stays fixed during body scrolling', async () => {
        const chat = mixed();
        chat[1].name = 'Kongliu';
        chat[1].swipes[1] = '较长的预览内容，用于检查详情滚动。\n'.repeat(120);
        await open(chat);
        await click('.st-swipe-timeline-node[data-node-id="1:1"]');
        const detail = $('.st-swipe-timeline-detail'), pane = $('.st-swipe-timeline-detail-pane'), bar = $('.st-swipe-timeline-detail-collapse');
        equal($('.st-swipe-timeline-detail-meta').textContent, 'Kongliu · 2 个候选', 'no role or including-current suffix');
        equal(bar.getAttribute('aria-controls'), pane.id, 'collapse controls detail pane');
        equal(bar.getAttribute('aria-label'), '收起节点详情', 'collapse accessible name');
        const b = bar.getBoundingClientRect(), p = pane.getBoundingClientRect();
        if (matchMedia('(max-width: 600px)').matches) {
            assert(Math.abs(b.height - 24) < 1 && b.width > 200 && b.bottom <= p.top + 1, 'mobile horizontal bar above detail body');
        } else {
            assert(Math.abs(b.width - 24) < 1 && b.height > 100 && b.right <= p.left + 1, 'desktop vertical bar left of detail body');
        }
        assert(pane.scrollHeight > pane.clientHeight, 'long content scrolls in pane');
        pane.scrollTop = pane.scrollHeight;
        await pause(30);
        const scrolled = bar.getBoundingClientRect();
        equal([scrolled.left, scrolled.top, scrolled.width, scrolled.height], [b.left, b.top, b.width, b.height], 'bar is independent of body scroll');
        assert(detail.scrollWidth <= detail.clientWidth + 1 && pane.scrollWidth <= pane.clientWidth + 1, 'no detail horizontal overflow');
        await click('.st-swipe-timeline-detail-collapse');
        assert(detail.hidden && $('#st-swipe-tree-modal'), 'bar hides only detail, not tree');
        equal(document.activeElement?.dataset.nodeId, '1:1', 'focus returns to selected node');
        await click('.st-swipe-timeline-node[data-node-id="1:1"]');
        assert(!detail.hidden && pane.scrollTop === 0, 'node reopens detail at top');
    });
    await test('tree archive references show only presence and safe deduplicated native names', async () => {
        const chat = mixed();
        const literalName = '<img src=x onerror="window.archiveInjected=true">';
        chat[1].extra = { branches: ['路线A', '路线A', literalName, '', '  ', null, 123], bookmark_link: '路线A' };
        chat[4].extra = { bookmark_link: '检查点-周末' };
        chat[5].extra = { branches: 'invalid', bookmark_link: {} };
        const original = JSON.stringify(chat);
        await open(chat);
        await click('.st-swipe-timeline-node[data-node-id="0:0"]');
        const references = () => $('.st-swipe-timeline-references');
        equal(references().textContent, '无独立存档引用', 'empty refs have only concise status');
        assert(!references().querySelector('ul'), 'empty refs have no placeholder list');
        await click('.st-swipe-timeline-node[data-node-id="1:1"]');
        equal($('.st-swipe-timeline-reference-status').textContent, '有独立存档引用', 'presence status');
        equal(all('.st-swipe-timeline-reference').map(n => n.textContent), ['路线A', literalName], 'native names preserved, invalid entries filtered, branch/checkpoint duplicates removed');
        assert(!references().querySelector('img,script,a') && !window.archiveInjected, 'names render as plain text, not HTML or links');
        assert(!references().textContent.includes('当前消息 extra') && !references().textContent.includes('不读取'), 'old explanations removed');
        await click('.st-swipe-timeline-node[data-node-id="4:0"]');
        equal(all('.st-swipe-timeline-reference').map(n => n.textContent), ['检查点-周末'], 'checkpoint-only reference included');
        await click('.st-swipe-timeline-node[data-node-id="5:0"]');
        equal(references().textContent, '无独立存档引用', 'invalid fields treated as no references');
        equal(JSON.stringify(mock.context.chat), original, 'reference inspection never writes chat');
    });
    await test('tree trunk stays centered through zoom, detail toggles and viewport resizing', async () => {
        await open();
        await click('.st-swipe-timeline-tools-toggle');
        await click('.st-swipe-timeline-toggle-candidates');
        const viewport = $('.st-swipe-timeline-viewport');
        const isCentered = () => {
            const node = $('.st-swipe-timeline-node-current');
            if (!node) return false;
            const box = node.getBoundingClientRect(), view = viewport.getBoundingClientRect();
            return Math.abs(box.left + box.width / 2 - view.left - viewport.clientLeft - viewport.clientWidth / 2) <= 1;
        };
        await wait(async () => (await floors()).length === 9 && isCentered(), 'trunk centered after hiding candidates');
        await click('.st-swipe-timeline-zoom-in');
        await wait(isCentered, 'zoom preserves trunk center including transition to scrollable width');
        await click('.st-swipe-timeline-zoom-out');
        await click('.st-swipe-timeline-zoom-out');
        await wait(isCentered, 'smaller-than-viewport trunk centered');
        await click('.st-swipe-timeline-node[data-node-id="1:0"]');
        await wait(isCentered, 'detail panel resize preserves trunk center');
        await click('.st-swipe-timeline-detail-collapse');
        await wait(isCentered, 'closing detail preserves trunk center');
        const container = $('.st-swipe-timeline-container');
        const originalWidth = container.style.width;
        container.style.width = `${Math.max(240, Math.floor(container.clientWidth * .7))}px`;
        await wait(isCentered, 'narrow container resize preserves trunk center');
        container.style.width = originalWidth;
        await wait(isCentered, 'wide container resize preserves trunk center');
        await click('.st-swipe-timeline-zoom-reset');
        await wait(isCentered, 'reset centered');
        await click('.st-swipe-timeline-go-head'); await wait(isCentered, 'head focus uses centered coordinates');
        await click('.st-swipe-timeline-go-tail'); await wait(isCentered, 'tail focus uses centered coordinates');
        await click('.st-swipe-timeline-toggle-candidates');
        await wait(async () => (await collectTimeline('.st-swipe-timeline-node-candidate')).length === 3, 'all mode restored');
        await click('.st-swipe-timeline-toggle-candidates');
        await wait(async () => (await floors()).length === 9 && isCentered(), 'repeated trunk toggle centered');
    });
    await mock.reset();
    return results;
}
