/**
 * L4 应用层 · 生成工作台两个解耦功能：写提示词 / 用当前提示词出图。
 * 归属：W2-F 用例代理实现。W0 仅冻结签名。
 *
 * 裁决 D13：工作台提示词为结构化 NaiCaption（base_caption + char_captions），
 * 不是自由文本。UI 上 base 为文本域，角色为可增删列表。
 */

/**
 * @typedef {import('../domain/model/nai-params.js').NaiCaption} NaiCaption
 * @typedef {import('../domain/model/nai-params.js').NaiParams} NaiParams
 * @typedef {import('../domain/model/plugin-settings.js').PluginSettings} PluginSettings
 * @typedef {import('../ports/image-gen.port.js').GeneratedImage} GeneratedImage
 */

/**
 * @typedef {object} WorkbenchDeps
 * @property {import('../ports/llm.port.js').LlmPort} llm
 * @property {import('./image-gen.service.js').ImageGenService} imageGen
 * @property {import('../ports/repository.port.js').CharacterRepository} characterRepo
 * @property {import('../ports/repository.port.js').TagRepository} tagRepo
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/preset.js').Preset>} [presetRepo]
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/api-config.js').LlmApiConfig>} llmConfigRepo
 * @property {() => PluginSettings} loadSettings
 * @property {(template: string) => string} runHostMacros
 */

/**
 * @typedef {object} WorkbenchWritePromptInput
 * @property {string} naturalLanguage
 * @property {string[]} libraryIds 本次勾选的标签库（不改全局激活）
 * @property {AbortSignal} [signal]
 * @property {string} [traceId]
 */

/**
 * @typedef {object} WorkbenchGenerateInput
 * @property {NaiCaption} caption 当前工作台结构化提示词（裁决 D13）
 * @property {boolean} replaceCharacterKeywords 页面拨档，程序不自判
 * @property {Partial<NaiParams>} [params]
 * @property {AbortSignal} [signal]
 * @property {string} [traceId]
 */

/**
 * @param {WorkbenchDeps} deps
 * @returns {{
 *   writePrompt: (input: WorkbenchWritePromptInput) => Promise<import('../infra/result.js').Ok<NaiCaption>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>,
 *   generateImage: (input: WorkbenchGenerateInput) => Promise<import('../infra/result.js').Ok<GeneratedImage[]>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>,
 * }}
 */
export function createWorkbenchService(deps) {
    throw new Error('not implemented: createWorkbenchService');
}
