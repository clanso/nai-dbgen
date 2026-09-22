/**
 * L3 领域层 · 4.14 NAI 请求装配（纯函数，唯一点）。
 * 操作顺序由需求锁死：替换 → 画师串 → 结构开关 → input/negative → 合并参数。
 * 归属：W1-A 领域代理实现。W0 仅冻结签名。
 *
 * 报文字段对齐桌面项目 app/backend.js 的 payload 形状：
 * `{ input, model, parameters: { …采样, negative_prompt, v4_prompt, v4_negative_prompt } }`
 * 另按 NaiRequest typedef 在顶层保留 negative_prompt。
 * 结构开关取 FIXED_STRUCTURE（需求步骤 5），负向含 use_coords:false / use_order / legacy_uc
 * （桌面负向仅写了 legacy_uc，本插件按需求补全）。
 * SMEA(sm/sm_dyn)：4.5 / V5 模型不写入（需求 4.13）。
 */

import { FIXED_STRUCTURE } from '../model/nai-params.js';
import { prefixArtist } from './artist-prefix.js';
import { substituteCharacterKeywords } from './keyword-substitution.js';

/**
 * @typedef {import('../model/nai-params.js').NaiCaption} NaiCaption
 * @typedef {import('../model/nai-params.js').NaiParams} NaiParams
 * @typedef {import('../model/nai-params.js').NaiRequest} NaiRequest
 * @typedef {import('../model/artist.js').ArtistString} ArtistString
 * @typedef {import('../model/character.js').Character} Character
 * @typedef {import('../model/character.js').CharacterGroup} CharacterGroup
 * @typedef {import('../matching/activation.js').ActivationGlobals} ActivationGlobals
 */

/**
 * @typedef {object} AssembleInput
 * @property {NaiCaption} caption 调用方原文
 * @property {NaiParams} params 4.13 默认；可被 overrides 覆盖
 * @property {Record<string, unknown>} [paramOverrides] 按次覆盖 + 多传原生字段
 * @property {boolean} replaceCharacterKeywords 必填，无默认
 * @property {ArtistString|null} artist 已由调用方按 ImageGenRequest 三态解析后的画师串；null=不拼
 * @property {CharacterGroup[]} [groups] 替换开关为开时需要
 * @property {Character[]} [characters]
 * @property {ActivationGlobals} [matchGlobals]
 */

/** 不进入 NAI parameters 的插件侧元字段 */
const META_PARAM_KEYS = new Set([
    'schemaVersion',
    'seedRandom',
    'qualityStrategy',
    'model',
]);

/**
 * @param {AssembleInput} input
 * @returns {NaiRequest}
 */
