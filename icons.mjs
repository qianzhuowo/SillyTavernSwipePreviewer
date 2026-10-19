// Local decorative icons: no font, network request, or host icon library required.
const paths = {
    delete: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7',
    tree: 'M6 8v8M6 12h7a5 5 0 0 0 5-5M6 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM6 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM18 1a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
};
const attributes = {
    class: 'st-swipe-icon', viewBox: '0 0 24 24', width: '1em', height: '1em',
    fill: 'none', stroke: 'currentColor', 'stroke-width': '2',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    'aria-hidden': 'true', focusable: 'false',
};

export function iconMarkup(name) {
    if (!Object.hasOwn(paths, name)) throw new TypeError(`Unknown icon: ${name}`);
    return `<svg xmlns="http://www.w3.org/2000/svg" ${Object.entries(attributes).map(([key, value]) => `${key}="${value}"`).join(' ')}><path d="${paths[name]}"></path></svg>`;
}

export function createIcon(document, name) {
    if (!Object.hasOwn(paths, name)) throw new TypeError(`Unknown icon: ${name}`);
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries(attributes)) icon.setAttribute(key, value);
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', paths[name]);
    icon.append(path);
    return icon;
}
