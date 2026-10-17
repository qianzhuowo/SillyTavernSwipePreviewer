// TT keeps the complete chat array but may leave candidate payloads cold.
// Never interpret unloaded slots as empty swipes or write them back to disk.
export async function hydrateSwipes(nativeApi, messageId, getContext) {
    const context = getContext(), chat = context?.chat, message = chat?.[messageId], chatId = context?.chatId;
    const valid = () => {
        const current = getContext();
        return current?.chat === chat && current?.chatId === chatId && current?.chat?.[messageId] === message;
    };
    if (!message) throw new Error('楼层不存在');
    if (message.tt_swipe_cold) {
        if (typeof nativeApi.hydrateChatMessageSwipes !== 'function') throw new Error('当前 TT 版本无法加载冷分支，请更新 TT 或关闭冷分支加载后重开聊天');
        const loaded = await nativeApi.hydrateChatMessageSwipes(messageId);
        if (!valid() || loaded === false) throw new Error('加载分支期间聊天已变化，请重试');
        if (message.tt_swipe_cold) throw new Error('分支尚未完整加载，已停止操作');
    }
    if (!valid()) throw new Error('聊天已变化，请重新打开预览');
}
export async function locateBoundedMessage(nativeApi, mesId) {
    if (!nativeApi.isBoundedChatSurfaceView?.()) return false;
    if (typeof nativeApi.jumpBoundedChatSurfaceToMessage !== 'function') throw new Error('当前 TT 版本无法定位有界历史消息');
    await nativeApi.jumpBoundedChatSurfaceToMessage(mesId);
    return true;
}
