/**
 * L3 领域模型 · 标签库 / 条目（架构文档 §5.1，需求 4.3）。
 * 归属：W0 契约冻结。召回只传 key，对上后才取 value。
 */

import {
    isNonEmptyString,
    isPlainObject,
    requireArg,
    schemaVersionMismatch,
    validationErr,
    validationOk,
} from '../../infra/validate.js';

export const TAG_SCHEMA_VERSION = 1;

/**
 * 标签库类型（挂在库上，不挂在条目上；需求 4.3）。
 * - `composition`：构图库，走 LLM 召回
 * - `feature`：特征库，走关键字召回
 * - `constant`：常驻库，已激活则每轮全部进入「常驻标签」，不召回、不匹配
 * @typedef {'composition'|'feature'|'constant'} TagLibraryKind
 */

/**
 * @typedef {object} TagLibrary
 * @property {number} schemaVersion
 * @property {string} id
 * @property {string} name
 * @property {boolean} active 未激活库不参与对应召回 / 常驻注入
 * @property {TagLibraryKind} kind 构图库 / 特征库 / 常驻库；新建库默认 composition；读取须为三者之一，否则校验失败
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * 特征库次要关键字方式（需求 4.3）。
 * - `any`：且涉及任意（次要关键字至少命中一个）
 * - `all`：且涉及全部（次要关键字全部命中）
 * @typedef {'any'|'all'} TagSecondaryLogic
 */

/**
 * @typedef {object} TagEntry
 * @property {number} schemaVersion
 * @property {string} id
 * @property {string} libraryId 一条 tag 只属于一个库
 * @property {string} key 召回用；模型回 key 原文
 * @property {string} value 生图 tag 提示词
 * @property {boolean} active 关掉的条目不参与召回、特征匹配、常驻注入；旧数据缺省视为开
 * @property {string} [secondaryKey] 特征库可选；写法同 key；与 secondaryLogic 同存同缺
 * @property {TagSecondaryLogic} [secondaryLogic] 特征库可选；`any` / `all`
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {{ id: string, now: string }} IdNowDeps
 */

/**
 * @param {unknown} raw
 * @returns {TagLibraryKind}
 */
export function normalizeTagLibraryKind(raw) {
    if (raw === 'feature') {
        return 'feature';
    }
    if (raw === 'constant') {
        return 'constant';
    }
    return 'composition';
}

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
        kind: normalizeTagLibraryKind(input.kind),
        createdAt: deps.now,
        updatedAt: deps.now,
    };
}

/**
 * 规范化特征条目次要关键字字段。
 * 规则：两者要么都不存，要么都存；`secondaryKey` 去空白后为空时两者都不存。
 * @param {unknown} raw
 * @returns {{ ok: true, value: { secondaryKey?: string, secondaryLogic?: TagSecondaryLogic } }
 *   | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function normalizeTagEntrySecondary(raw) {
    if (!isPlainObject(raw)) {
        return validationOk({});
    }
    const keyDefined = Object.prototype.hasOwnProperty.call(raw, 'secondaryKey');
    const logicDefined = Object.prototype.hasOwnProperty.call(raw, 'secondaryLogic');
    if (!keyDefined && !logicDefined) {
        return validationOk({});
    }

    if (keyDefined && raw.secondaryKey != null && typeof raw.secondaryKey !== 'string') {
        return validationErr('TAG_ENTRY_SECONDARY_KEY', '次要关键字必须是文本');
    }
    if (logicDefined && raw.secondaryLogic != null && typeof raw.secondaryLogic !== 'string') {
        return validationErr('TAG_ENTRY_SECONDARY_LOGIC', '次要关键字方式无效');
    }

    const keyTrimmed = keyDefined && raw.secondaryKey != null
        ? String(raw.secondaryKey).trim()
        : '';
    const logicRaw = logicDefined && raw.secondaryLogic != null
        ? String(raw.secondaryLogic).trim()
        : '';

    // 次要关键字去空白后为空 → 两者都不存（不存空字段）
    if (!keyTrimmed) {
        if (logicRaw) {
            return validationErr(
                'TAG_ENTRY_SECONDARY_PAIR',
                '次要关键字与方式须同时填写，或同时留空',
            );
        }
        return validationOk({});
    }

    if (!logicRaw) {
        return validationErr(
            'TAG_ENTRY_SECONDARY_PAIR',
            '次要关键字与方式须同时填写，或同时留空',
        );
    }
    if (logicRaw !== 'any' && logicRaw !== 'all') {
        return validationErr('TAG_ENTRY_SECONDARY_LOGIC', '次要关键字方式须为「且涉及任意」或「且涉及全部」');
    }
    return validationOk({
        secondaryKey: keyTrimmed,
        secondaryLogic: /** @type {TagSecondaryLogic} */ (logicRaw),
    });
}

