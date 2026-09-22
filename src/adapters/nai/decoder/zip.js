/**
 * L2 适配器 · ZIP/deflate-raw 手工解码（浏览器原生 DecompressionStream，无第三方库）。
 * 归属：W1-C 网关代理实现。W0 仅冻结签名。
 */

/**
 * @param {import('../transport/direct.js').TransportResponse} response
 * @returns {Promise<import('../../../infra/result.js').Ok<import('../../../ports/image-gen.port.js').GeneratedImage[]>|import('../../../infra/result.js').Err<import('../../../infra/errors.js').AppError>>}
 */
export function decodeZip(response) {
    throw new Error('not implemented: decodeZip');
}
