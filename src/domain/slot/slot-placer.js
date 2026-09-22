/**
 * L3 领域层 · 用「生成点」在楼层正文定位并插入 slot。
 * 归属：W1-A 领域代理实现。W0 仅冻结签名。
 *
 * 匹配降级（R-08）：精确 → 归一化空白/标点 → 最长公共子串；全失败则追加段末并标记警告。
 */

/**
 * @typedef {import('../model/slot.js').SlotPlan} SlotPlan
 */

/**
 * @typedef {object} PlaceSlotsResult
 * @property {string} text 插入后的正文
 * @property {Array<{ slotId: number, placed: boolean, mode: string }>} placements
 */

/**
 * 按各 SlotPlan 的 anchorSentence 依次插入 formatSlotToken(slotId)。
 * @param {string} messageText 当前楼正文
 * @param {SlotPlan[]} plans
 * @returns {PlaceSlotsResult}
 */
export function placeSlots(messageText, plans) {
    throw new Error('not implemented: placeSlots');
}

/**
 * 在 text 中定位 anchor，返回插入下标（anchor 结束之后）；找不到返回 -1。
 * @param {string} text
 * @param {string} anchorSentence
 * @returns {{ index: number, mode: string }}
 */
export function findAnchorInsertIndex(text, anchorSentence) {
    throw new Error('not implemented: findAnchorInsertIndex');
}
