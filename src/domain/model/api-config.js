/**
 * L3 领域模型 · LLM / NAI API 配置条目（架构文档 §5.1，需求 4.9 / 4.10）。
 * 归属：W0 契约冻结。id / 时间戳由调用方经 deps 注入。
 *
 * LLM：对应酒馆「自定义（兼容 OpenAI）」；Key 只存酒馆密钥库编号 secretId，不存明文。
 */

import {
    isFiniteNumber,
    isNonEmptyString,
    isPlainObject,
    requireArg,
    schemaVersionMismatch,
    validationErr,
    validationOk,
} from '../../infra/validate.js';

/** 当前 schema 版本；读写只认此常量，不符即格式错误。 */
export const API_CONFIG_SCHEMA_VERSION = 1;

/** NovelAI 官方生图根地址（种子默认与表单占位共用）。 */
export const DEFAULT_NAI_BASE_URL = 'https://image.novelai.net';

/**
 * 酒馆密钥库 CUSTOM 键名（`secrets.js` SECRET_KEYS.CUSTOM）。
 * @see ref/SillyTavern/src/endpoints/secrets.js:32
 */
export const LLM_SECRET_KEY = 'api_key_custom';

/**
 * 提示词后处理取值（与 `custom_prompt_post_processing_types` 一致）。
 * @see ref/SillyTavern/public/scripts/openai.js:220-231
 * @type {readonly string[]}
 */
export const LLM_PROMPT_POST_PROCESSING_VALUES = Object.freeze([
    '',
    'merge',
    'merge_tools',
    'semi',
    'semi_tools',
    'strict',
    'strict_tools',
    'single',
]);

/**
 * 推理强度取值。空串 = 不发送（对应酒馆「自动」不传参）。
 * @see ref/SillyTavern/public/scripts/openai.js:239-246
 * @type {readonly string[]}
 */
export const LLM_REASONING_EFFORT_VALUES = Object.freeze([
    '',
    'min',
    'low',
    'medium',
    'high',
    'max',
]);

/**
 * 生成参数数值范围（对齐酒馆 Chat Completion 界面）。
 * @see ref/SillyTavern/public/index.html:652-1000
 */
export const LLM_PARAM_RANGES = Object.freeze({
    temperature: Object.freeze({ min: 0, max: 2 }),
    topP: Object.freeze({ min: 0, max: 1 }),
    topK: Object.freeze({ min: 0, max: 500 }),
    maxTokens: Object.freeze({ min: 1, max: 128000 }),
    presencePenalty: Object.freeze({ min: -2, max: 2 }),
    frequencyPenalty: Object.freeze({ min: -2, max: 2 }),
    seed: Object.freeze({ min: -1, max: 2147483647 }),
});

/**
 * 非空时校验 http(s) 绝对地址；空串视为合法（允许先保存再填）。
 * @param {unknown} value
 * @returns {boolean}
 */
