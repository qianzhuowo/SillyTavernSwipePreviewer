import { hydrateSwipes } from './host-compat.mjs';
import { prepareSwipes } from './swipe-data.mjs';

const assistant = message => message && !message.is_user && !message.is_system && !message.extra?.isSmallSys;
const hasReply = message => assistant(message) && (
    (typeof message.mes === 'string' && !['', '...'].includes(message.mes.trim()))
    || Boolean(message.extra?.reasoning) || Boolean(message.extra?.media?.length)
);

const hasAgentState = message => [message.extra, ...(Array.isArray(message.swipe_info) ? message.swipe_info : []).map(info => info?.extra)]
    .some(extra => {
        const id = extra?.tauritavern?.agent?.persistStateId;
        return typeof id === 'string' ? id.trim().length > 0 : Boolean(id);
    });

// Work on copies only: a failed/aborted native generation must never restore or edit
// a deleted message, nor populate TT's unloaded swipe slots with invented data.
function snapshot(message) {
    const copy = structuredClone(message);
    if (!Array.isArray(copy.swipes) || !copy.swipes.length) copy.swipes = [copy.mes ?? ''];
    prepareSwipes(copy);
    return copy;
}

export function installRegeneratePreservation({ eventSource, eventTypes, nativeApi = {}, getContext,
    onUnsupported = reason => console.warn('[Swipe Previewer]', reason),
    onError = error => console.warn('[Swipe Previewer] Cannot preserve regenerated swipes', error) }) {
    let pending = null;
    const bindings = [];
    const listen = (key, handler, first = false) => {
        const event = eventTypes?.[key];
        if (!event) return;
        eventSource.on(event, handler);
        if (first) eventSource.makeFirst?.(event, handler);
        bindings.push([event, handler]);
    };
    const reset = () => { pending = null; };
    const sameChat = transaction => {
        const ctx = getContext();
        return ctx?.chat === transaction.chat && ctx?.chatId === transaction.chatId
            && ctx?.characterId === transaction.characterId && ctx?.groupId === transaction.groupId
            && !ctx?.groupId && !transaction.signal?.aborted
            && transaction.prefix.every((message, id) => ctx.chat[id] === message);
    };
    const replacement = transaction => {
        const message = transaction.chat[transaction.id];
        return sameChat(transaction) && transaction.deleted && transaction.chat.length === transaction.id + 1
            && message !== transaction.original && hasReply(message) && !message.tt_swipe_cold
            && message.name === transaction.original.name ? message : null;
    };

    listen('GENERATION_STARTED', async (type, options = {}, dryRun = false) => {
        reset();
        const ctx = getContext(), chat = ctx?.chat;
        // Group regeneration deletes a whole generation BEFORE this event, then
        // generates 'normal' replies. Mapping those to a single old tail is unsafe.
        if (type !== 'regenerate' || dryRun || ctx?.groupId || !Array.isArray(chat)
            || ctx.chatId == null || !assistant(chat.at(-1)) || options?.signal?.aborted) return;
        const id = chat.length - 1;
        const transaction = { chat, chatId: ctx.chatId, characterId: ctx.characterId, groupId: ctx.groupId,
            id, original: chat[id], prefix: chat.slice(0, id), signal: options?.signal, deleted: false };
        pending = transaction;
        try {
            // GENERATION_STARTED is awaited by both ST and TT, before deletion.
            await hydrateSwipes(nativeApi, id, getContext);
            if (pending !== transaction || !sameChat(transaction) || chat.length !== id + 1
                || chat[id] !== transaction.original) return;
            // TT asynchronously flushes deletion and prunes agent state directories.
            // Restoring their IDs as ordinary swipe metadata would create dangling
            // external references. Do not strip IDs or claim these branches survived.
            // Inspect every raw entry BEFORE snapshot/prepareSwipes can replace the
            // active extra cache, including fields hydrated from TT cold storage.
            if (hasAgentState(chat[id])) {
                reset();
                onUnsupported('此回复包含 TT Agent 持久化状态，重新生成将按宿主原有逻辑替换消息，插件不会自动保留旧分支。请先备份聊天。');
                return;
            }
            transaction.backup = snapshot(chat[id]);
        } catch (error) {
            if (pending === transaction) reset();
            onError(error);
        }
    });
    listen('MESSAGE_DELETED', length => {
        const transaction = pending;
        if (!transaction) return;
        if (!transaction.backup || !sameChat(transaction) || transaction.deleted
            || length !== transaction.id || transaction.chat.length !== transaction.id) return reset();
        transaction.deleted = true;
    });
    listen('MESSAGE_RECEIVED', (id, type) => {
        const transaction = pending;
        if (!transaction) return;
        // saveReply may normalize regenerate to normal after deleting the old tail.
        const message = replacement(transaction);
        if (!message || id !== transaction.id || !['normal', 'regenerate'].includes(type)) return reset();
        reset();
        try {
            const fresh = snapshot(message), old = transaction.backup;
            const swipes = [...old.swipes, ...fresh.swipes];
            const info = [...old.swipe_info, ...fresh.swipe_info];
            // Keep the new reply visible, with its own reasoning/media/annotations.
            // Do not deduplicate equal text: metadata may represent distinct runs.
            // ST saveReply (script.js ~6497-6525) and TT (~8361-8390) emit
            // RECEIVED/render BEFORE initializing swipes. Setting swipe_id here
            // deliberately selects their existing-index sync path: they update only
            // this new active slot instead of replacing the merged arrays.
            message.swipes = swipes;
            message.swipe_info = info;
            message.swipe_id = old.swipes.length + fresh.swipe_id;
        } catch (error) { onError(error); }
    }, true);
    listen('GENERATION_ENDED', () => {
        // ST streaming calls unblockGeneration (ENDED) immediately BEFORE RECEIVED.
        // Keep only an already-existing, structurally verified replacement for that
        // final event. All other exits discard the snapshot; no restoration/save.
        if (pending && !replacement(pending)) reset();
    });
    listen('GENERATION_STOPPED', reset);
    listen('CHAT_CHANGED', reset);
    return () => {
        reset();
        for (const [event, handler] of bindings) eventSource.removeListener?.(event, handler);
    };
}
