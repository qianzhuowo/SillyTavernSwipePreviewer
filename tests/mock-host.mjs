// Browser-only mock host. Never imports real SillyTavern APIs or persists chat.
import { TIMELINE_PREFERENCES_KEY } from '../timeline-preferences.mjs';
export function installMockHost() {
    const listeners = new Map();
    const tracked = [];
    for (const target of [window, document]) {
        const add = target.addEventListener.bind(target);
        const remove = target.removeEventListener.bind(target);
        const records = [];
        tracked.push(records);
        target.addEventListener = (type, handler, options) => {
            const capture = typeof options === 'boolean' ? options : !!options?.capture;
            if (['keydown', 'message', 'focusin'].includes(type)
                && !records.some(r => r.type === type && r.handler === handler && r.capture === capture)) {
                records.push({ type, handler, capture });
            }
            return add(type, handler, options);
        };
        target.removeEventListener = (type, handler, options) => {
            const capture = typeof options === 'boolean' ? options : !!options?.capture;
            const index = records.findIndex(r => r.type === type && r.handler === handler && r.capture === capture);
            if (index >= 0) records.splice(index, 1);
            return remove(type, handler, options);
        };
    }
    // Relevant keyboard.js selectors and its document-bubble Enter behavior. Deliberately
    // does NOT check defaultPrevented, repeat or isComposing, matching the native host.
    document.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || !(event.target instanceof HTMLElement)
            || event.altKey || event.ctrlKey || event.shiftKey) return;
        const target = event.target.closest('.interactable, .menu_button, .mes_buttons .mes_button');
        if (target && !target.classList.contains('disabled')) target.click();
    });
    const names = ['CHAT_CHANGED', 'GENERATION_STARTED', 'GENERATION_ENDED', 'GENERATION_STOPPED',
        'MESSAGE_SWIPED', 'MESSAGE_UPDATED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPE_DELETED',
        'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'CHARACTER_FIRST_MESSAGE_SELECTED', 'APP_READY',
        'MORE_MESSAGES_LOADED', 'USER_MESSAGE_RENDERED', 'CHARACTER_MESSAGE_RENDERED'];
    const eventTypes = Object.fromEntries(names.map(name => [name, name]));
    const mock = window.mock = {
        generating: false, saving: false, confirmMode: 'accept', pendingConfirm: null,
        stats: {}, notifications: [], errors: [], context: null,
        // Native host rendering clones the patched live template, including button placement.
        createMessageElement(index) {
            const node = document.querySelector('#message_template .mes').cloneNode(true);
            node.setAttribute('mesid', String(index));
            node.querySelector('.mes_text').textContent = this.context.chat[index]?.mes ?? '';
            return node;
        },
        async renderMessage(index, { cloneTemplate = true } = {}) {
            const node = this.createMessageElement(index);
            // Simulate alternate native render paths which don't preserve the template patch.
            if (!cloneTemplate) node.querySelectorAll('.st-swipe-previewer-button').forEach(button => button.remove());
            document.querySelector(`#chat .mes[mesid="${index}"]`)?.remove();
            document.querySelector('#chat').append(node);
            await eventSource.emit(eventTypes[this.context.chat[index]?.is_user ? 'USER_MESSAGE_RENDERED' : 'CHARACTER_MESSAGE_RENDERED'], index);
            return node;
        },
        listenerCounts() {
            return { emitter: [...listeners.values()].reduce((n, set) => n + set.size, 0),
                dom: tracked.reduce((n, records) => n + records.length, 0) };
        },
        openOptions() {
            if (getComputedStyle(document.querySelector('#options')).display === 'none') document.querySelector('#options_button').click();
        },
        async reset({ preserveTreePreferences = false } = {}) {
            document.querySelector('#st-swipe-preview-modal-close')?.click();
            document.querySelector('.st-swipe-tree-close')?.click();
            document.querySelector('#st-swipe-previewer-settings-modal-close')?.click();
            if (!preserveTreePreferences) localStorage.removeItem(TIMELINE_PREFERENCES_KEY);
            if (getComputedStyle(document.querySelector('#options')).display !== 'none') document.querySelector('#options_button').click();
            this.pendingConfirm?.(false);
            this.pendingConfirm = null;
            this.generating = false;
            this.saving = false;
            this.confirmMode = 'accept';
            this.historyLoadHook = null;
            document.querySelector('#chat').replaceChildren();
            this.notifications = [];
            this.errors = [];
            this.stats = { saves: 0, updates: 0, refreshes: 0, cancelledSaves: 0, confirms: 0, branches: 0, opens: 0, events: [] };
            const swipes = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
            const swipe_info = swipes.map((text, index) => ({ send_date: `date-${index}`,
                gen_started: index * 10, gen_finished: index * 10 + 5,
                extra: { marker: text, token_count: index + 10, reasoning: `reason-${text}` } }));
            const active = 2;
            const message = { name: 'Mock AI', is_user: false, mes: swipes[active], swipes,
                swipe_id: active, swipe_info, ...structuredClone(swipe_info[active]) };
            this.context = { chatId: 'mock-chat-A', characterId: 0, groupId: null,
                chat: [message, { name: 'Single AI', is_user: false, mes: 'Only single message', extra: {} }],
                chatMetadata: {}, eventSource, event_types: eventTypes, eventTypes,
                getCurrentChatId: () => mock.context.chatId,
                saveChat: async () => { mock.stats.saves++; },
                updateMessageBlock: () => { mock.stats.updates++; },
                swipe: { state: () => 'none', refresh: () => { mock.stats.refreshes++; } },
                Popup: { show: { confirm: async (title, prompt) => {
                    mock.stats.confirms++;
                    mock.lastPrompt = { title, prompt };
                    if (mock.confirmMode === 'hold') return new Promise(resolve => { mock.pendingConfirm = resolve; });
                    return mock.confirmMode === 'accept';
                } } },
                openCharacterChat: async () => { mock.stats.opens++; },
                openGroupChat: async () => { mock.stats.opens++; },
            };
            document.querySelector('#chat').replaceChildren(...this.context.chat.map((_, index) => this.createMessageElement(index)));
            await eventSource.emit(eventTypes.CHAT_CHANGED);
            this.stats.events = [];
        },
        async switchChat() {
            const old = this.context.chat;
            this.context = { ...this.context, chatId: 'mock-chat-B',
                chat: [{ name: 'Other AI', mes: 'Unrelated chat', extra: {} }] };
            await eventSource.emit(eventTypes.CHAT_CHANGED);
            return old;
        },
    };
    const eventSource = {
        on(type, handler) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(handler); },
        removeListener(type, handler) { listeners.get(type)?.delete(handler); },
        async emit(type, ...args) {
            mock.stats.events?.push({ type, args: structuredClone(args),
                swipes: [...(mock.context?.chat?.[0]?.swipes || [])] });
            for (const handler of [...(listeners.get(type) || [])]) await handler(...args);
        },
    };
    window.SillyTavern = { getContext: () => mock.context };
    window.toastr = Object.fromEntries(['error', 'warning', 'info', 'success'].map(level =>
        [level, text => mock.notifications.push({ level, text })]));
    window.addEventListener('error', event => mock.errors.push(event.message));
    window.addEventListener('unhandledrejection', event => mock.errors.push(String(event.reason)));
    let optionsVisible = false;
    document.querySelector('#options_button').addEventListener('click', () => {
        optionsVisible = !optionsVisible;
        document.querySelector('#options').style.display = optionsVisible ? 'block' : 'none';
    });
    // Real page reloads must retain preferences; individual test cases reset explicitly.
    return mock.reset({ preserveTreePreferences: true });
}
