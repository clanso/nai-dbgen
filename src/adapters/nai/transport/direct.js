/**
 * L2 适配器 · NAI 浏览器直连传输（基线 §8.3）。
 * 归属：W1-C 网关代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {object} TransportResponse
 * @property {number} status
 * @property {Headers|Record<string,string>} headers
 * @property {ArrayBuffer|Blob|string} body
 */

/**
 * @param {object} [deps]
 * @returns {{
 *   name: string,
 *   send: (url: string, init: RequestInit) => Promise<import('../../../infra/result.js').Ok<TransportResponse>|import('../../../infra/result.js').Err<import('../../../infra/errors.js').AppError>>,
 * }}
 */
export function createDirectTransport(deps) {
    throw new Error('not implemented: createDirectTransport');
}
