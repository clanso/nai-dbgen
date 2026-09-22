/**
 * L4 应用层 · 4.14 唯一生图入口（对外 window.NaiDbGen.generate / 用例内部共用）。
 * 不跑四块、不写 slot、不改正文；必填 replaceCharacterKeywords。
 * 归属：W2-F 用例代理实现。W0 仅冻结签名。
 */

import { Ok, Err } from '../infra/result.js';
import { configError } from '../infra/errors.js';
import { assembleNaiPayload } from '../domain/nai/payload-assembler.js';
import {
    abortErrIfNeeded,
    attachTraceId,
    loadAllCharacters,
} from './_helpers.js';

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
    /**
     * @returns {Promise<ArtistString|null>}
     */
    async function getActiveArtist() {
        const settings = deps.loadSettings();
        if (!settings.activeArtistId) {
            return null;
        }
        const r = await deps.artistRepo.get(settings.activeArtistId);
        if (!r.ok || !r.value) {
            return null;
        }
        return r.value;
    }

    return {
        getActiveArtist,

        /**
         * @param {ImageGenRequest} req
         */
        async generate(req) {
            if (!req || typeof req !== 'object') {
                throw new Error('invalid argument: req');
            }
            // 必填、无默认：绝不根据提示词来源推断（验收 #13 / #14）
            if (typeof req.replaceCharacterKeywords !== 'boolean') {
                throw new Error('invalid argument: replaceCharacterKeywords');
            }

            const traceId = req.traceId ?? deps.newTraceId();
            const aborted = abortErrIfNeeded(req.signal, traceId);
            if (aborted) {
                return aborted;
            }

            const settings = deps.loadSettings();
            if (!settings.activeNaiConfigId) {
                return Err(configError({
                    code: 'NAI_CONFIG_UNSET',
                    message: '未选择 NAI API 配置',
                    hint: '请在 NAI API 库中激活一条配置',
                    traceId,
                }));
            }

            const naiCfgR = await deps.naiConfigRepo.get(settings.activeNaiConfigId);
            if (!naiCfgR.ok) {
                return attachTraceId(naiCfgR, traceId);
            }
            if (!naiCfgR.value) {
                return Err(configError({
                    code: 'NAI_CONFIG_MISSING',
                    message: '当前 NAI 配置不存在',
                    hint: '请重新选择 NAI API 配置',
                    traceId,
                    context: { id: settings.activeNaiConfigId },
                }));
            }

            // 画师串三态（D9）
            /** @type {ArtistString|null} */
            let artist = null;
            if (req.artist === undefined) {
                artist = await getActiveArtist();
            } else if (req.artist === null) {
                artist = null;
            } else {
                artist = req.artist;
            }

            /** @type {import('../domain/model/character.js').CharacterGroup[]} */
            let groups = [];
            /** @type {import('../domain/model/character.js').Character[]} */
            let characters = [];
            if (req.replaceCharacterKeywords) {
                if (!deps.characterRepo) {
                    return Err(configError({
                        code: 'CHARACTER_REPO_REQUIRED',
                        message: '替换角色关键字需要角色库',
                        hint: '请检查插件装配是否注入了 characterRepo',
                        traceId,
                    }));
                }
                const bundle = await loadAllCharacters(deps.characterRepo);
                if (!bundle.ok) {
                    return attachTraceId(bundle, traceId);
                }
                groups = bundle.value.groups;
                characters = bundle.value.characters;
            }

            const baseParams = settings.naiParams;
            /** @type {Record<string, unknown>} */
            const overrides = (req.params && typeof req.params === 'object')
                ? { ...req.params }
                : {};

            const payload = assembleNaiPayload({
                caption: req.caption,
                params: baseParams,
                paramOverrides: overrides,
                replaceCharacterKeywords: req.replaceCharacterKeywords,
                artist,
                groups,
                characters,
                matchGlobals: settings.matchDefaults,
            });

            const aborted2 = abortErrIfNeeded(req.signal, traceId);
            if (aborted2) {
                return aborted2;
            }

            const genR = await deps.imageGenPort.generate(payload, {
                signal: req.signal,
                config: naiCfgR.value,
                traceId,
            });
            return attachTraceId(genR, traceId);
        },
    };
}
