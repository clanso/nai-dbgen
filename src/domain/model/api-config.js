/**
 * L3 领域模型 · LLM / NAI API 配置条目（架构文档 §5.1，需求 4.9 / 4.10）。
 * 归属：W0 契约冻结。id / 时间戳由调用方经 deps 注入。
 */

import {
    isNonEmptyString,
    isPlainObject,
    requireArg,
    validationErr,
    validationOk,
} from '../../infra/validate.js';

/** 当前 schema 版本；导入导出迁移入口据此分支。 */
export const API_CONFIG_SCHEMA_VERSION = 1;

/**
 * @typedef {object} LlmApiConfig
 * @property {number} schemaVersion
 * @property {string} id
 * @property {string} name
 * @property {string} baseUrl
 * @property {string} apiKey
 * @property {string} model
 * @property {'st-backend'|'direct'} transport
 * @property {string} createdAt ISO
 * @property {string} updatedAt ISO
 */

/**
 * @typedef {object} NaiApiConfig
 * @property {number} schemaVersion
 * @property {string} id
 * @property {string} name
 * @property {string} baseUrl
 * @property {string} apiKey
 * @property {'direct'|'st-cors-proxy'} transport
 * @property {'auto'|'json'|'zip'} decoder
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @typedef {{ id: string, now: string }} IdNowDeps
 */

/**
 * @param {object} input
 * @param {IdNowDeps} deps
 * @returns {LlmApiConfig}
 */
export function createLlmApiConfig(input, deps) {
    requireArg(isPlainObject(input), 'input');
    requireArg(deps && isNonEmptyString(deps.id) && isNonEmptyString(deps.now), 'deps');
    const transport = input.transport === 'direct' ? 'direct' : 'st-backend';
    return {
        schemaVersion: API_CONFIG_SCHEMA_VERSION,
        id: deps.id,
        name: String(input.name ?? ''),
        baseUrl: String(input.baseUrl ?? ''),
        apiKey: String(input.apiKey ?? ''),
        model: String(input.model ?? ''),
        transport,
        createdAt: deps.now,
        updatedAt: deps.now,
    };
}

/**
 * @param {object} input
 * @param {IdNowDeps} deps
 * @returns {NaiApiConfig}
 */
export function createNaiApiConfig(input, deps) {
    requireArg(isPlainObject(input), 'input');
    requireArg(deps && isNonEmptyString(deps.id) && isNonEmptyString(deps.now), 'deps');
    const transport = input.transport === 'st-cors-proxy' ? 'st-cors-proxy' : 'direct';
    let decoder = 'auto';
    if (input.decoder === 'json' || input.decoder === 'zip') {
        decoder = input.decoder;
    }
    return {
        schemaVersion: API_CONFIG_SCHEMA_VERSION,
        id: deps.id,
        name: String(input.name ?? ''),
        baseUrl: String(input.baseUrl ?? ''),
        apiKey: String(input.apiKey ?? ''),
        transport,
        decoder,
        createdAt: deps.now,
        updatedAt: deps.now,
    };
}

/**
 * @param {unknown} obj
 * @returns {{ ok: true, value: LlmApiConfig } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function validateLlmApiConfig(obj) {
    if (!isPlainObject(obj)) {
        return validationErr('LLM_CONFIG_SHAPE', 'LLM 配置格式无效');
    }
    if (!isNonEmptyString(obj.id)) {
        return validationErr('LLM_CONFIG_ID', 'LLM 配置缺少 id');
    }
    if (!isNonEmptyString(obj.name)) {
        return validationErr('LLM_CONFIG_NAME', '请填写 LLM 配置名称');
    }
    if (!isNonEmptyString(obj.baseUrl)) {
        return validationErr('LLM_CONFIG_URL', '请填写接口地址');
    }
    if (!isNonEmptyString(obj.model)) {
        return validationErr('LLM_CONFIG_MODEL', '请填写模型名');
    }
    if (obj.transport !== 'st-backend' && obj.transport !== 'direct') {
        return validationErr('LLM_CONFIG_TRANSPORT', 'LLM 传输方式无效', { transport: obj.transport });
    }
    return validationOk(/** @type {LlmApiConfig} */ (normalizeLlmApiConfig(obj)));
}

/**
 * @param {unknown} obj
 * @returns {{ ok: true, value: NaiApiConfig } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function validateNaiApiConfig(obj) {
    if (!isPlainObject(obj)) {
        return validationErr('NAI_CONFIG_SHAPE', 'NAI 配置格式无效');
    }
    if (!isNonEmptyString(obj.id)) {
        return validationErr('NAI_CONFIG_ID', 'NAI 配置缺少 id');
    }
    if (!isNonEmptyString(obj.name)) {
        return validationErr('NAI_CONFIG_NAME', '请填写 NAI 配置名称');
    }
    if (!isNonEmptyString(obj.baseUrl)) {
        return validationErr('NAI_CONFIG_URL', '请填写接口地址');
    }
    if (obj.transport !== 'direct' && obj.transport !== 'st-cors-proxy') {
        return validationErr('NAI_CONFIG_TRANSPORT', 'NAI 传输方式无效', { transport: obj.transport });
    }
    if (obj.decoder !== 'auto' && obj.decoder !== 'json' && obj.decoder !== 'zip') {
        return validationErr('NAI_CONFIG_DECODER', 'NAI 解码方式无效', { decoder: obj.decoder });
    }
    return validationOk(/** @type {NaiApiConfig} */ (normalizeNaiApiConfig(obj)));
}

/**
 * @param {Record<string, unknown>} obj
 * @returns {LlmApiConfig}
 */
export function normalizeLlmApiConfig(obj) {
    return {
        schemaVersion: Number(obj.schemaVersion) || API_CONFIG_SCHEMA_VERSION,
        id: String(obj.id),
        name: String(obj.name ?? ''),
        baseUrl: String(obj.baseUrl ?? ''),
        apiKey: String(obj.apiKey ?? ''),
        model: String(obj.model ?? ''),
        transport: obj.transport === 'direct' ? 'direct' : 'st-backend',
        createdAt: String(obj.createdAt ?? ''),
        updatedAt: String(obj.updatedAt ?? ''),
    };
}

/**
 * @param {Record<string, unknown>} obj
 * @returns {NaiApiConfig}
 */
export function normalizeNaiApiConfig(obj) {
    let decoder = 'auto';
    if (obj.decoder === 'json' || obj.decoder === 'zip') {
        decoder = obj.decoder;
    }
    return {
        schemaVersion: Number(obj.schemaVersion) || API_CONFIG_SCHEMA_VERSION,
        id: String(obj.id),
        name: String(obj.name ?? ''),
        baseUrl: String(obj.baseUrl ?? ''),
        apiKey: String(obj.apiKey ?? ''),
        transport: obj.transport === 'st-cors-proxy' ? 'st-cors-proxy' : 'direct',
        decoder,
        createdAt: String(obj.createdAt ?? ''),
        updatedAt: String(obj.updatedAt ?? ''),
    };
}

/**
 * @param {object} obj
 * @param {number} fromVersion
 * @returns {{ ok: true, value: object } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function migrateApiConfig(obj, fromVersion) {
    requireArg(isPlainObject(obj), 'obj');
    if (fromVersion === API_CONFIG_SCHEMA_VERSION) {
        return validationOk(obj);
    }
    if (fromVersion < 1) {
        return validationOk({
            ...obj,
            schemaVersion: API_CONFIG_SCHEMA_VERSION,
        });
    }
    return validationErr('API_CONFIG_MIGRATE', `无法从 schema v${fromVersion} 迁移 API 配置`);
}
