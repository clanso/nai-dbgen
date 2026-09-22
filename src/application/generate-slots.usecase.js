/**
 * L4 应用层 · 步骤 4–5：准备四块、LLM 生提示词、写 slot。
 * 归属：W2-F 用例代理实现。W0 仅冻结签名。
 * 断言：整条链路 LLM 调用恰为 2 次。
 */

/**
 * @typedef {object} GenerateSlotsDeps
 * @property {import('../ports/host.port.js').HostPort} host
 * @property {import('../ports/llm.port.js').LlmPort} llm
 * @property {object} repos 含 character/tag/preset/slot/api-config 等
 * @property {ReturnType<import('../infra/event-bus.js').createEventBus>} bus
 * @property {() => string} newId
 * @property {() => string} nowIso
 */

/**
 * @typedef {object} GenerateSlotsResult
 * @property {import('../domain/model/slot.js').SlotRecord[]} records
 * @property {string} traceId
 * @property {number} llmCallCount 必须为 2
 */

/**
 * @param {GenerateSlotsDeps} deps
 * @returns {{ execute: (messageId: number, opts?: object) => Promise<import('../infra/result.js').Ok<GenerateSlotsResult>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>> }}
 */
export function createGenerateSlotsUseCase(deps) {
    throw new Error('not implemented: createGenerateSlotsUseCase');
}
