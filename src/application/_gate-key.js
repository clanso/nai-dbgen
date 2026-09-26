/**
 * L4 应用层私有 · 出图闸门键（裁决 D36）。
 * 键一律 `chatId:messageId:slotId`；messageId 仅为当前聊天下标。
 */

/**
 * @param {string|null|undefined} chatId
 * @param {number} messageId
 * @param {number} slotId
 * @returns {string}
 */
export function renderGateKey(chatId, messageId, slotId) {
    const c = chatId == null || chatId === '' ? '_' : String(chatId);
    return `${c}:${Number(messageId)}:${Number(slotId)}`;
}

/**
 * @param {string|null|undefined} chatId
 * @param {number} messageId
 * @returns {string}
 */
export function writeGateKey(chatId, messageId) {
    const c = chatId == null || chatId === '' ? '_' : String(chatId);
    return `${c}:${Number(messageId)}`;
}
