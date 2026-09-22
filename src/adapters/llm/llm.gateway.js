/**
 * L2 适配器 · LlmPort 实现（默认 st-backend，可选 direct）。
 * 归属：W1-C 网关代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {object} LlmGatewayDeps
 * @property {Record<string, { complete: Function }>} transports
 * @property {(text: string) => import('../../infra/result.js').Ok<any>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>} extractJson
 */

/**
 * @param {LlmGatewayDeps} deps
 * @returns {import('../../ports/llm.port.js').LlmPort}
 */
export function createLlmGateway(deps) {
    throw new Error('not implemented: createLlmGateway');
}
