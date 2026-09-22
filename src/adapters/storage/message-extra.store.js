/**
 * L2 适配器 · message.extra['nai-dbgen'] slot 权威记录（基线 §9）。
 * 归属：W1-D 存储代理实现。W0 仅冻结签名。
 */

/**
 * @param {object} deps
 * @param {import('../../ports/host.port.js').HostPort} deps.host
 * @returns {{
 *   read: (messageId: number) => object,
 *   write: (messageId: number, patch: object) => Promise<import('../../infra/result.js').Ok<void>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>,
 * }}
 */
export function createMessageExtraStore(deps) {
    throw new Error('not implemented: createMessageExtraStore');
}
