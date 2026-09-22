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
import { safeImageUrl } from '../common/safe-url.js';

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
        const centers = [{
            x: Number.isFinite(x) ? x : 0.5,
            y: Number.isFinite(y) ? y : 0.5,
        }];
        posChars.push({
            char_caption: String(row?.positive ?? ''),
            centers: centers.map((p) => ({ ...p })),
        });
        negChars.push({
            char_caption: String(row?.negative ?? ''),
            centers: centers.map((p) => ({ ...p })),
        });
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
 * 组装 writePrompt 入参。本函数绝不碰 imageGen / generateImage。
 * @param {object} opts
 * @param {string} opts.naturalLanguage
 * @param {string[]} opts.libraryIds
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.traceId]
 */
export function buildWritePromptInput(opts) {
    return {
        naturalLanguage: String(opts?.naturalLanguage ?? ''),
        libraryIds: Array.isArray(opts?.libraryIds)
            ? opts.libraryIds.map((id) => String(id))
            : [],
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
 * @param {AbortSignal} [opts.signal]
 * @param {string} [opts.traceId]
 */
export function buildGenerateImageInput(opts) {
    if (typeof opts?.replaceCharacterKeywords !== 'boolean') {
        throw new Error('replaceCharacterKeywords must be a boolean from the UI toggle');
    }
    return {
        caption: cloneCaption(opts.caption),
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
    return `未命中标签 key：${list.join('、')}`;
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
