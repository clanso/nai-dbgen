/**
 * L5 UI · 拖放 + 预览表 + 重复策略（跳过/覆盖/另存）。
 * 归属：W1-E 组件代理实现。W0 仅冻结签名。
 */

/**
 * @param {Element} root
 * @param {object} deps
 * @param {(data: object, strategy: string) => Promise<object>} deps.importJson
 * @param {() => Promise<object>} deps.exportJson
 * @returns {{ destroy: () => void }}
 */
export function mountImportExport(root, deps) {
    throw new Error('not implemented: mountImportExport');
}
