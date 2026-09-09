// Browser-only scrolling helpers. No product internals or model results are used:
// assertions observe every real mounted window instead of assuming full DOM retention.
export const settleTimeline = async () => {
    await new Promise(resolve => requestAnimationFrame(resolve));
    await new Promise(resolve => requestAnimationFrame(resolve));
};
const $ = selector => document.querySelector(selector);
const positions = (max, step) => {
    const values = [];
    for (let value = 0; value < max; value += Math.max(1, step)) values.push(value);
    values.push(max);
    return values;
};
const isSummary = selector => /path-step|path-multiple|summary-gap/.test(selector);
const key = node => node.dataset.nodeId ? `node:${node.dataset.nodeId}`
    : node.dataset.gapId ? `summary-gap:${node.dataset.gapId}`
        : node.matches('.st-swipe-timeline-path-step') ? `summary:${node.dataset.mesId}`
            : node.matches('.st-swipe-timeline-edge') ? `edge:${node.dataset.relation}:${node.dataset.from}:${node.dataset.to}`
                : `gap:${node.title}`;

/** Collect immutable DOM snapshots over all scroll windows, then restore the view. */
export async function collectTimeline(selector) {
    const summary = isSummary(selector);
    const viewport = $(summary ? '.st-swipe-timeline-path-summary' : '.st-swipe-timeline-viewport');
    if (!viewport) throw new Error(`Missing scroll viewport for ${selector}`);
    const original = [viewport.scrollLeft, viewport.scrollTop];
    const found = new Map();
    const xs = positions(viewport.scrollWidth - viewport.clientWidth, viewport.clientWidth * .8);
    const ys = summary ? [0] : positions(viewport.scrollHeight - viewport.clientHeight, viewport.clientHeight * .8);
    try {
        for (const y of ys) for (const x of xs) {
            viewport.scrollTo({ left: x, top: y, behavior: 'auto' });
            await settleTimeline();
            for (const node of document.querySelectorAll(selector)) {
                const copy = node.cloneNode(true);
                // Preserve measured geometry in stage coordinates, independent of scroll.
                const box = node.getBoundingClientRect();
                const origin = node.closest('.st-swipe-timeline-stage,.st-swipe-timeline-summary-track')?.getBoundingClientRect() ?? { top: 0, left: 0 };
                copy._box = { top: box.top - origin.top, left: box.left - origin.left,
                    height: box.height, width: box.width };
                if (node.matches('.st-swipe-timeline-edge')) {
                    const previous = found.get(key(node));
                    const segments = [...(previous?.getAttribute('d') ?? '').matchAll(/M[^M]+/g), ...(copy.getAttribute('d') ?? '').matchAll(/M[^M]+/g)]
                        .map(match => match[0].trim());
                    copy.setAttribute('d', [...new Set(segments)].sort().join(' '));
                }
                found.set(key(node), copy);
            }
        }
    } finally {
        viewport.scrollTo({ left: original[0], top: original[1], behavior: 'auto' });
        await settleTimeline();
    }
    return [...found.values()].sort((a, b) => a._box.top - b._box.top || a._box.left - b._box.left
        || Number(a.dataset.mesId ?? 0) - Number(b.dataset.mesId ?? 0));
}

/** Bring a real node/chip into the mounted window by actual host scrolling. */
export async function revealTimeline(selector) {
    const summary = isSummary(selector);
    const viewport = $(summary ? '.st-swipe-timeline-path-summary' : '.st-swipe-timeline-viewport');
    if (!viewport) throw new Error(`Missing viewport for ${selector}`);
    const revealMounted = async () => {
        const node = $(selector);
        if (!node) return null;
        node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
        await settleTimeline();
        return $(selector);
    };
    const mounted = await revealMounted();
    if (mounted) return mounted;
    // Start at head; historical head targeting is O(1), independent of total floors.
    const xs = positions(viewport.scrollWidth - viewport.clientWidth, viewport.clientWidth * .8);
    const ys = summary ? [0] : positions(viewport.scrollHeight - viewport.clientHeight, viewport.clientHeight * .8);
    for (const y of ys) for (const x of xs) {
        viewport.scrollTo({ left: x, top: y, behavior: 'auto' });
        await settleTimeline();
        const node = await revealMounted();
        if (node) return node;
    }
    throw new Error(`Scroll target never rendered: ${selector}`);
}
