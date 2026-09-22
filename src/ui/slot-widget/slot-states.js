/**
 * L5 UI · slot 四态推导与文案（纯函数，可单测）。
 * 归属：W2-G。
 *
 * 四态：idle（未生图）/ generating（生图中）/ done（已出图）/ error（失败）。
 * Abort 不计作失败（见 isAbortFailure / shouldTreatAsError）。
 */

import { t } from '../i18n/zh-CN.js';

/** @typedef {'idle'|'generating'|'done'|'error'} SlotUiState */

/**
 * @typedef {object} SlotRuntimeSnapshot
 * @property {'generating'|'error'|null|undefined} [status]
 * @property {unknown} [error]
 * @property {string|null|undefined} [traceId]
 */

/**
 * @typedef {object} SlotUiView
 * @property {SlotUiState} state
 * @property {string} buttonLabel
 * @property {string} stateClass
 * @property {boolean} busy
 * @property {boolean} showImage
 * @property {boolean} showError
 * @property {string} errorMessage
 * @property {string} traceId
 */

/**
 * 从 SlotRecord 取最新图片条目（不依赖 domain，避免 UI→domain 直连）。
 * @param {{ images?: Array<{ imageRef?: string }> }|null|undefined} record
 * @returns {{ imageRef: string }|null}
 */
export function latestImageEntry(record) {
    if (!record || !Array.isArray(record.images) || record.images.length === 0) {
        return null;
    }
    const last = record.images[record.images.length - 1];
    if (!last || last.imageRef == null || String(last.imageRef).trim() === '') {
        return null;
    }
    return { imageRef: String(last.imageRef) };
}

/**
 * 记录是否已有可展示图片（持久层「已出图」）。
 * @param {{ images?: unknown[] }|null|undefined} record
 * @returns {boolean}
 */
export function recordHasImage(record) {
    return latestImageEntry(record) != null;
}

/**
 * 用户取消 / Abort：不计失败、不弹错。
 * @param {unknown} err
 * @returns {boolean}
 */
export function isAbortFailure(err) {
    if (err == null) {
        return false;
    }
    if (typeof err === 'object') {
        const rec = /** @type {Record<string, unknown>} */ (err);
        const code = rec.code != null ? String(rec.code) : '';
        if (
            code === 'UPSTREAM_ABORTED'
            || code === 'NAI_ABORTED'
            || code === 'ABORT_ERR'
        ) {
            return true;
        }
        const name = rec.name != null ? String(rec.name) : '';
        if (name === 'AbortError') {
            return true;
        }
        // Result.Err 形态：{ ok:false, error }
        if (rec.error != null && rec.error !== err) {
            return isAbortFailure(rec.error);
        }
    }
    return false;
}

/**
 * 是否应进入 error 态（Abort → false）。
 * @param {unknown} err
 * @returns {boolean}
 */
export function shouldTreatAsError(err) {
    return err != null && !isAbortFailure(err);
}

/**
 * 面向用户的错误文案（已保证中文时原样取 message）。
 * @param {unknown} err
 * @returns {string}
 */
export function slotErrorMessage(err) {
    if (err == null) {
        return '';
    }
    if (typeof err === 'string') {
        return err;
    }
    if (typeof err === 'object') {
        const rec = /** @type {Record<string, unknown>} */ (err);
        if (rec.error != null && rec.error !== err && typeof rec.ok === 'boolean') {
            return slotErrorMessage(rec.error);
        }
        if (rec.message != null && String(rec.message).trim() !== '') {
            return String(rec.message);
        }
    }
    return '生图失败';
}

/**
 * @param {unknown} err
 * @param {string|null|undefined} [fallbackTraceId]
 * @returns {string}
 */
export function slotErrorTraceId(err, fallbackTraceId) {
    if (err && typeof err === 'object') {
        const rec = /** @type {Record<string, unknown>} */ (err);
        if (rec.error != null && rec.error !== err && typeof rec.ok === 'boolean') {
            return slotErrorTraceId(rec.error, fallbackTraceId);
        }
        if (rec.traceId != null && String(rec.traceId).trim() !== '') {
            return String(rec.traceId);
        }
    }
    if (fallbackTraceId != null && String(fallbackTraceId).trim() !== '') {
        return String(fallbackTraceId);
    }
    return '';
}

/**
 * 状态修饰类（挂在 .nd-slot 上）。
 * @param {SlotUiState} state
 * @returns {string}
 */
export function slotStateClass(state) {
    switch (state) {
        case 'generating':
            return 'nd-slot--generating';
        case 'done':
            return 'nd-slot--done';
        case 'error':
            return 'nd-slot--error';
        case 'idle':
        default:
            return 'nd-slot--idle';
    }
}

/**
 * 按钮文案。
 * @param {SlotUiState} state
 * @returns {string}
 */
export function slotButtonLabel(state) {
    switch (state) {
        case 'generating':
            return '生图中…';
        case 'done':
            return t('slot.regenerate');
        case 'error':
            return '重试';
        case 'idle':
        default:
            return t('slot.generate');
    }
}

/**
 * 从持久记录 + 运行时快照推导 UI 视图。
 * 重挂载时：runtime 无 generating/error → 以 record.images 为准恢复 done/idle。
 * @param {{ images?: unknown[] }|null|undefined} record
 * @param {SlotRuntimeSnapshot|null|undefined} runtime
 * @returns {SlotUiView}
 */
export function deriveSlotUiView(record, runtime) {
    /** @type {SlotUiState} */
    let state = 'idle';

    if (runtime && runtime.status === 'generating') {
        state = 'generating';
    } else if (runtime && runtime.status === 'error' && shouldTreatAsError(runtime.error)) {
        state = 'error';
    } else if (recordHasImage(record)) {
        state = 'done';
    } else {
        state = 'idle';
    }

    const errSrc = runtime && runtime.status === 'error' ? runtime.error : null;
    const errorMessage = state === 'error' ? slotErrorMessage(errSrc) : '';
    const traceId = state === 'error'
        ? slotErrorTraceId(errSrc, runtime?.traceId)
        : '';

    return {
        state,
        buttonLabel: slotButtonLabel(state),
        stateClass: slotStateClass(state),
        busy: state === 'generating',
        showImage: state === 'done' || state === 'generating',
        showError: state === 'error',
        errorMessage,
        traceId,
    };
}

/**
 * 解析 Result / thenable 结算后的 UI 意图。
 * @param {unknown} settled 同步 Result、或 await 后的值、或抛出的 err
 * @returns {{ kind: 'ok' } | { kind: 'abort' } | { kind: 'error', error: unknown }}
 */
export function classifyGenerateSettlement(settled) {
    if (settled == null) {
        return { kind: 'ok' };
    }
    if (typeof settled === 'object' && typeof /** @type {{ ok?: unknown }} */ (settled).ok === 'boolean') {
        const result = /** @type {{ ok: boolean, error?: unknown }} */ (settled);
        if (result.ok) {
            return { kind: 'ok' };
        }
        if (isAbortFailure(result.error)) {
            return { kind: 'abort' };
        }
        return { kind: 'error', error: result.error ?? settled };
    }
    if (isAbortFailure(settled)) {
        return { kind: 'abort' };
    }
    // 非 Result 的真值：若像 Error 则当失败，否则视为 ok（void 回调）
    if (settled instanceof Error) {
        return { kind: 'error', error: settled };
    }
    return { kind: 'ok' };
}
