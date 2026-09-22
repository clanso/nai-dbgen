/**
 * L5 UI · 管理台 Popup 外壳 + 标签页路由。
 * 归属：W2-H 面板代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {object} PanelShellDeps
 * @property {import('../../ports/host.port.js').HostPort} host
 * @property {object} repos
 * @property {object} services
 */

/**
 * 打开管理台；返回句柄以便 dispose 时关闭。
 * @param {PanelShellDeps} deps
 * @param {string} [initialTab]
 * @returns {Promise<{ destroy: () => void }>}
 */
export function openPanelShell(deps, initialTab) {
    throw new Error('not implemented: openPanelShell');
}