export function isOptionalHttpUrl(value) {
    if (value == null) {
        return true;
    }
    const trimmed = String(value).trim();
    if (!trimmed) {
        return true;
    }
    try {
        const u = new URL(trimmed);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * @param {unknown} config
 * @returns {string}
 */
export function apiConfigDisplayName(config) {
    const name = String(config?.name ?? '').trim();
    return name || '未命名配置';
}

/**
 * 密钥库展示用 label。
 * @param {string} configName
 * @returns {string}
 */
export function llmSecretLabel(configName) {
    const name = String(configName ?? '').trim() || '未命名配置';
    return `酒馆数据库生图：${name}`;
}

/**
 * 是否已填明文密钥。密钥编号不算。
 * @param {unknown} config
 * @returns {boolean}
 */
export function llmConfigHasKey(config) {
    return isNonEmptyString(/** @type {{ apiKey?: unknown }} */ (config)?.apiKey);
}

/**
 * NAI 配置是否已填明文 Key（字段固定为 apiKey，不用 secretId 猜类型）。
 * @param {unknown} config
 * @returns {boolean}
 */
export function naiConfigHasKey(config) {
    return Boolean(String(/** @type {{ apiKey?: unknown }} */ (config)?.apiKey ?? '').trim());
}

/**
 * @typedef {object} LlmApiConfig
 * @property {number} schemaVersion
 * @property {string} id
 * @property {string} name
 * @property {string} baseUrl 填到 /v1 这一级
 * @property {string|null} secretId 酒馆密钥库编号；无 Key 时 null
 * @property {string} [apiKey] 交给酒馆代理的密钥原文；导出时去掉
 * @property {string} model
 * @property {number} [temperature]
 * @property {number} [topP]
 * @property {number} [topK]
 * @property {number} [maxTokens]
 * @property {number} [presencePenalty]
 * @property {number} [frequencyPenalty]
 * @property {number} [seed]
 * @property {string[]} [stop]
 * @property {string} [reasoningEffort] 空或不存 = 不发送
 * @property {string} [customIncludeBody] 追加请求体 YAML 对象原文
 * @property {string} [customExcludeBody] 排除字段 YAML 列表原文
 * @property {string} [customIncludeHeaders] 附加请求头 YAML 对象原文
 * @property {string} [customPromptPostProcessing] 空 = 无
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
 * 从表单/输入挑出「有值」的生成参数；留空不进对象。
 * @param {object} input
 * @returns {Partial<LlmApiConfig>}
 */
export function pickLlmGenerationParams(input) {
    requireArg(isPlainObject(input), 'input');
    /** @type {Partial<LlmApiConfig>} */
    const out = {};
    assignOptionalNumber(out, 'temperature', input.temperature, LLM_PARAM_RANGES.temperature);
    assignOptionalNumber(out, 'topP', input.topP, LLM_PARAM_RANGES.topP);
    assignOptionalInt(out, 'topK', input.topK, LLM_PARAM_RANGES.topK);
    assignOptionalInt(out, 'maxTokens', input.maxTokens, LLM_PARAM_RANGES.maxTokens);
    assignOptionalNumber(out, 'presencePenalty', input.presencePenalty, LLM_PARAM_RANGES.presencePenalty);
    assignOptionalNumber(out, 'frequencyPenalty', input.frequencyPenalty, LLM_PARAM_RANGES.frequencyPenalty);
    assignOptionalInt(out, 'seed', input.seed, LLM_PARAM_RANGES.seed);

    if (Array.isArray(input.stop)) {
        const stops = input.stop.map((s) => String(s)).filter((s) => s.length > 0);
        if (stops.length > 0) {
            out.stop = stops;
        }
    } else if (typeof input.stop === 'string' && input.stop.trim()) {
        const stops = input.stop.split('\n').map((s) => s.trimEnd()).filter((s) => s.length > 0);
        if (stops.length > 0) {
            out.stop = stops;
        }
    }

    const effort = input.reasoningEffort == null ? '' : String(input.reasoningEffort).trim();
    if (effort && LLM_REASONING_EFFORT_VALUES.includes(effort)) {
        out.reasoningEffort = effort;
    }

    return out;
}

/**
 * @param {object} input
 * @param {IdNowDeps} deps
 * @returns {LlmApiConfig}
 */
export function createLlmApiConfig(input, deps) {
    requireArg(isPlainObject(input), 'input');
    requireArg(deps && isNonEmptyString(deps.id) && isNonEmptyString(deps.now), 'deps');
    const gen = pickLlmGenerationParams(input);
    const secretId = normalizeSecretId(input.secretId);
    /** @type {LlmApiConfig} */
    const cfg = {
        schemaVersion: API_CONFIG_SCHEMA_VERSION,
        id: deps.id,
        name: String(input.name ?? ''),
        baseUrl: String(input.baseUrl ?? ''),
        secretId,
        model: String(input.model ?? ''),
        createdAt: deps.now,
        updatedAt: deps.now,
        ...gen,
    };
    const apiKey = input.apiKey == null ? '' : String(input.apiKey).trim();
    if (apiKey) {
        cfg.apiKey = apiKey;
    }
    assignOptionalYamlString(cfg, 'customIncludeBody', input.customIncludeBody);
    assignOptionalYamlString(cfg, 'customExcludeBody', input.customExcludeBody);
    assignOptionalYamlString(cfg, 'customIncludeHeaders', input.customIncludeHeaders);
    const post = input.customPromptPostProcessing == null
        ? ''
        : String(input.customPromptPostProcessing);
    if (post && LLM_PROMPT_POST_PROCESSING_VALUES.includes(post)) {
        cfg.customPromptPostProcessing = post;
    }
    return cfg;
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
 * 导出用：去掉 secretId 和明文密钥。
 * @param {LlmApiConfig} config
 * @returns {object}
 */
export function llmConfigForExport(config) {
    const normalized = normalizeLlmApiConfig(config);
    const {
        secretId: _sid,
        apiKey: _key,
        ...rest
    } = normalized;
    return rest;
}

/**
 * @typedef {object} YamlApi
 * @property {(text: string) => unknown} parse
 * @property {(value: unknown) => string} stringify
 */

/**
 * @param {unknown} obj
 * @param {{ yaml?: YamlApi }} [opts]
 *   yaml 由宿主适配层注入（与酒馆 lib.js 同一套）；有 YAML 字段时必须提供，否则结构校验会报错。
 * @returns {{ ok: true, value: LlmApiConfig } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function validateLlmApiConfig(obj, opts = {}) {
    if (!isPlainObject(obj)) {
        return validationErr('LLM_CONFIG_SHAPE', 'LLM 配置格式无效');
    }
    if (!isNonEmptyString(obj.id)) {
        return validationErr('LLM_CONFIG_ID', 'LLM 配置缺少 id');
    }
    if (!isNonEmptyString(obj.name)) {
        return validationErr('LLM_CONFIG_NAME', '请填写 LLM 配置名称');
    }
    if (obj.baseUrl != null && typeof obj.baseUrl !== 'string') {
        return validationErr('LLM_CONFIG_URL', '接口地址格式无效');
    }
    if (!isOptionalHttpUrl(obj.baseUrl)) {
        return validationErr('LLM_CONFIG_URL', '接口地址须为 http(s) 绝对地址');
    }
    if (obj.secretId != null && obj.secretId !== '' && typeof obj.secretId !== 'string') {
        return validationErr('LLM_CONFIG_SECRET', '密钥编号格式无效');
    }
    if (obj.apiKey != null && typeof obj.apiKey !== 'string') {
        return validationErr('LLM_CONFIG_KEY', 'API 密钥格式无效');
    }
    if (obj.model != null && typeof obj.model !== 'string') {
        return validationErr('LLM_CONFIG_MODEL', '模型名格式无效');
    }

    const ver = schemaVersionMismatch(obj, API_CONFIG_SCHEMA_VERSION, 'LLM_CONFIG_SCHEMA', 'LLM 配置');
    if (ver) {
        return ver;
    }

    const numCheck = validateOptionalNumberField(obj, 'temperature', LLM_PARAM_RANGES.temperature, '温度');
    if (numCheck) return numCheck;
    const topPCheck = validateOptionalNumberField(obj, 'topP', LLM_PARAM_RANGES.topP, 'Top P');
    if (topPCheck) return topPCheck;
    const topKCheck = validateOptionalIntField(obj, 'topK', LLM_PARAM_RANGES.topK, 'Top K');
    if (topKCheck) return topKCheck;
    const maxTokCheck = validateOptionalIntField(obj, 'maxTokens', LLM_PARAM_RANGES.maxTokens, '最大回复长度');
    if (maxTokCheck) return maxTokCheck;
    const presCheck = validateOptionalNumberField(obj, 'presencePenalty', LLM_PARAM_RANGES.presencePenalty, '存在惩罚');
    if (presCheck) return presCheck;
    const freqCheck = validateOptionalNumberField(obj, 'frequencyPenalty', LLM_PARAM_RANGES.frequencyPenalty, '频率惩罚');
    if (freqCheck) return freqCheck;
    const seedCheck = validateOptionalIntField(obj, 'seed', LLM_PARAM_RANGES.seed, '随机种子');
    if (seedCheck) return seedCheck;

    if (obj.stop != null) {
        if (!Array.isArray(obj.stop) || !obj.stop.every((s) => typeof s === 'string')) {
            return validationErr('LLM_CONFIG_STOP', '停止序列须为字符串列表');
        }
    }

    if (obj.reasoningEffort != null && obj.reasoningEffort !== '') {
        if (!LLM_REASONING_EFFORT_VALUES.includes(String(obj.reasoningEffort))) {
            return validationErr('LLM_CONFIG_REASONING', '推理强度取值无效');
        }
    }

    if (obj.customPromptPostProcessing != null && obj.customPromptPostProcessing !== '') {
        if (!LLM_PROMPT_POST_PROCESSING_VALUES.includes(String(obj.customPromptPostProcessing))) {
            return validationErr('LLM_CONFIG_POST', '提示词后处理取值无效');
        }
    }

    const yaml = opts.yaml;
    const bodyCheck = validateOptionalYamlObjectField(obj, 'customIncludeBody', '追加请求体', yaml);
    if (bodyCheck) return bodyCheck;
    const headersCheck = validateOptionalYamlObjectField(obj, 'customIncludeHeaders', '附加请求头', yaml);
    if (headersCheck) return headersCheck;
    const excludeCheck = validateOptionalYamlArrayField(obj, 'customExcludeBody', '排除请求体字段', yaml);
    if (excludeCheck) return excludeCheck;

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
    if (obj.baseUrl != null && typeof obj.baseUrl !== 'string') {
        return validationErr('NAI_CONFIG_URL', '接口地址格式无效');
    }
    if (!isOptionalHttpUrl(obj.baseUrl)) {
        return validationErr('NAI_CONFIG_URL', '接口地址须为 http(s) 绝对地址');
    }
    if (obj.apiKey != null && typeof obj.apiKey !== 'string') {
        return validationErr('NAI_CONFIG_KEY', 'API 密钥格式无效');
    }
    if (obj.transport !== 'direct' && obj.transport !== 'st-cors-proxy') {
        return validationErr('NAI_CONFIG_TRANSPORT', 'NAI 传输方式无效', { transport: obj.transport });
    }
    if (obj.decoder !== 'auto' && obj.decoder !== 'json' && obj.decoder !== 'zip') {
        return validationErr('NAI_CONFIG_DECODER', 'NAI 解码方式无效', { decoder: obj.decoder });
    }
    const ver = schemaVersionMismatch(obj, API_CONFIG_SCHEMA_VERSION, 'NAI_CONFIG_SCHEMA', 'NAI 配置');
    if (ver) {
        return ver;
    }
    return validationOk(/** @type {NaiApiConfig} */ (normalizeNaiApiConfig(obj)));
}

/**
 * @param {Record<string, unknown>} obj
 * @returns {LlmApiConfig}
 */
export function normalizeLlmApiConfig(obj) {
    const gen = pickLlmGenerationParams(obj);
    /** @type {LlmApiConfig} */
    const cfg = {
        schemaVersion: API_CONFIG_SCHEMA_VERSION,
        id: String(obj.id),
        name: String(obj.name ?? ''),
        baseUrl: String(obj.baseUrl ?? ''),
        secretId: normalizeSecretId(obj.secretId),
        model: String(obj.model ?? ''),
        createdAt: String(obj.createdAt ?? ''),
        updatedAt: String(obj.updatedAt ?? ''),
        ...gen,
    };
    const apiKey = obj.apiKey == null ? '' : String(obj.apiKey).trim();
    if (apiKey) {
        cfg.apiKey = apiKey;
    }
    assignOptionalYamlString(cfg, 'customIncludeBody', obj.customIncludeBody);
    assignOptionalYamlString(cfg, 'customExcludeBody', obj.customExcludeBody);
    assignOptionalYamlString(cfg, 'customIncludeHeaders', obj.customIncludeHeaders);
    const post = obj.customPromptPostProcessing == null
        ? ''
        : String(obj.customPromptPostProcessing);
    if (post && LLM_PROMPT_POST_PROCESSING_VALUES.includes(post)) {
        cfg.customPromptPostProcessing = post;
    }
    return cfg;
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
        schemaVersion: API_CONFIG_SCHEMA_VERSION,
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
 * @param {unknown} value
 * @returns {string|null}
 */
function normalizeSecretId(value) {
    if (value == null) {
        return null;
    }
    const s = String(value).trim();
    return s || null;
}

/**
 * @param {Partial<LlmApiConfig>} out
 * @param {keyof LlmApiConfig} key
 * @param {unknown} raw
 * @param {{ min: number, max: number }} range
 */
function assignOptionalNumber(out, key, raw, range) {
    if (raw == null || raw === '') {
        return;
    }
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(n)) {
        return;
    }
    if (n < range.min || n > range.max) {
        return;
    }
    // @ts-ignore
    out[key] = n;
}

/**
 * @param {Partial<LlmApiConfig>} out
 * @param {keyof LlmApiConfig} key
 * @param {unknown} raw
 * @param {{ min: number, max: number }} range
 */
function assignOptionalInt(out, key, raw, range) {
    if (raw == null || raw === '') {
        return;
    }
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isInteger(n)) {
        return;
    }
    if (n < range.min || n > range.max) {
        return;
    }
    // @ts-ignore
    out[key] = n;
}

