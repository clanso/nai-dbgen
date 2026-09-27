/**
 * L5 UI · 生成工作台纯逻辑（可单测）。
 * 写提示词 / 出图解耦；replaceCharacterKeywords 只来自显式开关。
 */

import {
    defaultNaiParams,
    emptyNaiCaption,
    normalizeNaiParams,
    validateNaiCaption,
} from '../../domain/model/nai-params.js';
import {
    UC_PRESET_NONE,
    coerceNaiParams,
    computeVarietySigma,
    supportsVariety,
} from '../../domain/nai/param-options.js';
import { safeImageUrl } from '../common/safe-url.js';
import { findMatchingArtist } from '../common/prompt-text.js';

/** NAI V4 多角色上限（与桌面项目一致）。 */
export const WORKBENCH_MAX_CHARACTERS = 4;

/**
 * @typedef {import('../../domain/model/nai-params.js').NaiCaption} NaiCaption
 * @typedef {import('../../domain/model/nai-params.js').NaiParams} NaiParams
 * @typedef {import('../../domain/model/nai-params.js').CharCaption} CharCaption
 */

/**
 * 深拷贝 NaiCaption；结构字段原样保留，绝不拍平成单字符串。
 * @param {unknown} caption
 * @returns {NaiCaption}
 */
export function cloneCaption(caption) {
    const validated = validateNaiCaption(caption ?? emptyNaiCaption());
    if (!validated.ok) {
        return emptyNaiCaption();
    }
    const c = validated.value;
    return {
        v4_prompt: {
            caption: {
                base_caption: c.v4_prompt.caption.base_caption,
                char_captions: c.v4_prompt.caption.char_captions.map(cloneChar),
            },
        },
        v4_negative_prompt: {
            caption: {
                base_caption: c.v4_negative_prompt.caption.base_caption,
                char_captions: c.v4_negative_prompt.caption.char_captions.map(cloneChar),
            },
        },
    };
}

/**
 * @param {CharCaption} c
 * @returns {CharCaption}
 */
function cloneChar(c) {
    /** @type {CharCaption} */
    const out = { char_caption: String(c.char_caption ?? '') };
    if (Array.isArray(c.centers)) {
        out.centers = c.centers.map((p) => ({
            x: Number(p.x) || 0,
            y: Number(p.y) || 0,
        }));
    }
    return out;
}

/**
 * 编辑器状态结构（正负 base + 对齐的角色列表），往返不丢信息。
 * @typedef {object} CaptionEditorState
 * @property {string} posBase
 * @property {string} negBase
 * @property {Array<{ positive: string, negative: string, x: number, y: number }>} characters
 */

/**
 * NaiCaption → 编辑器状态（保留多角色与 centers）。
 * @param {unknown} caption
 * @returns {CaptionEditorState}
 */
export function captionToEditorState(caption) {
    const c = cloneCaption(caption);
    const posChars = c.v4_prompt.caption.char_captions;
    const negChars = c.v4_negative_prompt.caption.char_captions;
    const len = Math.max(posChars.length, negChars.length);
    /** @type {CaptionEditorState['characters']} */
    const characters = [];
    for (let i = 0; i < len; i += 1) {
        const pos = posChars[i];
        const neg = negChars[i];
        const center = pos?.centers?.[0] || neg?.centers?.[0] || { x: 0.5, y: 0.5 };
        characters.push({
            positive: pos ? String(pos.char_caption ?? '') : '',
            negative: neg ? String(neg.char_caption ?? '') : '',
            x: Number(center.x) || 0,
            y: Number(center.y) || 0,
        });
    }
    return {
        posBase: c.v4_prompt.caption.base_caption,
        negBase: c.v4_negative_prompt.caption.base_caption,
        characters,
    };
}

/**
 * 编辑器状态 → NaiCaption（结构重建，不经自由文本解析）。
 * @param {CaptionEditorState} state
 * @returns {NaiCaption}
 */
export function editorStateToCaption(state) {
    const characters = Array.isArray(state?.characters) ? state.characters : [];
    /** @type {CharCaption[]} */
    const posChars = [];
    /** @type {CharCaption[]} */
    const negChars = [];
    for (const row of characters) {
        const x = Number(row?.x);
        const y = Number(row?.y);
        const pointList = [{
            x: Number.isFinite(x) ? x : 0.5,
            y: Number.isFinite(y) ? y : 0.5,
        }];
        /** @type {CharCaption} */
        const posItem = { char_caption: String(row?.positive ?? '') };
        posItem.centers = pointList.map((p) => ({ ...p }));
        /** @type {CharCaption} */
        const negItem = { char_caption: String(row?.negative ?? '') };
        negItem.centers = pointList.map((p) => ({ ...p }));
        posChars.push(posItem);
        negChars.push(negItem);
    }
    return {
        v4_prompt: {
            caption: {
                base_caption: String(state?.posBase ?? ''),
                char_captions: posChars,
            },
        },
        v4_negative_prompt: {
            caption: {
                base_caption: String(state?.negBase ?? ''),
                char_captions: negChars,
            },
        },
    };
}

