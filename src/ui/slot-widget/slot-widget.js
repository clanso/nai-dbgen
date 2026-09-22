/**
 * L5 UI · 楼层内 slot 控件：补类名、填按钮文案、塞图片、事件绑定。
 * 归属：W2-G 控件代理实现。W0 仅冻结签名。
 * 每个挂载函数须返回 { destroy }。
 */

/**
 * @typedef {object} SlotWidgetDeps
 * @property {(messageId: number, slotId: number) => void} onGenerateClick
 * @property {(messageId: number, slotId: number) => import('../../domain/model/slot.js').SlotRecord|null} getRecord
 * @property {(imageRef: string) => Promise<string|null>} getImageUrl
 */

/**
 * 在已存在的 div[data-slot] 根上挂载（幂等：已 data-nai-mounted 则跳过或刷新）。
 * @param {Element} rootEl div[data-slot]
 * @param {number} messageId
 * @param {SlotWidgetDeps} deps
 * @returns {{ destroy: () => void, refresh: () => void }}
 */
export function mountSlotWidget(rootEl, messageId, deps) {
    throw new Error('not implemented: mountSlotWidget');
}
