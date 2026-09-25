/**
 * L3 领域层 · 4.14 NAI 请求装配（纯函数，唯一点）。
 * 操作顺序由需求锁死：替换 → 画师串 → 结构开关 → input/negative → 合并参数。
 * 归属：W1-A 领域代理实现。W0 仅冻结签名。
 *
 * 报文字段对齐桌面项目 app/backend.js 的 payload 形状：
 * `{ input, model, parameters: { …采样, negative_prompt, v4_prompt, v4_negative_prompt } }`
 * 另按 NaiRequest typedef 在顶层保留 negative_prompt。
 * 结构开关对齐桌面 4.5：正向 use_coords / use_order，负向只写 legacy_uc，
 * parameters 顶层再写一份 use_coords。负向 char_captions 补上与正向同序号的 centers。
 * SMEA(sm/sm_dyn)：4.5 / V5 模型不写入（需求 4.13）。
 */

import { FIXED_STRUCTURE } from '../model/nai-params.js';
import { prefixArtist } from './artist-prefix.js';
import { expandNaiParamFields } from './param-options.js';
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
    'model',
]);

/** NovelAI 只收 0–4294967295。-1 表示这次另抽一颗。 */
function resolveRequestSeed(seed) {
    const n = Number(seed);
    if (Number.isInteger(n) && n >= 0 && n <= 4294967295) {
        return n;
    }
    return Math.floor(Math.random() * 4294967295);
}

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
    // 4.13：成对字段展开 + Variety 按尺寸计算（参数合法性由 UI / mergeNaiParamsForGenerate 先保证）
    const expanded = expandNaiParamFields({ ...input.params, ...overrides });
    const model = String(expanded.model ?? '');

    // 4. 结构开关 + caption
    const posChars = cloneCharCaptions(caption.v4_prompt.caption.char_captions);
    const negChars = pairNegativeCharCaptions(
        posChars,
        cloneCharCaptions(caption.v4_negative_prompt.caption.char_captions),
    );
    const useCoords = posChars.length > 0;
    const v4Prompt = {
        caption: {
            base_caption: posBase,
            char_captions: posChars,
        },
        use_coords: useCoords,
        use_order: FIXED_STRUCTURE.v4_prompt.use_order,
    };
    const v4Negative = {
        caption: {
            base_caption: negBase,
            char_captions: negChars,
        },
        ...FIXED_STRUCTURE.v4_negative_prompt,
    };

    /** @type {Record<string, unknown>} */
    const parameters = {
        params_version: 4,
        width: Number(expanded.width) || 0,
        height: Number(expanded.height) || 0,
        scale: Number(expanded.scale) || 0,
        sampler: String(expanded.sampler ?? ''),
        steps: Number(expanded.steps) || 0,
        n_samples: 1,
        seed: resolveRequestSeed(expanded.seed),
        noise_schedule: String(expanded.noise_schedule ?? ''),
        cfg_rescale: Number(expanded.cfg_rescale) || 0,
        skip_cfg_above_sigma: expanded.skip_cfg_above_sigma == null
            ? null
            : Number(expanded.skip_cfg_above_sigma),
        image_format: expanded.image_format === 'webp' ? 'webp' : 'png',
        qualityToggle: expanded.qualityToggle === true,
        tag_hint_qt: expanded.tag_hint_qt === true,
        ucPreset: Number(expanded.ucPreset) || 0,
        tag_hint_uc_preset: expanded.tag_hint_uc_preset === true,
        straight_alpha: expanded.straight_alpha === true,
        tag_hint_transparent_background: expanded.tag_hint_transparent_background === true,
        negative_prompt: negBase,
        use_coords: useCoords,
        v4_prompt: v4Prompt,
        v4_negative_prompt: v4Negative,
    };

    if (Object.prototype.hasOwnProperty.call(expanded, 'sm')) {
        parameters.sm = expanded.sm === true;
        parameters.sm_dyn = expanded.sm_dyn === true;
    }

    // 6. 调用方多传的原生字段原样带上（不覆盖已写死的 v4 结构 / 已校验采样字段）
    const guarded = new Set([
        'v4_prompt',
        'v4_negative_prompt',
        'negative_prompt',
        'n_samples',
        'width',
        'height',
        'scale',
        'sampler',
        'steps',
        'seed',
        'noise_schedule',
        'cfg_rescale',
        'skip_cfg_above_sigma',
        'image_format',
        'qualityToggle',
        'tag_hint_qt',
        'ucPreset',
        'tag_hint_uc_preset',
        'straight_alpha',
        'tag_hint_transparent_background',
        'sm',
        'sm_dyn',
        'model',
        'schemaVersion',
        'seedRandom',
    ]);
    /** @type {Record<string, unknown>} */
    const extra = {};
    for (const [key, value] of Object.entries(overrides)) {
        if (META_PARAM_KEYS.has(key) || guarded.has(key)) {
            continue;
        }
        parameters[key] = value;
        extra[key] = value;
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
/**
 * 负向角色与正向同序号。负向没写 centers 时抄正向的。
 * @param {import('../model/nai-params.js').CharCaption[]} posChars
 * @param {import('../model/nai-params.js').CharCaption[]} negChars
 */
function pairNegativeCharCaptions(posChars, negChars) {
    const count = Math.max(posChars.length, negChars.length);
    /** @type {import('../model/nai-params.js').CharCaption[]} */
    const out = [];
    for (let i = 0; i < count; i += 1) {
        const neg = negChars[i] ?? { char_caption: '' };
        const pos = posChars[i];
        /** @type {import('../model/nai-params.js').CharCaption} */
        const item = { char_caption: neg.char_caption };
        const centers = (Array.isArray(neg.centers) && neg.centers.length > 0)
            ? neg.centers
            : pos?.centers;
        if (Array.isArray(centers) && centers.length > 0) {
            item.centers = centers.map((p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 }));
        }
        out.push(item);
    }
    return out;
}

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
