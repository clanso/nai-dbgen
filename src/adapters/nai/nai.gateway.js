/**
 * L2 适配器 · ImageGenPort 实现：传输策略矩阵 + 解码（架构 §6.7）。
 * 归属：W1-C 网关代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {object} NaiGatewayDeps
 * @property {Record<string, { send: Function }>} transports 含 direct / st-cors-proxy
 * @property {Record<string, { decode: Function }>} decoders 含 json-base64 / zip
 */

/**
 * @param {NaiGatewayDeps} deps
 * @returns {import('../../ports/image-gen.port.js').ImageGenPort}
 */
export function createNaiGateway(deps) {
    throw new Error('not implemented: createNaiGateway');
}