/**
 * @param {LlmApiConfig} cfg
 * @param {'customIncludeBody'|'customExcludeBody'|'customIncludeHeaders'} key
 * @param {unknown} raw
 */
function assignOptionalYamlString(cfg, key, raw) {
    if (raw == null || typeof raw !== 'string') {
        return;
    }
    // 原文原样保存；仅用 trim 判断是否为空
    if (!raw.trim()) {
        return;
    }
    cfg[key] = raw;
}

/**
 * @param {Record<string, unknown>} obj
 * @param {string} key
 * @param {{ min: number, max: number }} range
 * @param {string} label
 */
function validateOptionalNumberField(obj, key, range, label) {
    if (obj[key] == null || obj[key] === '') {
        return null;
    }
    if (!isFiniteNumber(obj[key])) {
        return validationErr('LLM_CONFIG_PARAM', `${label}须为数字`);
    }
    const n = /** @type {number} */ (obj[key]);
    if (n < range.min || n > range.max) {
        return validationErr('LLM_CONFIG_PARAM', `${label}须在 ${range.min}～${range.max} 之间`);
    }
    return null;
}

/**
 * @param {Record<string, unknown>} obj
 * @param {string} key
 * @param {{ min: number, max: number }} range
 * @param {string} label
 */
function validateOptionalIntField(obj, key, range, label) {
    if (obj[key] == null || obj[key] === '') {
        return null;
    }
    const n = obj[key];
    if (typeof n !== 'number' || !Number.isInteger(n)) {
        return validationErr('LLM_CONFIG_PARAM', `${label}须为整数`);
    }
    if (n < range.min || n > range.max) {
        return validationErr('LLM_CONFIG_PARAM', `${label}须在 ${range.min}～${range.max} 之间`);
    }
    return null;
}

