/**
 * L3 领域模型 · 角色组 / 角色（架构文档 §5.1，需求 4.1）。
 * 归属：W0 契约冻结。
 */

import {
    isArrayOf,
    isNonEmptyString,
    isPlainObject,
    requireArg,
    validationErr,
    validationOk,
} from '../../infra/validate.js';

export const CHARACTER_SCHEMA_VERSION = 1;

/**
 * @typedef {object} CharacterGroup
 * @property {number} schemaVersion
 * @property {string} id
 * @property {string} name
 * @property {boolean} active 未激活组整组不参与关键字计算
 * @property {number} order
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {object} VariableFeature
 * @property {string} name 条目名（如「日常服饰」）
 * @property {string} prompt
 */

/**
 * @typedef {object} MatchOverrides
 * @property {boolean} [caseSensitive]
 * @property {boolean} [matchWholeWords]
 */

/**
 * @typedef {object} Character
 * @property {number} schemaVersion
 * @property {string} id
 * @property {string} groupId 一个角色只属于一个组
 * @property {string} name 注入块标题，不参与匹配
 * @property {string[]} keywords 英文逗号分隔录入后拆成数组；支持 /regex/flags
 * @property {string} fixedFeatures 固定特征（DNA）
 * @property {VariableFeature[]} variableFeatures 非固定特征 0..n
 * @property {MatchOverrides|null} matchOverrides
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {{ id: string, now: string }} IdNowDeps
 */

/**
 * @param {object} input
 * @param {IdNowDeps} deps
 * @returns {CharacterGroup}
 */
export function createCharacterGroup(input, deps) {
    requireArg(isPlainObject(input), 'input');
    requireArg(deps && isNonEmptyString(deps.id) && isNonEmptyString(deps.now), 'deps');
    return {
        schemaVersion: CHARACTER_SCHEMA_VERSION,
        id: deps.id,
        name: String(input.name ?? ''),
        active: input.active !== false,
        order: Number.isFinite(input.order) ? Number(input.order) : 0,
        createdAt: deps.now,
        updatedAt: deps.now,
    };
}

/**
 * @param {object} input
 * @param {IdNowDeps} deps
 * @returns {Character}
 */
export function createCharacter(input, deps) {
    requireArg(isPlainObject(input), 'input');
    requireArg(deps && isNonEmptyString(deps.id) && isNonEmptyString(deps.now), 'deps');
    return {
        schemaVersion: CHARACTER_SCHEMA_VERSION,
        id: deps.id,
        groupId: String(input.groupId ?? ''),
        name: String(input.name ?? ''),
        keywords: normalizeKeywords(input.keywords),
        fixedFeatures: String(input.fixedFeatures ?? ''),
        variableFeatures: normalizeVariableFeatures(input.variableFeatures),
        matchOverrides: normalizeMatchOverrides(input.matchOverrides),
        createdAt: deps.now,
        updatedAt: deps.now,
    };
}

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeKeywords(raw) {
    if (Array.isArray(raw)) {
        return raw.map((k) => String(k).trim()).filter((k) => k.length > 0);
    }
    if (typeof raw === 'string') {
        // 正则关键字 /…/flags 内的逗号不拆；简单启发式：以 / 开头且含未转义闭合 /
        return splitKeywordString(raw);
    }
    return [];
}

/**
 * 按英文逗号拆分，但 `/regex/flags` 整段保留（需求 4.1：正则里的逗号不拆开）。
 * @param {string} text
 * @returns {string[]}
 */
export function splitKeywordString(text) {
    const result = [];
    let buf = '';
    let inRegex = false;
    for (let i = 0; i < text.length; i += 1) {
        const ch = text[i];
        if (!inRegex && ch === '/' && buf.trim() === '') {
            inRegex = true;
            buf += ch;
            continue;
        }
        if (inRegex && ch === '/' && text[i - 1] !== '\\') {
            buf += ch;
            // 吃掉尾部 flags
            let j = i + 1;
            while (j < text.length && /[a-z]/i.test(text[j])) {
                buf += text[j];
                j += 1;
            }
            i = j - 1;
            inRegex = false;
            continue;
        }
        if (!inRegex && ch === ',') {
            const part = buf.trim();
            if (part) {
                result.push(part);
            }
            buf = '';
            continue;
        }
        buf += ch;
    }
    const last = buf.trim();
    if (last) {
        result.push(last);
    }
    return result;
}

/**
 * @param {unknown} raw
 * @returns {VariableFeature[]}
 */
function normalizeVariableFeatures(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw
        .filter((item) => isPlainObject(item))
        .map((item) => ({
            name: String(item.name ?? ''),
            prompt: String(item.prompt ?? ''),
        }));
}