/**
 * 结构往返：NaiCaption → editor state → NaiCaption，信息不丢。
 * @param {unknown} caption
 * @returns {NaiCaption}
 */
export function roundTripCaption(caption) {
    return editorStateToCaption(captionToEditorState(caption));
}

/**
 * 工作台有独立控件的 4.13 键（与 assembleWorkbenchNaiParams / 页面控件一一对应）。
 * 领域层 defaultNaiParams 新增键时，覆盖度测例会失败，提醒补控件或进 FIXED 白名单。
 * @type {readonly string[]}
 */
export const WORKBENCH_EDITABLE_NAI_KEYS = Object.freeze([
    'model',
    'width',
    'height',
    'steps',
    'scale',
    'sampler',
    'noise_schedule',
    'seed',
    'image_format',
    'qualityToggle',
    'tag_hint_qt',
    'ucPreset',
    'tag_hint_uc_preset',
    'cfg_rescale',
    'skip_cfg_above_sigma',
    'sm',
    'sm_dyn',
    'straight_alpha',
    'tag_hint_transparent_background',
]);

/**
 * 故意不提供自由改控件的 domain 键 → 理由。
 * @type {Readonly<Record<string, string>>}
 */
export const WORKBENCH_FIXED_NAI_KEYS = Object.freeze({
    schemaVersion: '版本元数据，随默认写入，不提供改控件',
    n_samples: '每次固定出一张，不提供改张数',
});

/**
 * @returns {string[]} domain 有、但既不在可改列表也不在 FIXED 白名单的键
 */
export function uncoveredNaiParamKeys() {
    const domainKeys = Object.keys(defaultNaiParams());
    const editable = new Set(WORKBENCH_EDITABLE_NAI_KEYS);
    const fixed = new Set(Object.keys(WORKBENCH_FIXED_NAI_KEYS));
    return domainKeys.filter((k) => !editable.has(k) && !fixed.has(k));
}

/**
 * 从设置取本次出图参数默认值（禁止魔法数，一律走 domain）。
 * @param {object} [settings]
 * @returns {NaiParams}
 */
export function resolveSessionParams(settings) {
    const base = defaultNaiParams();
    const fromSettings = settings && typeof settings === 'object'
        ? /** @type {Record<string, unknown>} */ (settings).naiParams
        : null;
    if (fromSettings && typeof fromSettings === 'object') {
        return normalizeNaiParams({ ...base, ...fromSettings });
    }
    return normalizeNaiParams(base);
}

/**
 * 把页面表单值收成一次出图用的 NaiParams（D47）。
 * Variety：关 → null；开 → 按宽高用 app wM 公式计算（不信任手填）。
 * 成对字段与模型能力由 coerceNaiParams 收口。
 *
 * @param {NaiParams|object} base resolveSessionParams 结果
 * @param {object} form 控件当前值
 * @returns {NaiParams}
 */
export function assembleWorkbenchNaiParams(base, form) {
    const defaults = defaultNaiParams();
    const b = base && typeof base === 'object' ? base : defaults;
    const f = form && typeof form === 'object' ? form : {};
    const model = f.model != null ? String(f.model) : b.model;
    const width = f.width != null ? Number(f.width) : b.width;
    const height = f.height != null ? Number(f.height) : b.height;
    const varietyOn = f.varietyEnabled === true;
    const quality = f.qualityToggle != null
        ? f.qualityToggle !== false
        : (f.tag_hint_qt != null ? f.tag_hint_qt !== false : true);
    const uc = f.ucPreset != null ? Number(f.ucPreset) : b.ucPreset;
    const transparentOn = f.straight_alpha === true
        || f.tag_hint_transparent_background === true;
    const skipCfg = varietyOn && supportsVariety(model)
        ? computeVarietySigma(width, height, model)
        : null;

    return coerceNaiParams(normalizeNaiParams({
        ...b,
        model,
        width,
        height,
        steps: f.steps != null ? Number(f.steps) : b.steps,
        scale: f.scale != null ? Number(f.scale) : b.scale,
        sampler: f.sampler != null ? String(f.sampler) : b.sampler,
        noise_schedule: f.noise_schedule != null ? String(f.noise_schedule) : b.noise_schedule,
        seed: f.seed != null ? Number(f.seed) : b.seed,
        image_format: f.image_format === 'webp' ? 'webp' : 'png',
        qualityToggle: quality,
        tag_hint_qt: quality,
        ucPreset: uc,
        tag_hint_uc_preset: f.tag_hint_uc_preset != null
            ? f.tag_hint_uc_preset !== false
            : uc !== UC_PRESET_NONE,
        cfg_rescale: f.cfg_rescale != null ? Number(f.cfg_rescale) : b.cfg_rescale,
        skip_cfg_above_sigma: skipCfg,
        sm: f.sm === true,
        sm_dyn: f.sm_dyn === true,
        straight_alpha: transparentOn,
        tag_hint_transparent_background: transparentOn,
        n_samples: defaults.n_samples,
        schemaVersion: defaults.schemaVersion,
    }));
}

