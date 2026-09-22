/**
 * L3 领域模型 · 画师串（架构文档 §5.1，需求 4.2）。
 * 归属：W0 契约冻结。正负向拆开；previewImageRef 指向 ImageRepo。
 */

import {
    isNonEmptyString,
    isPlainObject,
    requireArg,
    validationErr,
    validationOk,
} from '../../infra/validate.js';

export const ARTIST_SCHEMA_VERSION = 1;

/**
 * @typedef {string} ImageRef IndexedDB 图片引用键
 */

/**
 * @typedef {object} ArtistString
 * @property {number} schemaVersion
 * @property {string} id
 * @property {string} name
 * @property {string} positive
 * @property {string} negative
 * @property {ImageRef|null} previewImageRef
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
    return {
        schemaVersion: ARTIST_SCHEMA_VERSION,
        id: deps.id,
        name: String(input.name ?? ''),
        positive: String(input.positive ?? ''),
        negative: String(input.negative ?? ''),
        previewImageRef: input.previewImageRef == null ? null : String(input.previewImageRef),
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
    if (typeof obj.positive !== 'string' || typeof obj.negative !== 'string') {
        return validationErr('ARTIST_PN', '正负向必须是文本');
    }
    return validationOk(/** @type {ArtistString} */ (normalizeArtist(obj)));
}

/**
 * @param {Record<string, unknown>} obj
 * @returns {ArtistString}
 */
export function normalizeArtist(obj) {
    return {
        schemaVersion: Number(obj.schemaVersion) || ARTIST_SCHEMA_VERSION,
        id: String(obj.id),
        name: String(obj.name ?? ''),
        positive: String(obj.positive ?? ''),
        negative: String(obj.negative ?? ''),
        previewImageRef: obj.previewImageRef == null || obj.previewImageRef === ''
            ? null
            : String(obj.previewImageRef),
        createdAt: String(obj.createdAt ?? ''),
        updatedAt: String(obj.updatedAt ?? ''),
    };
}

/**
 * @param {object} obj
 * @param {number} fromVersion
 * @returns {{ ok: true, value: object } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function migrateArtist(obj, fromVersion) {
    requireArg(isPlainObject(obj), 'obj');
    return validationOk(normalizeArtist({
        ...obj,
        schemaVersion: ARTIST_SCHEMA_VERSION,
    }));
}
