/**
 * L5 UI · 标签库长列表虚拟化。
 * 归属：W1-E 组件代理实现。W0 仅冻结签名。
 */

/**
 * @param {Element} root
 * @param {object} deps
 * @param {() => object[]} deps.getItems
 * @param {(item: object, el: HTMLElement) => void} deps.renderRow
 * @param {number} [deps.rowHeight=36]
 * @returns {{ destroy: () => void, refresh: () => void }}
 */
export function mountVirtualList(root, deps) {
    throw new Error('not implemented: mountVirtualList');
}
