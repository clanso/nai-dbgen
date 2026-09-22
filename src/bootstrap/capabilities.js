/**
 * L0 装配 · 宿主能力探测 → CapabilityReport（架构文档 §1 G5、基线 §12）。
 * 归属：W3-J 装配代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {import('../ports/index.d.ts').CapabilityReport} CapabilityReport
 */

/**
 * 启动期逐项探测版本敏感能力；缺失项降级并供 UI 明示。
 * @param {import('../ports/host.port.js').HostPort} host
 * @returns {Promise<CapabilityReport>}
 */
export function probeCapabilities(host) {
    throw new Error('not implemented: probeCapabilities');
}