export function assembleNaiPayload(input) {
    if (!input || typeof input !== 'object') {
        throw new Error('invalid argument: input');
    }
    if (typeof input.replaceCharacterKeywords !== 'boolean') {
        throw new Error('invalid argument: replaceCharacterKeywords');
    }
    if (!input.caption || typeof input.caption !== 'object') {
        throw new Error('invalid argument: caption');
    }
    if (!input.params || typeof input.params !== 'object') {
        throw new Error('invalid argument: params');
    }

    // 1–2. 可选关键字替换（显式布尔；绝不根据提示词内容推断）
    let caption = cloneCaptionShallow(input.caption);
    if (input.replaceCharacterKeywords) {
        caption = substituteCharacterKeywords(
            caption,
            input.groups ?? [],
            input.characters ?? [],
            input.matchGlobals ?? { caseSensitive: false, matchWholeWords: false },
        );
    }

    // 3. 画师串（替换之后）
    caption = prefixArtist(caption, input.artist ?? null);

    const posBase = String(caption.v4_prompt.caption.base_caption ?? '');
    const negBase = String(caption.v4_negative_prompt.caption.base_caption ?? '');

    const overrides = (input.paramOverrides && typeof input.paramOverrides === 'object')
        ? { ...input.paramOverrides }
        : {};
    const merged = { ...input.params, ...overrides };

    // 4. 结构开关 + caption
    const v4Prompt = {
        caption: {
            base_caption: posBase,
            char_captions: cloneCharCaptions(caption.v4_prompt.caption.char_captions),
        },
        ...FIXED_STRUCTURE.v4_prompt,
    };
    const v4Negative = {
        caption: {
            base_caption: negBase,
            char_captions: cloneCharCaptions(caption.v4_negative_prompt.caption.char_captions),
        },
        ...FIXED_STRUCTURE.v4_negative_prompt,
    };

    const model = String(merged.model ?? input.params.model ?? '');
    const qualityStrategy = merged.qualityStrategy === 'caption' ? 'caption' : 'field';

    /** @type {Record<string, unknown>} */
    const parameters = {
        width: Number(merged.width) || 0,
        height: Number(merged.height) || 0,
        scale: Number(merged.scale) || 0,
        sampler: String(merged.sampler ?? ''),
        steps: Number(merged.steps) || 0,
        n_samples: 1,
        seed: Number(merged.seed) || 0,
        noise_schedule: String(merged.noise_schedule ?? ''),
        cfg_rescale: Number(merged.cfg_rescale) || 0,
        skip_cfg_above_sigma: merged.skip_cfg_above_sigma == null
            ? null
            : Number(merged.skip_cfg_above_sigma),
        image_format: merged.image_format === 'webp' ? 'webp' : 'png',
        negative_prompt: negBase,
        v4_prompt: v4Prompt,
        v4_negative_prompt: v4Negative,
    };

    if (qualityStrategy === 'field') {
        parameters.qualityToggle = merged.qualityToggle !== false;
        parameters.tag_hint_qt = merged.tag_hint_qt !== false;
        parameters.ucPreset = Number(merged.ucPreset) || 0;
        parameters.tag_hint_uc_preset = merged.tag_hint_uc_preset !== false;
    } else {
        // caption 策略：不发官方质量/UC 字段（文本注入由调用方自行处理）
        parameters.qualityToggle = false;
        parameters.tag_hint_qt = false;
        parameters.ucPreset = 0;
        parameters.tag_hint_uc_preset = false;
    }

    parameters.straight_alpha = merged.straight_alpha === true;
    parameters.tag_hint_transparent_background =
        merged.tag_hint_transparent_background === true;

    // SMEA：仅旧模型（需求 4.13；桌面 4.5/V5 分支不带 sm）
    if (!isModernNaiModel(model)) {
        parameters.sm = merged.sm === true;
        parameters.sm_dyn = merged.sm_dyn === true;
    }

    // 6. 调用方多传的原生字段原样带上（不覆盖已写死的 v4 结构）
    /** @type {Record<string, unknown>} */
    const extra = {};
    for (const [key, value] of Object.entries(overrides)) {
        if (META_PARAM_KEYS.has(key)) {
            continue;
        }
        if (key === 'v4_prompt' || key === 'v4_negative_prompt') {
            continue;
        }
        if (!(key in parameters) || Object.prototype.hasOwnProperty.call(overrides, key)) {
            if (key in parameters && ['v4_prompt', 'v4_negative_prompt', 'negative_prompt', 'n_samples'].includes(key)) {
                continue;
            }
            if (!(key in parameters)) {
                parameters[key] = value;
                extra[key] = value;
            } else if (![
                'v4_prompt',
                'v4_negative_prompt',
                'negative_prompt',
                'n_samples',
            ].includes(key)) {
                parameters[key] = value;
            }
        }
    }

    /** @type {NaiRequest} */
    const request = {
        input: posBase,
        negative_prompt: negBase,
        model,
        parameters,
    };
    if (Object.keys(extra).length > 0) {
        request.extra = extra;
    }
    return request;
}

/**
 * 4.5 / V5 不发 SMEA（需求 4.13）。
 * @param {string} model
 * @returns {boolean}
 */
function isModernNaiModel(model) {
    const m = String(model).toLowerCase();
    return m.includes('4-5')
        || m.includes('nai-diffusion-5')
        || m.includes('diffusion-5')
        || /(?:^|[^0-9])5(?:-full|-curated)?(?:$|[^0-9])/.test(m);
}

/**
 * @param {NaiCaption} caption
 * @returns {NaiCaption}
 */
function cloneCaptionShallow(caption) {
    return {
        v4_prompt: {
            caption: {
                base_caption: String(caption.v4_prompt?.caption?.base_caption ?? ''),
                char_captions: cloneCharCaptions(caption.v4_prompt?.caption?.char_captions),
            },
        },
        v4_negative_prompt: {
            caption: {
                base_caption: String(caption.v4_negative_prompt?.caption?.base_caption ?? ''),
                char_captions: cloneCharCaptions(caption.v4_negative_prompt?.caption?.char_captions),
            },
        },
    };
}

/**
 * @param {unknown} raw
 * @returns {import('../model/nai-params.js').CharCaption[]}
 */
function cloneCharCaptions(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.map((c) => {
        /** @type {import('../model/nai-params.js').CharCaption} */
        const item = { char_caption: String(c?.char_caption ?? '') };
        if (Array.isArray(c?.centers)) {
            item.centers = c.centers.map((p) => ({
                x: Number(p?.x) || 0,
                y: Number(p?.y) || 0,
            }));
        }
        return item;
    });
}