/**
 * @param {unknown} raw
 * @returns {MatchOverrides|null}
 */
function normalizeMatchOverrides(raw) {
    if (raw == null) {
        return null;
    }
    if (!isPlainObject(raw)) {
        return null;
    }
    /** @type {MatchOverrides} */
    const out = {};
    if (typeof raw.caseSensitive === 'boolean') {
        out.caseSensitive = raw.caseSensitive;
    }
    if (typeof raw.matchWholeWords === 'boolean') {
        out.matchWholeWords = raw.matchWholeWords;
    }
    return Object.keys(out).length > 0 ? out : null;
}

/**
 * @param {unknown} obj
 * @returns {{ ok: true, value: CharacterGroup } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function validateCharacterGroup(obj) {
    if (!isPlainObject(obj)) {
        return validationErr('CHAR_GROUP_SHAPE', '角色组格式无效');
    }
    if (!isNonEmptyString(obj.id)) {
        return validationErr('CHAR_GROUP_ID', '角色组缺少 id');
    }
    if (!isNonEmptyString(obj.name)) {
        return validationErr('CHAR_GROUP_NAME', '请填写角色组名称');
    }
    if (typeof obj.active !== 'boolean') {
        return validationErr('CHAR_GROUP_ACTIVE', '角色组激活开关无效');
    }
    return validationOk(/** @type {CharacterGroup} */ ({
        schemaVersion: Number(obj.schemaVersion) || CHARACTER_SCHEMA_VERSION,
        id: String(obj.id),
        name: String(obj.name),
        active: obj.active,
        order: Number.isFinite(obj.order) ? Number(obj.order) : 0,
        createdAt: String(obj.createdAt ?? ''),
        updatedAt: String(obj.updatedAt ?? ''),
    }));
}

/**
 * @param {unknown} obj
 * @returns {{ ok: true, value: Character } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function validateCharacter(obj) {
    if (!isPlainObject(obj)) {
        return validationErr('CHAR_SHAPE', '角色格式无效');
    }
    if (!isNonEmptyString(obj.id)) {
        return validationErr('CHAR_ID', '角色缺少 id');
    }
    if (!isNonEmptyString(obj.groupId)) {
        return validationErr('CHAR_GROUP_ID', '角色必须归属某个组');
    }
    if (!isNonEmptyString(obj.name)) {
        return validationErr('CHAR_NAME', '请填写角色名称');
    }
    if (typeof obj.fixedFeatures !== 'string') {
        return validationErr('CHAR_DNA', '固定特征必须是文本');
    }
    const keywords = normalizeKeywords(obj.keywords);
    // 空关键字会导致 includes('') 恒真 —— 校验层警告但不强制（匹配层前置过滤）
    if (!isArrayOf(obj.variableFeatures ?? [], (x) => isPlainObject(x)) && obj.variableFeatures != null) {
        return validationErr('CHAR_VAR', '非固定特征格式无效');
    }
    return validationOk(/** @type {Character} */ ({
        schemaVersion: Number(obj.schemaVersion) || CHARACTER_SCHEMA_VERSION,
        id: String(obj.id),
        groupId: String(obj.groupId),
        name: String(obj.name),
        keywords,
        fixedFeatures: String(obj.fixedFeatures ?? ''),
        variableFeatures: normalizeVariableFeatures(obj.variableFeatures),
        matchOverrides: normalizeMatchOverrides(obj.matchOverrides),
        createdAt: String(obj.createdAt ?? ''),
        updatedAt: String(obj.updatedAt ?? ''),
    }));
}

/**
 * @param {object} obj
 * @param {number} fromVersion
 * @returns {{ ok: true, value: object } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function migrateCharacter(obj, fromVersion) {
    requireArg(isPlainObject(obj), 'obj');
    if (fromVersion >= CHARACTER_SCHEMA_VERSION) {
        return validationOk({ ...obj, schemaVersion: CHARACTER_SCHEMA_VERSION });
    }
    return validationOk({
        ...obj,
        schemaVersion: CHARACTER_SCHEMA_VERSION,
        keywords: normalizeKeywords(obj.keywords),
        variableFeatures: normalizeVariableFeatures(obj.variableFeatures),
        matchOverrides: normalizeMatchOverrides(obj.matchOverrides),
    });
}

/**
 * @param {object} obj
 * @param {number} fromVersion
 * @returns {{ ok: true, value: object } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function migrateCharacterGroup(obj, fromVersion) {
    requireArg(isPlainObject(obj), 'obj');
    return validationOk({
        ...obj,
        schemaVersion: CHARACTER_SCHEMA_VERSION,
        active: obj.active !== false,
    });
}
