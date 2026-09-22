/**
 * L2 适配器 · 经 ST /proxy/:url 转发（基线 §8.2，需 enableCorsProxy）。
 * 归属：W1-C 网关代理实现。W0 仅冻结签名。
 */

/**
 * @param {object} [deps]
 * @returns {{
 *   name: string,
 *   send: (url: string, init: RequestInit) => Promise<import('../../../infra/result.js').Ok<import('./direct.js').TransportResponse>|import('../../../infra/result.js').Err<import('../../../infra/errors.js').AppError>>,
 * }}
 */
export function createStCorsProxyTransport(deps) {
    throw new Error('not implemented: createStCorsProxyTransport');
}
