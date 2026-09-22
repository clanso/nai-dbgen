/**
 * L4 应用层 · 生成工作台两个解耦功能：写提示词 / 用当前提示词出图。
 * 归属：W2-F 用例代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {object} WorkbenchDeps
 * @property {import('../ports/llm.port.js').LlmPort} llm
 * @property {import('./image-gen.service.js').ImageGenService} imageGen
 * @property {object} repos
 * @property {() => object} loadSettings
 * @property {(template: string) => string} runHostMacros
 */

/**
 * @typedef {object} WorkbenchWritePromptInput
 * @property {string} naturalLanguage
 * @property {string[]} libraryIds 本次勾选的标签库（不改全局激活）
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {object} WorkbenchGenerateInput
 * @property {import('../domain/model/nai-params.js').NaiCaption|object} caption 当前工作台提示词
 * @property {boolean} replaceCharacterKeywords 页面拨档，程序不自判
 * @property {Partial<import('../domain/model/nai-params.js').NaiParams>} [params]
 * @property {AbortSignal} [signal]
 */

/**
 * @param {WorkbenchDeps} deps
 * @returns {{
 *   writePrompt: (input: WorkbenchWritePromptInput) => Promise<import('../infra/result.js').Ok<string>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>,
 *   generateImage: (input: WorkbenchGenerateInput) => Promise<import('../infra/result.js').Ok<import('../ports/image-gen.port.js').GeneratedImage[]>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>,
 * }}
 */
export function createWorkbenchService(deps) {
    throw new Error('not implemented: createWorkbenchService');
}
