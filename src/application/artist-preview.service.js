/**
 * L4 应用层 · 画师串手填预览生图（需求 4.2）。
 * 用正在编辑的那一条串 + 手填提示词；预览尺寸用 ARTIST_PREVIEW_SIZE；不写楼。
 * 调用 ImageGenService.generate 时必须传 artist=正在编辑的 ArtistString（裁决 D9），
 * 不得临时改动 PluginSettings.activeArtistId。
 * 归属：W2-F 用例代理实现。W0 仅冻结签名。
 */

import { Ok, Err } from '../infra/result.js';
import { configError, domainError } from '../infra/errors.js';
import { ARTIST_PREVIEW_SIZE, emptyNaiCaption } from '../domain/model/nai-params.js';
import { nowIso } from '../infra/clock.js';
import { abortErrIfNeeded } from './_helpers.js';

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
    return {
        /**
         * @param {ArtistPreviewInput} input
         */
        async preview(input) {
            if (!input || typeof input.artistId !== 'string' || !input.artistId) {
                throw new Error('invalid argument: artistId');
            }

            const aborted = abortErrIfNeeded(input.signal);
            if (aborted) {
                return aborted;
            }

            const artistR = await deps.artistRepo.get(input.artistId);
            if (!artistR.ok) {
                return artistR;
            }
            if (!artistR.value) {
                return Err(configError({
                    code: 'ARTIST_NOT_FOUND',
                    message: '找不到该画师串',
                    hint: '请确认条目仍存在',
                    context: { artistId: input.artistId },
                }));
            }

            const artist = artistR.value;
            const caption = emptyNaiCaption();
            caption.v4_prompt.caption.base_caption = String(input.promptText ?? '');
            caption.v4_negative_prompt.caption.base_caption = String(input.negativeText ?? '');

            // 必须传正在编辑的那一条；尺寸只用 ARTIST_PREVIEW_SIZE（禁止魔法数 / 不读 4.13）
            const genR = await deps.imageGen.generate({
                caption,
                replaceCharacterKeywords: false,
                artist,
                params: {
                    width: ARTIST_PREVIEW_SIZE.width,
                    height: ARTIST_PREVIEW_SIZE.height,
                },
                signal: input.signal,
            });
            if (!genR.ok) {
                return genR;
            }
            if (!genR.value.length) {
                return Err(domainError({
                    code: 'ARTIST_PREVIEW_NO_IMAGE',
                    message: '预览生图未返回图片',
                    hint: '请检查 NAI 配置',
                }));
            }

            const image = genR.value[0];
            const saveAsPreview = input.saveAsPreview !== false;

            if (!saveAsPreview) {
                return Ok({ image });
            }

            const putR = await deps.imageRepo.put(image.blob);
            if (!putR.ok) {
                return putR;
            }
            const imageRef = putR.value;

            const updated = {
                ...artist,
                previewImageRef: imageRef,
                updatedAt: nowIso(),
            };
            const saveR = await deps.artistRepo.put(updated);
            if (!saveR.ok) {
                return saveR;
            }

            return Ok({ image, imageRef });
        },
    };
}
