/**
 * L4 应用层 · 4.14 唯一生图入口（对外 window.NaiDbGen.generate / 用例内部共用）。
 * 不跑四块、不写 slot、不改正文；必填 replaceCharacterKeywords。
 * 归属：W2-F 用例代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {import('../domain/model/nai-params.js').NaiCaption} NaiCaption
 * @typedef {import('../domain/model/nai-params.js').NaiParams} NaiParams
 * @typedef {import('../domain/model/artist.js').ArtistString} ArtistString
 * @typedef {import('../ports/image-gen.port.js').GeneratedImage} GeneratedImage
 * @typedef {import('../domain/model/plugin-settings.js').PluginSettings} PluginSettings
 */

/**
 * @typedef {object} ImageGenRequest
 * @property {NaiCaption} caption
 * @property {Partial<NaiParams>|Record<string, unknown>} [params] 按次覆盖；多传原生字段原样带上
 * @property {boolean} replaceCharacterKeywords 必填，无默认值
 * @property {ArtistString|null|undefined} [artist]
 *   画师串三态（裁决 D9），必须按此语义实现，禁止另解：
 *   - `undefined`（缺省）：使用 PluginSettings.activeArtistId 对应的当前激活串
 *   - `null`：不拼接任何画师串
 *   - `ArtistString` 对象：用该对象覆盖（需求 4.2 手填预览须传「正在编辑的那一条」）
 * @property {AbortSignal} [signal]
 * @property {string} [traceId] 出图链路 trace；缺省由服务生成
 */

/**
 * @typedef {object} ImageGenServiceDeps
 * @property {import('../ports/image-gen.port.js').ImageGenPort} imageGenPort
 * @property {import('../ports/repository.port.js').Repository<ArtistString>} artistRepo
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/api-config.js').NaiApiConfig>} naiConfigRepo
 * @property {import('../ports/repository.port.js').CharacterRepository} [characterRepo]
 * @property {() => PluginSettings} loadSettings
 * @property {() => string} newTraceId
 */

/**
 * @typedef {object} ImageGenService
 * @property {(req: ImageGenRequest) => Promise<import('../infra/result.js').Ok<GeneratedImage[]>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} generate
 * @property {() => Promise<ArtistString|null>} getActiveArtist
 */

/**
 * @param {ImageGenServiceDeps} deps
 * @returns {ImageGenService}
 */
export function createImageGenService(deps) {
    throw new Error('not implemented: createImageGenService');
}
