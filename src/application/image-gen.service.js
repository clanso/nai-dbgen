/**
 * L4 应用层 · 4.14 唯一生图入口（对外 window.NaiDbGen.generate / 用例内部共用）。
 * 不跑四块、不写 slot、不改正文；必填 replaceCharacterKeywords。
 * 归属：W2-F 用例代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {import('../domain/model/nai-params.js').NaiCaption} NaiCaption
 * @typedef {import('../domain/model/nai-params.js').NaiParams} NaiParams
 * @typedef {import('../ports/image-gen.port.js').GeneratedImage} GeneratedImage
 */

/**
 * @typedef {object} ImageGenRequest
 * @property {NaiCaption} caption
 * @property {Partial<NaiParams>|Record<string, unknown>} [params] 按次覆盖；多传原生字段原样带上
 * @property {boolean} replaceCharacterKeywords 必填，无默认值
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {object} ImageGenServiceDeps
 * @property {import('../ports/image-gen.port.js').ImageGenPort} imageGenPort
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/artist.js').ArtistString>} artistRepo
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/api-config.js').NaiApiConfig>} naiConfigRepo
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/character.js').Character>} [characterRepo]
 * @property {() => object} loadSettings 读 activeArtistId / activeNaiConfigId / naiParams 等
 * @property {() => string} newTraceId
 */

/**
 * @typedef {object} ImageGenService
 * @property {(req: ImageGenRequest) => Promise<import('../infra/result.js').Ok<GeneratedImage[]>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} generate
 * @property {() => Promise<import('../domain/model/artist.js').ArtistString|null>} getActiveArtist
 */

/**
 * @param {ImageGenServiceDeps} deps
 * @returns {ImageGenService}
 */
export function createImageGenService(deps) {
    throw new Error('not implemented: createImageGenService');
}
