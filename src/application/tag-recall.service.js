/**
 * L4 应用层 · 标签召回：一次 LLM，只传 key，回文对 key 后取 value。
 * 归属：W2-F 用例代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {import('../domain/model/plugin-settings.js').PluginSettings} PluginSettings
 */

/**
 * @typedef {object} TagRecallDeps
 * @property {import('../ports/llm.port.js').LlmPort} llm
 * @property {import('../ports/repository.port.js').TagRepository} tagRepo
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/preset.js').Preset>} presetRepo
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/api-config.js').LlmApiConfig>} llmConfigRepo
 * @property {() => PluginSettings} loadSettings
 * @property {(template: string) => string} runHostMacros
 */

/**
 * @typedef {object} TagRecallInput
 * @property {string} contextText 当前上下文
 * @property {string[]} [libraryIds] 工作台可覆盖本次勾选的库；缺省用全局已激活库
 * @property {string} [traceId]
 * @property {AbortSignal} [signal]
 */

/**
 * @param {TagRecallDeps} deps
 * @returns {{ recall: (input: TagRecallInput) => Promise<import('../infra/result.js').Ok<import('../domain/model/tag.js').TagEntry[]>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>> }}
 */
export function createTagRecallService(deps) {
    throw new Error('not implemented: createTagRecallService');
}