/**
 * 组装 writePrompt 入参。本函数绝不碰 imageGen / generateImage。
 * @param {object} opts
 * @param {string} opts.naturalLanguage
 * @param {string[]} [opts.libraryIds]
 * @param {string[]} [opts.entryIds] 本次勾选的条目。传入后只发送这些条目
 * @param {'entries'|'floor'} [opts.mode] entries=勾选条目；floor=楼内召回后交给生图预设
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.traceId]
 */
export function buildWritePromptInput(opts) {
    return {
        naturalLanguage: String(opts?.naturalLanguage ?? ''),
        libraryIds: Array.isArray(opts?.libraryIds)
            ? opts.libraryIds.map((id) => String(id))
            : [],
        entryIds: Array.isArray(opts?.entryIds)
            ? opts.entryIds.map((id) => String(id))
            : undefined,
        mode: opts?.mode === 'floor' ? 'floor' : 'entries',
        signal: opts?.signal,
        traceId: opts?.traceId,
    };
}

/**
 * 组装 generateImage 入参。
 *
 * **硬约束**：`replaceCharacterKeywords` 必须是调用方传入的 boolean。
 * 本函数签名不含 promptSource / wasAutoGenerated / isHandEdited 等字段，
 * 程序在类型层面就不可能根据提示词来源推断这一档。
 *
 * @param {object} opts
 * @param {NaiCaption} opts.caption
 * @param {boolean} opts.replaceCharacterKeywords 仅来自页面开关
 * @param {Partial<NaiParams>} [opts.params]
 * @param {import('../../domain/model/artist.js').ArtistString|null|undefined} [opts.artist]
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.traceId]
 */
export function buildGenerateImageInput(opts) {
    if (typeof opts?.replaceCharacterKeywords !== 'boolean') {
        throw new Error('replaceCharacterKeywords must be a boolean from the UI toggle');
    }
    return {
        caption: cloneCaption(opts.caption),
        artist: opts?.artist,
        replaceCharacterKeywords: opts.replaceCharacterKeywords,
        params: opts?.params,
        signal: opts?.signal,
        traceId: opts?.traceId,
    };
}

/**
 * 解耦门面：写提示词只打 writePrompt；出图只打 generateImage。
 * 供 UI 与测例共用，防止两个按钮互相触发。
 *
 * @param {{ writePrompt: Function, generateImage: Function }} service
 */
export function createDecoupledWorkbenchApi(service) {
    if (!service || typeof service.writePrompt !== 'function'
        || typeof service.generateImage !== 'function') {
        throw new Error('workbench service incomplete');
    }
    return {
        /**
         * @param {ReturnType<typeof buildWritePromptInput>} input
         */
        writePrompt(input) {
            return service.writePrompt(input);
        },
        /**
         * @param {ReturnType<typeof buildGenerateImageInput>} input
         */
        generateImage(input) {
            return service.generateImage(input);
        },
    };
}

/**
 * Abort / 取消不算失败。
 * @param {unknown} err
 * @returns {boolean}
 */
export function isWorkbenchAbort(err) {
    if (err == null) return false;
    if (typeof err === 'object') {
        const rec = /** @type {Record<string, unknown>} */ (err);
        if (rec.ok === false && rec.error != null && rec.error !== err) {
            return isWorkbenchAbort(rec.error);
        }
        const code = rec.code != null ? String(rec.code) : '';
        if (
            code === 'UPSTREAM_ABORTED'
            || code === 'NAI_ABORTED'
            || code === 'ABORT_ERR'
        ) {
            return true;
        }
        if (rec.name != null && String(rec.name) === 'AbortError') {
            return true;
        }
    }
    return false;
}

