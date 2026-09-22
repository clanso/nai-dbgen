/**
 * L5 UI · 四库共用的「工具栏 + 卡片网格」范式（架构 §8.5）。
 * 归属：W2-H 面板代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {object} LibraryColumn
 * @property {string} key
 * @property {string} label
 * @property {(item: object) => string|Element} [render]
 */

/**
 * @typedef {object} LibraryViewDeps
 * @property {() => Promise<object[]>} list
 * @property {(item: object) => void} onEdit
 * @property {() => void} onCreate
 * @property {(ids: string[]) => void} [onDelete]
 * @property {() => void} [onImport]
 * @property {() => void} [onExport]
 * @property {(item: object, active: boolean) => void} [onToggleActive]
 */

/**
 * @param {Element} root
 * @param {LibraryViewDeps} deps
 * @param {{ columns?: LibraryColumn[], searchKeys?: string[] }} [opts]
 * @returns {{ destroy: () => void, refresh: () => Promise<void> }}
 */
export function mountLibraryView(root, deps, opts) {
    throw new Error('not implemented: mountLibraryView');
}
