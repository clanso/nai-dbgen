/**
 * L3 领域模型 · 4.13 生图参数 + 五个结构开关常量（架构文档 §5.4）。
 * FIXED_STRUCTURE 唯一定义点；不给用户改、不按张改。
 * 归属：W0 契约冻结。
 */

import {
    isFiniteNumber,
    isIntInRange,
    isNonEmptyString,
    isPlainObject,
    requireArg,
    validationErr,
    validationOk,
} from '../../infra/validate.js';

export const NAI_PARAMS_SCHEMA_VERSION = 1;

/**
 * 程序写死的五个结构开关（需求步骤 5）。
 */
export const FIXED_STRUCTURE = Object.freeze({
    v4_prompt: Object.freeze({ use_coords: true, use_order: true }),
    v4_negative_prompt: Object.freeze({
        use_coords: false,
        use_order: true,
        legacy_uc: false,
    }),
});

/**
 * 画师串预览全库写死尺寸（需求 4.2 / 4.13：不读用户宽高）。
 * 像素值从现有桌面项目常用预览尺寸取，W0 冻结为常量。
 */
export const ARTIST_PREVIEW_SIZE = Object.freeze({
    width: 512,
    height: 768,
});

/**
 * 质量词注入策略（架构文档 §0' #3 / §6.6 / R-04）。
 * @typedef {'field'|'caption'} QualityInjectionStrategy
 */

/**
 * @typedef {object} CharCaption
 * @property {string} char_caption
 * @property {Array<{x: number, y: number}>} [centers]
 */

/**
 * @typedef {object} CaptionBody
 * @property {string} base_caption
 * @property {CharCaption[]} char_captions
 */

/**
 * LLM 产出的「生图内容」caption（不含结构开关、不含 input/negative_prompt）。
 * @typedef {object} NaiCaption
 * @property {{ caption: CaptionBody }} v4_prompt
 * @property {{ caption: CaptionBody }} v4_negative_prompt
 */

/**
 * 4.13 固定参数集（楼层 slot 出图默认值；工作台/外部可按次覆盖）。
 * @typedef {object} NaiParams
 * @property {number} schemaVersion
 * @property {string} model
 * @property {number} width
 * @property {number} height
 * @property {number} steps
 * @property {number} scale
 * @property {string} sampler
 * @property {string} noise_schedule
 * @property {number} seed
 * @property {boolean} seedRandom 每次出图随机
 * @property {number} n_samples 固定 1
 * @property {'png'|'webp'} image_format
 * @property {boolean} qualityToggle
 * @property {boolean} tag_hint_qt
 * @property {number} ucPreset
 * @property {boolean} tag_hint_uc_preset
 * @property {number} cfg_rescale
 * @property {number|null} skip_cfg_above_sigma Variety；null 表示关闭
 * @property {boolean} sm SMEA；仅旧模型发送
 * @property {boolean} sm_dyn
 * @property {boolean} straight_alpha
 * @property {boolean} tag_hint_transparent_background
 * @property {QualityInjectionStrategy} qualityStrategy
 */

/**
 * 发给 ImageGenPort 的完整请求体（装配后）。
 * @typedef {object} NaiRequest
 * @property {string} input
 * @property {string} negative_prompt
 * @property {object} parameters 含 v4_prompt / v4_negative_prompt 与采样字段
 * @property {string} [model]
 * @property {Record<string, unknown>} [extra] 调用方多传的 NAI 原生字段
 */

/**
 * @returns {NaiParams}
 */
export function defaultNaiParams() {
    return {
        schemaVersion: NAI_PARAMS_SCHEMA_VERSION,
        model: 'nai-diffusion-4-5-full',
        width: 832,
        height: 1216,
        steps: 28,
        scale: 5,
        sampler: 'k_euler_ancestral',
        noise_schedule: 'karras',
        seed: 0,
        seedRandom: true,
        n_samples: 1,
        image_format: 'png',
        qualityToggle: true,
        tag_hint_qt: true,
        ucPreset: 0,
        tag_hint_uc_preset: true,
        cfg_rescale: 0,
        skip_cfg_above_sigma: null,
        sm: false,
        sm_dyn: false,
        straight_alpha: false,
        tag_hint_transparent_background: false,
        qualityStrategy: 'field',
    };
}

/**
 * @param {object} input
 * @param {{ now?: string }} [_deps] 保留签名一致；参数集无 id
 * @returns {NaiParams}
 */
export function createNaiParams(input, _deps) {
    requireArg(isPlainObject(input), 'input');
    return normalizeNaiParams({ ...defaultNaiParams(), ...input });
}

/**
 * @param {Record<string, unknown>} obj
 * @returns {NaiParams}
 */