/**
 * @param {unknown} err
 * @returns {string}
 */
export function workbenchErrorMessage(err) {
    if (err == null) return '';
    if (typeof err === 'string') return err;
    if (typeof err === 'object') {
        const rec = /** @type {Record<string, unknown>} */ (err);
        if (rec.ok === false && rec.error != null && rec.error !== err) {
            return workbenchErrorMessage(rec.error);
        }
        if (rec.message != null && String(rec.message).trim() !== '') {
            return String(rec.message);
        }
    }
    return '操作失败';
}

/**
 * @param {unknown} err
 * @returns {string}
 */
export function workbenchErrorTraceId(err) {
    if (err && typeof err === 'object') {
        const rec = /** @type {Record<string, unknown>} */ (err);
        if (rec.ok === false && rec.error != null && rec.error !== err) {
            return workbenchErrorTraceId(rec.error);
        }
        if (rec.traceId != null && String(rec.traceId).trim() !== '') {
            return String(rec.traceId);
        }
    }
    return '';
}

/**
 * 展示 unmatchedKeys（需求 4.11 可观测）。
 * @param {unknown} keys
 * @returns {string}
 */
export function formatUnmatchedKeys(keys) {
    if (!Array.isArray(keys) || keys.length === 0) {
        return '';
    }
    const list = keys.map((k) => String(k)).filter((k) => k.trim() !== '');
    if (list.length === 0) return '';
    return `未匹配的构图标签：${list.join('、')}`;
}

/**
 * 进行中禁止再次提交（防重复计费）。
 * @param {boolean} busy
 * @returns {boolean}
 */
export function canSubmitGenerate(busy) {
    return busy !== true;
}

/**
 * 预览图 URL 门禁。
 * @param {unknown} url
 * @returns {string|null}
 */
export function gatePreviewUrl(url) {
    return safeImageUrl(url);
}

/**
 * 从 GeneratedImage 建可预览的安全 URL（blob → objectURL → 白名单）。
 * @param {{ blob?: Blob, mimeType?: string }|null|undefined} image
 * @param {{ createObjectURL?: (b: Blob) => string }} [urlApi]
 * @returns {{ url: string|null, revoke: () => void }}
 */
export function previewUrlFromImage(image, urlApi) {
    const api = urlApi && typeof urlApi.createObjectURL === 'function'
        ? urlApi
        : (typeof URL !== 'undefined' ? URL : null);
    if (!image || !image.blob || !api) {
        return { url: null, revoke: () => {} };
    }
    let raw = '';
    try {
        raw = api.createObjectURL(image.blob);
    } catch {
        return { url: null, revoke: () => {} };
    }
    const safe = gatePreviewUrl(raw);
    if (!safe) {
        if (typeof api.revokeObjectURL === 'function') {
            try { api.revokeObjectURL(raw); } catch { /* ignore */ }
        }
        return { url: null, revoke: () => {} };
    }
    let revoked = false;
    return {
        url: safe,
        revoke() {
            if (revoked) return;
            revoked = true;
            if (typeof api.revokeObjectURL === 'function') {
                try { api.revokeObjectURL(raw); } catch { /* ignore */ }
            }
        },
    };
}

/**
 * 空角色行。
 * @returns {{ positive: string, negative: string, x: number, y: number }}
 */
export function emptyCharacterRow() {
    return { positive: '', negative: '', x: 0.5, y: 0.5 };
}

/**
 * 粘贴解析结果的副作用决策（切换画师串 / 截断提示），纯函数可单测。
 *
 * @param {{ artist: { positive?: string, negative?: string }|null, truncated?: boolean, truncateMessage?: string|null }} parsed
 * @param {Iterable<{ id?: string, name?: string, positive?: string, negative?: string }>} artists
 * @returns {{
 *   artistAction: 'none'|'matched'|'missing',
 *   matchedArtist: { id: string, name: string }|null,
 *   truncateMessage: string|null,
 * }}
 */
export function resolvePasteArtistAction(parsed, artists) {
    const truncateMessage = parsed?.truncated && parsed?.truncateMessage
        ? String(parsed.truncateMessage)
        : null;
    if (!parsed?.artist) {
        return { artistAction: 'none', matchedArtist: null, truncateMessage };
    }
    const matched = findMatchingArtist(artists, parsed.artist);
    if (matched) {
        return {
            artistAction: 'matched',
            matchedArtist: { id: matched.id, name: matched.name },
            truncateMessage,
        };
    }
    return { artistAction: 'missing', matchedArtist: null, truncateMessage };
}
