/**
 * L5 UI · 酒馆设置抽屉内精简面板（高频开关与当前选择）。
 * 归属：W2-H 面板代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {object} DrawerDeps
 * @property {() => object} loadSettings
 * @property {(patch: object) => void} saveSettings
 * @property {() => void} openManagementShell
 * @property {object} repos
 */

/**
 * @param {Element} root 挂到 #extensions_settings2 内的容器
 * @param {DrawerDeps} deps
 * @returns {{ destroy: () => void }}
 */
export function mountDrawer(root, deps) {
    throw new Error('not implemented: mountDrawer');
}
