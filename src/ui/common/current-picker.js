/**
 * L5 UI · 当前项选择器（封面 + 搜索 + 高亮 + 清除）。
 * 归属：W1-E 组件代理实现。W0 仅冻结签名。
 */

/**
 * @param {Element} root
 * @param {object} deps
 * @param {() => Promise<object[]>} deps.list
 * @param {() => string|null} deps.getActiveId
 * @param {(id: string|null) => void} deps.setActiveId
 * @param {(item: object) => string} [deps.getLabel]
 * @returns {{ destroy: () => void, refresh: () => Promise<void> }}
 */
export function mountCurrentPicker(root, deps) {
    throw new Error('not implemented: mountCurrentPicker');
}