export function normalizeNaiParams(obj) {
    const base = defaultNaiParams();
    return {
        schemaVersion: Number(obj.schemaVersion) || NAI_PARAMS_SCHEMA_VERSION,
        model: isNonEmptyString(obj.model) ? String(obj.model) : base.model,
        width: pickInt(obj.width, base.width),
        height: pickInt(obj.height, base.height),
        steps: pickInt(obj.steps, base.steps),
        scale: isFiniteNumber(obj.scale) ? Number(obj.scale) : base.scale,
        sampler: isNonEmptyString(obj.sampler) ? String(obj.sampler) : base.sampler,
        noise_schedule: isNonEmptyString(obj.noise_schedule)
            ? String(obj.noise_schedule)
            : base.noise_schedule,
        seed: pickInt(obj.seed, base.seed),
        seedRandom: obj.seedRandom !== false,
        n_samples: 1,
        image_format: obj.image_format === 'webp' ? 'webp' : 'png',
        qualityToggle: obj.qualityToggle !== false,
        tag_hint_qt: obj.tag_hint_qt !== false,
        ucPreset: pickInt(obj.ucPreset, base.ucPreset),
        tag_hint_uc_preset: obj.tag_hint_uc_preset !== false,
        cfg_rescale: isFiniteNumber(obj.cfg_rescale) ? Number(obj.cfg_rescale) : base.cfg_rescale,
        skip_cfg_above_sigma: obj.skip_cfg_above_sigma == null
            ? null
            : (isFiniteNumber(obj.skip_cfg_above_sigma) ? Number(obj.skip_cfg_above_sigma) : null),
        sm: obj.sm === true,
        sm_dyn: obj.sm_dyn === true,
        straight_alpha: obj.straight_alpha === true,
        tag_hint_transparent_background: obj.tag_hint_transparent_background === true,
        qualityStrategy: obj.qualityStrategy === 'caption' ? 'caption' : 'field',
    };
}

/**
 * @param {unknown} v
 * @param {number} fallback
 * @returns {number}
 */
function pickInt(v, fallback) {
    return typeof v === 'number' && Number.isInteger(v) ? v : fallback;
}

/**
 * @param {unknown} obj
 * @returns {{ ok: true, value: NaiParams } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function validateNaiParams(obj) {
    if (!isPlainObject(obj)) {
        return validationErr('NAI_PARAMS_SHAPE', '生图参数格式无效');
    }
    const n = normalizeNaiParams(obj);
    if (!isNonEmptyString(n.model)) {
        return validationErr('NAI_PARAMS_MODEL', '请选择生图模型');
    }
    if (!isIntInRange(n.width, 64, 4096) || !isIntInRange(n.height, 64, 4096)) {
        return validationErr('NAI_PARAMS_SIZE', '宽高超出允许范围');
    }
    if (!isIntInRange(n.steps, 1, 50)) {
        return validationErr('NAI_PARAMS_STEPS', '步数必须在 1–50');
    }
    return validationOk(n);
}

/**
 * 空 caption 骨架（无角色时 char_captions 为空数组）。
 * @returns {NaiCaption}
 */
export function emptyNaiCaption() {
    return {
        v4_prompt: {
            caption: { base_caption: '', char_captions: [] },
        },
        v4_negative_prompt: {
            caption: { base_caption: '', char_captions: [] },
        },
    };
}

/**
 * @param {unknown} obj
 * @returns {{ ok: true, value: NaiCaption } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function validateNaiCaption(obj) {
    if (!isPlainObject(obj)) {
        return validationErr('NAI_CAPTION_SHAPE', '生图内容格式无效');
    }
    const pos = obj.v4_prompt;
    const neg = obj.v4_negative_prompt;
    if (!isPlainObject(pos) || !isPlainObject(pos.caption)) {
        return validationErr('NAI_CAPTION_POS', '缺少 v4_prompt.caption');
    }
    if (!isPlainObject(neg) || !isPlainObject(neg.caption)) {
        return validationErr('NAI_CAPTION_NEG', '缺少 v4_negative_prompt.caption');
    }
    return validationOk(/** @type {NaiCaption} */ ({
        v4_prompt: {
            caption: {
                base_caption: String(pos.caption.base_caption ?? ''),
                char_captions: normalizeCharCaptions(pos.caption.char_captions),
            },
        },
        v4_negative_prompt: {
            caption: {
                base_caption: String(neg.caption.base_caption ?? ''),
                char_captions: normalizeCharCaptions(neg.caption.char_captions),
            },
        },
    }));
}

/**
 * @param {unknown} raw
 * @returns {CharCaption[]}
 */
function normalizeCharCaptions(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.filter((c) => isPlainObject(c)).map((c) => {
        /** @type {CharCaption} */
        const item = { char_caption: String(c.char_caption ?? '') };
        if (Array.isArray(c.centers)) {
            item.centers = c.centers
                .filter((p) => isPlainObject(p))
                .map((p) => ({
                    x: isFiniteNumber(p.x) ? Number(p.x) : 0,
                    y: isFiniteNumber(p.y) ? Number(p.y) : 0,
                }));
        }
        return item;
    });
}

/**
 * @param {object} obj
 * @param {number} fromVersion
 * @returns {{ ok: true, value: NaiParams } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function migrateNaiParams(obj, fromVersion) {
    requireArg(isPlainObject(obj), 'obj');
    return validateNaiParams({
        ...obj,
        schemaVersion: NAI_PARAMS_SCHEMA_VERSION,
    });
}
