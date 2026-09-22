/**
 * L3 领域模型 · 标签库 / 条目（架构文档 §5.1，需求 4.3）。
 * 归属：W0 契约冻结。召回只传 key，对上后才取 value。
 */

import {
    isNonEmptyString,
    isPlainObject,
    requireArg,
    validationErr,
    validationOk,
} from '../../infra/validate.js';

export const TAG_SCHEMA_VERSION = 1;

/**
 * @typedef {object} TagLibrary
 * @property {number} schemaVersion
 * @property {string} id
 * @property {string} name
 * @property {boolean} active 未激活库的 key 不进入召回
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {object} TagEntry
 * @property {number} schemaVersion
 * @property {string} id
 * @property {string} libraryId 一条 tag 只属于一个库
 * @property {string} key 召回用；模型回 key 原文
 * @property {string} value 生图 tag 提示词
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {{ id: string, now: string }} IdNowDeps
 */

/**
 * @param {object} input
 * @param {IdNowDeps} deps
 * @returns {TagLibrary}
 */
export function createTagLibrary(input, deps) {
    requireArg(isPlainObject(input), 'input');
    requireArg(deps && isNonEmptyString(deps.id) && isNonEmptyString(deps.now), 'deps');
    return {
        schemaVersion: TAG_SCHEMA_VERSION,
        id: deps.id,
        name: String(input.name ?? ''),
        active: input.active !== false,
        createdAt: deps.now,
        updatedAt: deps.now,
    };
}

/**
 * @param {object} input
 * @param {IdNowDeps} deps
 * @returns {TagEntry}
 */
export function createTagEntry(input, deps) {
    requireArg(isPlainObject(input), 'input');
    requireArg(deps && isNonEmptyString(deps.id) && isNonEmptyString(deps.now), 'deps');
    return {
        schemaVersion: TAG_SCHEMA_VERSION,
        id: deps.id,
        libraryId: String(input.libraryId ?? ''),
        key: String(input.key ?? ''),
        value: String(input.value ?? ''),
        createdAt: deps.now,
        updatedAt: deps.now,
    };
}

/**
 * @param {unknown} obj
 * @returns {{ ok: true, value: TagLibrary } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function validateTagLibrary(obj) {
    if (!isPlainObject(obj)) {
        return validationErr('TAG_LIB_SHAPE', '标签库格式无效');
    }
    if (!isNonEmptyString(obj.id)) {
        return validationErr('TAG_LIB_ID', '标签库缺少 id');
    }
    if (!isNonEmptyString(obj.name)) {
        return validationErr('TAG_LIB_NAME', '请填写标签库名称');
    }
    if (typeof obj.active !== 'boolean') {
        return validationErr('TAG_LIB_ACTIVE', '标签库激活开关无效');
    }
    return validationOk(/** @type {TagLibrary} */ ({
        schemaVersion: Number(obj.schemaVersion) || TAG_SCHEMA_VERSION,
        id: String(obj.id),
        name: String(obj.name),
        active: obj.active,
        createdAt: String(obj.createdAt ?? ''),
        updatedAt: String(obj.updatedAt ?? ''),
    }));
}

/**
 * @param {unknown} obj
 * @returns {{ ok: true, value: TagEntry } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function validateTagEntry(obj) {
    if (!isPlainObject(obj)) {
        return validationErr('TAG_ENTRY_SHAPE', '标签条目格式无效');
    }
    if (!isNonEmptyString(obj.id)) {
        return validationErr('TAG_ENTRY_ID', '标签条目缺少 id');
    }
    if (!isNonEmptyString(obj.libraryId)) {
        return validationErr('TAG_ENTRY_LIB', '标签条目必须归属某个库');
    }
    if (!isNonEmptyString(obj.key)) {
        return validationErr('TAG_ENTRY_KEY', '请填写召回 key');
    }
    if (typeof obj.value !== 'string') {
        return validationErr('TAG_ENTRY_VALUE', '标签 value 必须是文本');
    }
    return validationOk(/** @type {TagEntry} */ ({
        schemaVersion: Number(obj.schemaVersion) || TAG_SCHEMA_VERSION,
        id: String(obj.id),
        libraryId: String(obj.libraryId),
        key: String(obj.key),
        value: String(obj.value ?? ''),
        createdAt: String(obj.createdAt ?? ''),
        updatedAt: String(obj.updatedAt ?? ''),
    }));
}

/**
 * @param {object} obj
 * @param {number} fromVersion
 * @returns {{ ok: true, value: object } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function migrateTagLibrary(obj, fromVersion) {
    requireArg(isPlainObject(obj), 'obj');
    return validationOk({
        ...obj,
        schemaVersion: TAG_SCHEMA_VERSION,
        active: obj.active !== false,
    });
}

/**
 * @param {object} obj
 * @param {number} fromVersion
 * @returns {{ ok: true, value: object } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function migrateTagEntry(obj, fromVersion) {
    requireArg(isPlainObject(obj), 'obj');
    return validationOk({
        ...obj,
        schemaVersion: TAG_SCHEMA_VERSION,
        key: String(obj.key ?? ''),
        value: String(obj.value ?? ''),
    });
}
