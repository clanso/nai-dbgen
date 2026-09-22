/**
 * L2 适配器 · MutationObserver 幂等对账挂载 slot 控件（架构 §6.1）。
 * 归属：W1-B 宿主代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {object} SlotMountDeps
 * @property {(messageEl: Element, messageId: number, slotId: number) => void} mountSlot
 * @property {() => Element|null} getChatRoot 通常 #chat
 */

/**
 * @param {SlotMountDeps} deps
 * @returns {{ start: () => void, stop: () => void, reconcile: () => void }}
 */
export function createSlotMountObserver(deps) {
    throw new Error('not implemented: createSlotMountObserver');
}
