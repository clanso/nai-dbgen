/**
 * L2 适配器 · 经 ST ChatCompletionService + reverse_proxy（基线 §8.4）。
 * 归属：W1-C 网关代理实现。W0 仅冻结签名。
 */

/**
 * @param {object} deps
 * @param {() => any} deps.getContext
 * @returns {{
 *   name: string,
 *   complete: (req: import('../../../ports/llm.port.js').LlmCompleteRequest) => Promise<import('../../../infra/result.js').Ok<import('../../../ports/llm.port.js').LlmCompleteResult>|import('../../../infra/result.js').Err<import('../../../infra/errors.js').AppError>>,
 * }}
 */
export function createStBackendLlmTransport(deps) {
    throw new Error('not implemented: createStBackendLlmTransport');
}
