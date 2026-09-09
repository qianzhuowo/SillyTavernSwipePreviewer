import { installNativeMessageButtons, installNativeTreeEntry, PREVIEW_BUTTON_SELECTOR as buttonSelector } from '../native-integration.mjs';

// Independent minimal native host. Deliberately does not install ST_API or shared mocks.
export const event_types = Object.fromEntries([
    ['APP_READY', 'app_ready'], ['CHAT_CHANGED', 'chat_id_changed'], ['MORE_MESSAGES_LOADED', 'more_messages_loaded'],
    ...['USER_MESSAGE_RENDERED', 'CHARACTER_MESSAGE_RENDERED', 'MESSAGE_UPDATED', 'MESSAGE_EDITED',
        'MESSAGE_SWIPED', 'MESSAGE_DELETED', 'MESSAGE_SWIPE_DELETED', 'GENERATION_STARTED'].map(key => [key, key.toLowerCase()]),
]);
const listeners = new Map();
export const eventSource = {
    on(type, handler) { const set = listeners.get(type) ?? new Set(); set.add(handler); listeners.set(type, set); },
    removeListener(type, handler) { listeners.get(type)?.delete(handler); },
    async emit(type, ...args) { for (const handler of [...(listeners.get(type) ?? [])]) await handler(...args); },
};
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const wait = async predicate => {
    for (let i = 0; i < 150; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
    throw new Error('Timed out waiting for native preview');
};

export async function runNativeBrowserCases() {
    const results = [];
    const test = async (name, run) => { await run(); results.push({ name, status: 'passed' }); };
    let wrapperReads = 0;
    let nativeEnterClicks = 0;
    // Match keyboard.js's document-level Enter-to-click synthesis (registered before extensions).
    const nativeKeydown = event => {
        if (event.key === 'Enter' && event.target.closest('.interactable')) {
            nativeEnterClicks++; event.target.closest('.interactable').click();
        }
    };
    document.addEventListener('keydown', nativeKeydown);
    Object.defineProperty(window, 'ST_API', { get() { wrapperReads++; throw new Error('Wrapper must never be read'); } });
    let saves = 0;
    const errors = [];
    window.toastr = { error: message => errors.push(message), warning() {}, success() {} };
    const context = {
        chatId: 'native-test-chat',
        chat: [{ name: 'AI', mes: 'active edited reply', swipes: ['first reply', 'stale reply'], swipe_id: 1, extra: {} },
            { name: 'User', mes: 'single native message', is_user: true, extra: {} }],
        eventSource, eventTypes: event_types, chatMetadata: {}, swipe: { state: () => 'none', refresh() {} },
        saveChat: async () => { saves++; }, updateMessageBlock() {},
    };
    window.SillyTavern = { getContext: () => context };
    localStorage.clear();
    const chat = document.querySelector('#chat');
    const template = document.querySelector('#message_template .mes');
    const cloneRow = (id, prepend = false) => {
        const row = template.cloneNode(true);
        row.setAttribute('mesid', String(id));
        if (prepend) chat.prepend(row); else chat.append(row);
        return row;
    };
    cloneRow(0); cloneRow(1);
    const row = id => chat.querySelector(`.mes[mesid="${id}"]`);
    const close = () => document.querySelector('#st-swipe-preview-modal-close')?.click();
    const open = async id => {
        row(id).querySelector(buttonSelector).click();
        await wait(() => document.querySelectorAll('.st-swipe-card').length > 0);
    };
    const checkButtons = extra => {
        for (const message of document.querySelectorAll('#message_template .mes, #chat .mes')) {
            const buttons = message.querySelectorAll(buttonSelector);
            assert(buttons.length === 1, 'exactly one preview button per template/message');
            assert(buttons[0].parentElement.matches(extra ? '.extraMesButtons' : '.mes_buttons'), 'correct parent container');
        }
    };
    await import('../index.js');
    await wait(() => template.querySelector(buttonSelector));
    await test('startup without wrapper patches native template and existing messages', () => {
        assert(wrapperReads === 0, 'no wrapper getter access'); checkButtons(false);
        assert(template.querySelector(buttonSelector).nextElementSibling.matches('.mes_edit'), 'normal button stays next to Edit');
    });
    await test('delegated native preview reads active edit and swipe_id without mutating chat', async () => {
        const before = JSON.stringify(context.chat);
        await open(0);
        assert(document.querySelectorAll('.st-swipe-card').length === 2, 'two native candidates');
        assert(document.querySelector('.st-swipe-card.active').dataset.idx === '1', 'native active swipe_id');
        assert(document.querySelector('.st-swipe-modal-content').textContent.includes('active edited reply'), 'active mes overrides stale swipe entry');
        assert(JSON.stringify(context.chat) === before && saves === 0, 'preview is read-only');
    });
    await test('settings repeatedly move one button in both live template and rendered rows', async () => {
        document.querySelector('#st-swipe-preview-modal-settings').click();
        const toggle = document.querySelector('#st-swipe-previewer-settings-modal-move');
        for (let i = 0; i < 12; i++) {
            toggle.checked = i % 2 === 0; toggle.dispatchEvent(new Event('change', { bubbles: true }));
            checkButtons(toggle.checked);
        }
        toggle.checked = true; toggle.dispatchEvent(new Event('change', { bubbles: true }));
        document.querySelector('#st-swipe-previewer-settings-modal-close').click(); close();
        checkButtons(true);
    });
    await test('new/history rows inherit template and repeated native events never duplicate buttons', async () => {
        context.chat.push({ mes: 'new native reply', extra: {} }); cloneRow(2);
        const historical = row(0); historical.remove(); cloneRow(0, true);
        // Both rows already contain the button before any event is dispatched.
        checkButtons(true);
        for (let i = 0; i < 3; i++) {
            for (const name of ['APP_READY', 'MORE_MESSAGES_LOADED', 'CHARACTER_MESSAGE_RENDERED', 'USER_MESSAGE_RENDERED', 'MESSAGE_UPDATED', 'MESSAGE_SWIPED', 'CHAT_CHANGED']) {
                await eventSource.emit(event_types[name], 2);
            }
        }
        checkButtons(true);
    });
    await test('render event restores a missing button and history event deduplicates inherited markup', async () => {
        row(2).querySelector(buttonSelector).remove();
        await eventSource.emit(event_types.CHARACTER_MESSAGE_RENDERED, 2);
        const duplicate = row(0).querySelector(buttonSelector).cloneNode(true); row(0).querySelector('.mes_buttons').append(duplicate);
        await eventSource.emit(event_types.MORE_MESSAGES_LOADED);
        checkButtons(true);
    });
    await test('extra-menu delegated click keeps single-swipe messages in preview', async () => {
        await open(1);
        assert(document.querySelectorAll('.st-swipe-card').length === 1, 'single candidate preview');
        assert(document.querySelector('.st-swipe-modal-content').textContent.includes('single native message'), 'native mes fallback'); close();
    });
    await test('delegation reads current mesid after message renumbering', async () => {
        const original = row(2); original.setAttribute('mesid', '1');
        original.querySelector(buttonSelector).click();
        await wait(() => document.querySelector('.st-swipe-card'));
        assert(document.querySelector('.st-swipe-modal-content').textContent.includes('single native message'), 'no captured old ID');
        close(); original.setAttribute('mesid', '2');
    });
    await test('invalid IDs, template clicks and removed rows cannot open preview', () => {
        const original = row(2);
        for (const id of ['', '-1', '1oops', '99', '1.5']) {
            original.setAttribute('mesid', id); original.querySelector(buttonSelector).click();
            assert(!document.querySelector('#st-swipe-preview-modal'), 'invalid ID ignored');
        }
        original.setAttribute('mesid', '2'); template.querySelector(buttonSelector).click();
        const detached = original.cloneNode(true); detached.querySelector(buttonSelector).click();
        assert(!document.querySelector('#st-swipe-preview-modal'), 'non-chat source ignored');
    });
    await test('native keyboard delegation supports Enter and Space', async () => {
        for (const key of ['Enter', ' ']) {
            row(1).querySelector(buttonSelector).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
            await wait(() => document.querySelector('.st-swipe-card')); close();
        }
        assert(nativeEnterClicks === 0, 'native document Enter handler cannot double-open the preview');
    });
    await test('chat-change lifecycle closes existing preview', async () => {
        await open(0); context.chatId = 'changed'; await eventSource.emit(event_types.CHAT_CHANGED);
        assert(!document.querySelector('#st-swipe-preview-modal'), 'preview removed after chat switch');
    });
    await test('replacement chat array with reused message objects cannot mutate stale preview', async () => {
        await open(0); context.chat = [...context.chat];
        const before = JSON.stringify(context.chat);
        const switchButton = document.querySelector('.st-swipe-card[data-idx="0"] .st-swipe-action-switch');
        switchButton.click(); await wait(() => errors.length > 0);
        assert(saves === 0 && JSON.stringify(context.chat) === before, 'stale identity blocks save/edit'); close();
    });
    await test('native chat-options entry migrates legacy button, retries APP_READY and reinstalls once', async () => {
        let calls = 0, toggles = 0, controller;
        const menu = document.querySelector('#options');
        const menuButton = document.querySelector('#options_button');
        menuButton.addEventListener('click', () => { toggles++; menu.style.display = 'none'; });
        const options = { document, eventSource, eventTypes: event_types, onOpen: () => calls++ };
        for (let i = 0; i < 3; i++) controller = installNativeTreeEntry(options);
        const entry = document.querySelector('#st-swipe-tree-entry');
        assert(entry.tagName === 'A' && entry.className === 'interactable' && entry.tabIndex === 0, 'native accessible menu item');
        assert(entry.previousElementSibling.id === 'option_select_chat' && entry.parentElement.matches('.options-content'), 'placed immediately after manage chat files');
        assert(entry.querySelector('i.fa-lg.fa-solid.fa-code-branch') && entry.querySelector('span').textContent === '聊天分支树', 'native icon and text structure');
        const legacy = document.createElement('button'); legacy.id = entry.id;
        document.querySelector('#extensions_settings2').append(legacy);
        await eventSource.emit(event_types.APP_READY);
        assert(!legacy.isConnected && document.querySelectorAll('#st-swipe-tree-entry').length === 1, 'legacy and duplicate entries removed');
        menu.style.display = 'block'; entry.querySelector('span').click();
        assert(calls === 1 && toggles === 1 && menu.style.display === 'none', 'one activation closes menu via native toggle');
        entry.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        assert(calls === 2 && nativeEnterClicks === 0, 'menu Enter cannot bubble into host activation');
        menu.remove(); controller.sync();
        assert(!document.querySelector('#st-swipe-tree-entry'), 'no fallback entry in settings when options are absent');
        document.body.append(menu); await eventSource.emit(event_types.APP_READY);
        assert(entry.isConnected && entry.previousElementSibling.id === 'option_select_chat', 'APP_READY reinstalls after missing menu appears');
        controller.dispose(); controller.dispose(); entry.click();
        assert(calls === 2 && !entry.isConnected, 'disposed entry and handlers are inactive');
    });
    await test('reinstall removes old subscriptions and delegation; disposal prevents activation', async () => {
        let calls = 0;
        const options = { document, eventSource, eventTypes: event_types, getContext: () => context, onPreview: () => { calls++; } };
        let controller;
        for (let i = 0; i < 4; i++) { controller = installNativeMessageButtons(options); controller.setExtraMenu(i % 2 === 0); }
        row(0).querySelector(buttonSelector).click();
        assert(calls === 1, 'one delegated callback after reinstall');
        assert(!document.querySelector('#st-swipe-preview-modal'), 'previous production delegation removed');
        for (const handlers of listeners.values()) assert(handlers.size <= 1, 'no duplicate event listeners');
        row(0).querySelector(buttonSelector).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        assert(calls === 2 && nativeEnterClicks === 0, 'Enter activates exactly once alongside native keyboard listener');
        row(0).querySelector(buttonSelector).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true, cancelable: true }));
        assert(calls === 2, 'held Enter does not reopen repeatedly');
        controller.dispose(); controller.dispose(); row(0).querySelector(buttonSelector).click();
        assert(calls === 2, 'disposed delegation does nothing');
        for (const handlers of listeners.values()) assert(handlers.size === 0, 'all native listeners disposed');
    });
    document.removeEventListener('keydown', nativeKeydown);
    assert(wrapperReads === 0, 'wrapper was never accessed');
    return results;
}
