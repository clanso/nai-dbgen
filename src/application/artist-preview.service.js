/**
 * L4 应用层 · 画师串手填预览生图（需求 4.2）。
 * 用正在编辑的那一条串 + 手填提示词；预览尺寸用 ARTIST_PREVIEW_SIZE；不写楼。
 * 调用 ImageGenService.generate 时必须传 artist=正在编辑的 ArtistString（裁决 D9），
 * 不得临时改动 PluginSettings.activeArtistId。
 * 归属：W2-F 用例代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {object} ArtistPreviewDeps
 * @property {import('./image-gen.service.js').ImageGenService} imageGen
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/artist.js').ArtistString>} artistRepo
 * @property {import('../ports/repository.port.js').ImageRepository} imageRepo
 */

/**
 * @typedef {object} ArtistPreviewInput
 * @property {string} artistId 正在编辑的画师串（非必须当前激活）
 * @property {string} promptText 用户手填正向提示词
 * @property {string} [negativeText]
 * @property {boolean} [saveAsPreview=true] 是否写回 previewImageRef
 * @property {AbortSignal} [signal]
 */

/**
 * @param {ArtistPreviewDeps} deps
 * @returns {{ preview: (input: ArtistPreviewInput) => Promise<import('../infra/result.js').Ok<{ image: import('../ports/image-gen.port.js').GeneratedImage, imageRef?: string }>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>> }}
 */
export function createArtistPreviewService(deps) {
    throw new Error('not implemented: createArtistPreviewService');
}
