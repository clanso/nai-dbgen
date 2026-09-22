/**
 * L2 适配器 · Accept: application/json → base64 图片数组解码。
 * 归属：W1-C 网关代理实现。W0 仅冻结签名。
 */

/**
 * @param {import('../transport/direct.js').TransportResponse} response
 * @returns {Promise<import('../../../infra/result.js').Ok<import('../../../ports/image-gen.port.js').GeneratedImage[]>|import('../../../infra/result.js').Err<import('../../../infra/errors.js').AppError>>}
 */
export function decodeJsonBase64(response) {
    throw new Error('not implemented: decodeJsonBase64');
}