/**
 * @param {Record<string, unknown>} obj
 * @param {string} key
 * @param {string} label
 * @param {YamlApi} [yaml]
 */
function validateOptionalYamlObjectField(obj, key, label, yaml) {
    if (obj[key] == null || obj[key] === '') {
        return null;
    }
    if (typeof obj[key] !== 'string') {
        return validationErr('LLM_CONFIG_YAML', `${label}须为 YAML 文本`);
    }
    if (!yaml || typeof yaml.parse !== 'function') {
        return validationErr('LLM_CONFIG_YAML', `${label}无法校验：YAML 解析器不可用`);
    }
    try {
        const value = yaml.parse(String(obj[key]).trim());
        if (value === null || typeof value !== 'object' || Array.isArray(value)) {
            return validationErr('LLM_CONFIG_YAML', `${label}须为 YAML 对象（键值对）`);
        }
    } catch (cause) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        return validationErr('LLM_CONFIG_YAML', `${label}格式错误：${msg}`);
    }
    return null;
}

/**
 * @param {Record<string, unknown>} obj
 * @param {string} key
 * @param {string} label
 * @param {YamlApi} [yaml]
 */
function validateOptionalYamlArrayField(obj, key, label, yaml) {
    if (obj[key] == null || obj[key] === '') {
        return null;
    }
    if (typeof obj[key] !== 'string') {
        return validationErr('LLM_CONFIG_YAML', `${label}须为 YAML 文本`);
    }
    if (!yaml || typeof yaml.parse !== 'function') {
        return validationErr('LLM_CONFIG_YAML', `${label}无法校验：YAML 解析器不可用`);
    }
    try {
        const value = yaml.parse(String(obj[key]).trim());
        if (!Array.isArray(value)) {
            return validationErr('LLM_CONFIG_YAML', `${label}须为 YAML 列表`);
        }
    } catch (cause) {
        const msg = cause instanceof Error ? cause.message : String(cause);
        return validationErr('LLM_CONFIG_YAML', `${label}格式错误：${msg}`);
    }
    return null;
}
