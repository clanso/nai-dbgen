/**
 * L4 应用层 · 步骤 4–5：准备四块、LLM 生提示词、写 slot。
 * 归属：W2-F 用例代理实现。W0 仅冻结签名。
 * 断言：整条链路 LLM 调用恰为 2 次；同一次 execute 共用一个 traceId 串起两次 LLM。
 * （出图 / NAI 调用由 RenderSlotUseCase 另开 trace，不混在本链路。）
 */

/**
 * @typedef {import('../domain/model/plugin-settings.js').PluginSettings} PluginSettings
 */

/**
 * @typedef {object} GenerateSlotsDeps
 * @property {import('../ports/host.port.js').HostPort} host
 * @property {import('../ports/llm.port.js').LlmPort} llm
 * @property {import('../ports/repository.port.js').CharacterRepository} characterRepo
 * @property {import('../ports/repository.port.js').TagRepository} tagRepo
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/preset.js').Preset>} presetRepo
 * @property {import('../ports/repository.port.js').SlotRepository} slotRepo
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/api-config.js').LlmApiConfig>} llmConfigRepo
 * @property {ReturnType<import('./context-collector.js').createContextCollector>} contextCollector
 * @property {ReturnType<import('./worldinfo-resolver.js').createWorldInfoResolver>} worldInfoResolver
 * @property {ReturnType<import('./tag-recall.service.js').createTagRecallService>} tagRecall
 * @property {ReturnType<import('../infra/event-bus.js').createEventBus>} bus
 * @property {() => PluginSettings} loadSettings
 * @property {(template: string) => string} runHostMacros
 * @property {() => string} newId
 * @property {() => string} nowIso
 * @property {() => string} newTraceId
 */

/**
 * @typedef {object} GenerateSlotsOptions
 * @property {AbortSignal} [signal]
 * @property {string} [traceId] 若省略则 newTraceId()；须写入两次 LLM 调用的日志/错误
 */

/**
 * @typedef {object} GenerateSlotsResult
 * @property {import('../domain/model/slot.js').SlotRecord[]} records
 * @property {string} traceId
 * @property {number} llmCallCount 必须为 2
 */

/**
 * @param {GenerateSlotsDeps} deps
 * @returns {{ execute: (messageId: number, opts?: GenerateSlotsOptions) => Promise<import('../infra/result.js').Ok<GenerateSlotsResult>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>> }}
 */
export function createGenerateSlotsUseCase(deps) {
    throw new Error('not implemented: createGenerateSlotsUseCase');
}
