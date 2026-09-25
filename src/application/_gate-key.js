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

/**
 * 4.16 单图提示词闸门：同一 chat + 视点楼 + 描述（已 trim）共享一次请求。
 * @param {string|null|undefined} chatId
 * @param {number} messageId
 * @param {string} descriptionTrimmed
 * @returns {string}
 */
export function singlePromptGateKey(chatId, messageId, descriptionTrimmed) {
    const c = chatId == null || chatId === '' ? '_' : String(chatId);
    return `${c}:${Number(messageId)}:${String(descriptionTrimmed ?? '')}`;
}