/**
 * 构图库 / 常驻库不得出现次要关键字字段。
 * @param {TagLibraryKind|string} kind
 * @param {unknown} raw
 * @returns {{ ok: true, value: null }
 *   | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function assertSecondaryFieldsAllowed(kind, raw) {
    if (kind === 'feature' || !isPlainObject(raw)) {
        return validationOk(null);
    }
    if (
        Object.prototype.hasOwnProperty.call(raw, 'secondaryKey')
        || Object.prototype.hasOwnProperty.call(raw, 'secondaryLogic')
    ) {
        return validationErr(
            'TAG_ENTRY_SECONDARY_KIND',
            '次要关键字仅可用于特征库条目',
        );
    }
    return validationOk(null);
}

/**
 * @param {object} input
 * @param {IdNowDeps} deps
 * @returns {TagEntry}
 */
export function createTagEntry(input, deps) {
    requireArg(isPlainObject(input), 'input');
    requireArg(deps && isNonEmptyString(deps.id) && isNonEmptyString(deps.now), 'deps');
    const secondary = normalizeTagEntrySecondary(input);
    if (!secondary.ok) {
        throw secondary.error;
    }
    return {
        schemaVersion: TAG_SCHEMA_VERSION,
        id: deps.id,
        libraryId: String(input.libraryId ?? ''),
        key: String(input.key ?? ''),
        value: String(input.value ?? ''),
        active: input.active !== false,
        ...secondary.value,
        createdAt: deps.now,
        updatedAt: deps.now,
    };
}

/**
 * 旧条目没有 active 字段时视为开启。
 * @param {unknown} entry
 * @returns {boolean}
 */
export function isTagEntryActive(entry) {
    return !isPlainObject(entry) || entry.active !== false;
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
    if (obj.kind !== 'composition' && obj.kind !== 'feature' && obj.kind !== 'constant') {
        return validationErr('TAG_LIB_KIND', '标签库类型必须是 composition、feature 或 constant');
    }
    const ver = schemaVersionMismatch(obj, TAG_SCHEMA_VERSION, 'TAG_LIB_SCHEMA', '标签库');
    if (ver) {
        return ver;
    }
    return validationOk(/** @type {TagLibrary} */ ({
        schemaVersion: TAG_SCHEMA_VERSION,
        id: String(obj.id),
        name: String(obj.name),
        active: obj.active,
        kind: /** @type {TagLibraryKind} */ (obj.kind),
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
    const secondary = normalizeTagEntrySecondary(obj);
    if (!secondary.ok) {
        return secondary;
    }
    const hasActive = Object.prototype.hasOwnProperty.call(obj, 'active');
    if (hasActive && typeof obj.active !== 'boolean') {
        return validationErr('TAG_ENTRY_ACTIVE', '标签条目开关无效');
    }
    const ver = schemaVersionMismatch(obj, TAG_SCHEMA_VERSION, 'TAG_ENTRY_SCHEMA', '标签条目');
    if (ver) {
        return ver;
    }
    return validationOk(/** @type {TagEntry} */ ({
        schemaVersion: TAG_SCHEMA_VERSION,
        id: String(obj.id),
        libraryId: String(obj.libraryId),
        key: String(obj.key),
        value: String(obj.value ?? ''),
        active: hasActive ? obj.active === true : true,
        ...secondary.value,
        createdAt: String(obj.createdAt ?? ''),
        updatedAt: String(obj.updatedAt ?? ''),
    }));
}
