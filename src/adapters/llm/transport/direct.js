/**
 * L2 适配器 · LLM 浏览器直连（绕开 ST 服务端）。
 * 归属：W1-C 网关代理实现。W0 仅冻结签名。
 */

/**
 * @param {object} [deps]
 * @returns {{
 *   name: string,
 *   complete: (req: import('../../../ports/llm.port.js').LlmCompleteRequest) => Promise<import('../../../infra/result.js').Ok<import('../../../ports/llm.port.js').LlmCompleteResult>|import('../../../infra/result.js').Err<import('../../../infra/errors.js').AppError>>,
 * }}
 */
export function createDirectLlmTransport(deps) {
    throw new Error('not implemented: createDirectLlmTransport');
}
