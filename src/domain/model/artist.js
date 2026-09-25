/**
 * L3 领域模型 · 画师串（架构文档 §5.1，需求 4.2）。
 * 导入导出五字段：name / sequence / positivePrompt / negativePrompt / referenceImage。
 * 库内另存 referenceImageRef + cardImageRef（卡片图不导出）。
 */

import {
    isNonEmptyString,
    isPlainObject,
    requireArg,
    schemaVersionMismatch,
    validationErr,
    validationOk,
} from '../../infra/validate.js';

export const ARTIST_SCHEMA_VERSION = 1;

/**
 * 库列表卡片图：宽 480、按原图比例、webp。
 * @readonly
 */
export const ARTIST_CARD_IMAGE = Object.freeze({
    width: 480,
    quality: 0.85,
});

/**
 * @typedef {string} ImageRef 服务器示例图文件名
 */

/**
 * @typedef {object} ArtistString
 * @property {number} schemaVersion
 * @property {string} id
 * @property {string} name
 * @property {number} sequence
 * @property {string} positivePrompt
 * @property {string} negativePrompt
 * @property {ImageRef|null} referenceImageRef
 * @property {ImageRef|null} cardImageRef 卡片图（不导出；导入/预览时从原图生成）
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {{ id: string, now: string }} IdNowDeps
 */

/**
 * @param {object} input
 * @param {IdNowDeps} deps
 * @returns {ArtistString}
 */
export function createArtist(input, deps) {
    requireArg(isPlainObject(input), 'input');
    requireArg(deps && isNonEmptyString(deps.id) && isNonEmptyString(deps.now), 'deps');
    const sequence = Number(input.sequence);
    return {
        schemaVersion: ARTIST_SCHEMA_VERSION,
        id: deps.id,
        name: String(input.name ?? ''),
        sequence: Number.isFinite(sequence) ? sequence : 0,
        positivePrompt: String(input.positivePrompt ?? ''),
        negativePrompt: String(input.negativePrompt ?? ''),
        referenceImageRef: input.referenceImageRef == null || input.referenceImageRef === ''
            ? null
            : String(input.referenceImageRef),
        cardImageRef: input.cardImageRef == null || input.cardImageRef === ''
            ? null
            : String(input.cardImageRef),
        createdAt: deps.now,
        updatedAt: deps.now,
    };
}

/**
 * @param {unknown} obj
 * @returns {{ ok: true, value: ArtistString } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function validateArtist(obj) {
    if (!isPlainObject(obj)) {
        return validationErr('ARTIST_SHAPE', '画师串格式无效');
    }
    if (!isNonEmptyString(obj.id)) {
        return validationErr('ARTIST_ID', '画师串缺少 id');
    }
    if (!isNonEmptyString(obj.name)) {
        return validationErr('ARTIST_NAME', '请填写画师串名称');
    }
    if (typeof obj.positivePrompt !== 'string' || typeof obj.negativePrompt !== 'string') {
        return validationErr('ARTIST_PN', '正负向必须是文本');
    }
    if (typeof obj.sequence !== 'number' || !Number.isFinite(obj.sequence)) {
        return validationErr('ARTIST_SEQUENCE', '排序号必须是数字');
    }
    const ver = schemaVersionMismatch(obj, ARTIST_SCHEMA_VERSION, 'ARTIST_SCHEMA', '画师串');
    if (ver) {
        return ver;
    }
    return validationOk(/** @type {ArtistString} */ (normalizeArtist(obj)));
}

/**
 * @param {Record<string, unknown>} obj
 * @returns {ArtistString}
 */
export function normalizeArtist(obj) {
    const sequence = Number(obj.sequence);
    return {
        schemaVersion: ARTIST_SCHEMA_VERSION,
        id: String(obj.id),
        name: String(obj.name ?? ''),
        sequence: Number.isFinite(sequence) ? sequence : 0,
        positivePrompt: String(obj.positivePrompt ?? ''),
        negativePrompt: String(obj.negativePrompt ?? ''),
        referenceImageRef: obj.referenceImageRef == null || obj.referenceImageRef === ''
            ? null
            : String(obj.referenceImageRef),
        cardImageRef: obj.cardImageRef == null || obj.cardImageRef === ''
            ? null
            : String(obj.cardImageRef),
        createdAt: String(obj.createdAt ?? ''),
        updatedAt: String(obj.updatedAt ?? ''),
    };
}

/**
 * 当前库最大 sequence + 1；空库从 0 起。
 * @param {Iterable<{ sequence?: number }>} artists
 * @returns {number}
 */
export function nextArtistSequence(artists) {
    let max = -1;
    for (const item of artists || []) {
        const n = Number(item?.sequence);
        if (Number.isFinite(n) && n > max) {
            max = n;
        }
    }
    return max + 1;
}

/**
 * 按 sequence 升序；同号再按 name。
 * @param {ArtistString[]} items
 * @returns {ArtistString[]}
 */
export function sortArtistsBySequence(items) {
    return [...(items || [])].sort((a, b) => {
        const d = (Number(a.sequence) || 0) - (Number(b.sequence) || 0);
        if (d !== 0) return d;
        return String(a.name || '').localeCompare(String(b.name || ''));
    });
}
