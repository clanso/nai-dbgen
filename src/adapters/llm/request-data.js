/**
 * L2 适配器 · 构造发给酒馆 Chat Completion 的请求体（custom 来源）。
 * 留空的生成参数不出现；推理强度经 custom_include_body；用户追加请求体优先且原文原样存发。
 *
 * @see ref/SillyTavern/src/endpoints/backends/chat-completions.js:2394-2672
 * @see ref/SillyTavern/public/scripts/custom-request.js:428-451
 */

import { parseYamlObject } from '../host/st-yaml.js';

/**
 * @param {import('../../domain/model/api-config.js').LlmApiConfig} config
 * @param {object} opts
 * @param {import('../../ports/llm.port.js').ChatMessage[]} opts.messages
 * @param {import('../host/st-yaml.js').YamlApi} [opts.yaml] 合并推理强度时必填
 * @param {object} [opts.jsonSchema]
 * @param {boolean} [opts.stream]
 * @returns {Record<string, unknown>}
 */
export function buildCustomChatCompletionRequest(config, opts) {
    /** @type {Record<string, unknown>} */
    const data = {
        stream: opts.stream === true,
        messages: opts.messages,
        model: config.model,
        chat_completion_source: 'custom',
        custom_url: config.baseUrl,
        secret_id: config.secretId,
        use_sysprompt: true,
    };

    if (config.temperature != null) data.temperature = config.temperature;
    if (config.topP != null) data.top_p = config.topP;
    if (config.topK != null) data.top_k = config.topK;
    if (config.maxTokens != null) data.max_tokens = config.maxTokens;
    if (config.presencePenalty != null) data.presence_penalty = config.presencePenalty;
    if (config.frequencyPenalty != null) data.frequency_penalty = config.frequencyPenalty;
    if (config.seed != null) data.seed = config.seed;
    if (Array.isArray(config.stop) && config.stop.length > 0) {
        data.stop = [...config.stop];
    }

    const includeBody = buildIncludeBody(config, opts.yaml);
    if (includeBody) {
        data.custom_include_body = includeBody;
    }
    if (config.customExcludeBody) {
        data.custom_exclude_body = config.customExcludeBody;
    }
    if (config.customIncludeHeaders) {
        data.custom_include_headers = config.customIncludeHeaders;
    }
    if (config.customPromptPostProcessing) {
        data.custom_prompt_post_processing = config.customPromptPostProcessing;
    }

    // 不发送 json_schema。酒馆会把它塞进 Gemini 的 response_schema，外壳上的 name 会被拒。
    // DeepSeek 也不接受。召回和生图按正文解析。

    for (const key of Object.keys(data)) {
        if (data[key] === undefined || data[key] === null || data[key] === '') {
            delete data[key];
        }
    }
    return data;
}

/**
 * 拉模型列表请求体（POST /api/backends/chat-completions/status）。
 * @param {{ baseUrl: string, secretId: string, customIncludeHeaders?: string }} config
 * @returns {Record<string, unknown>}
 */
export function buildCustomStatusRequest(config) {
    /** @type {Record<string, unknown>} */
    const data = {
        chat_completion_source: 'custom',
        custom_url: config.baseUrl,
        secret_id: config.secretId,
    };
    if (config.customIncludeHeaders) {
        data.custom_include_headers = config.customIncludeHeaders;
    }
    return data;
}

/**
 * 推理强度必须经 custom_include_body 发出。
 * - 无推理强度：用户追加请求体原文原样发出
 * - 有推理强度：同一 yaml 库 parse → 合并（用户原文优先）→ stringify
 *
 * @param {import('../../domain/model/api-config.js').LlmApiConfig} config
 * @param {import('../host/st-yaml.js').YamlApi} [yaml]
 * @returns {string|undefined}
 */
export function buildIncludeBody(config, yaml) {
    const effort = config.reasoningEffort == null ? '' : String(config.reasoningEffort).trim();
    const raw = typeof config.customIncludeBody === 'string' ? config.customIncludeBody : '';
    const hasRaw = raw.trim().length > 0;

    if (!effort && !hasRaw) {
        return undefined;
    }
    if (!effort && hasRaw) {
        return raw;
    }

    if (!yaml || typeof yaml.parse !== 'function' || typeof yaml.stringify !== 'function') {
        throw new Error('invalid argument: yaml');
    }

    /** @type {Record<string, unknown>} */
    const merged = { reasoning_effort: effort };
    if (hasRaw) {
        const parsed = parseYamlObject(yaml, raw);
        if (parsed.ok && parsed.value) {
            Object.assign(merged, parsed.value);
        }
    }
    return yaml.stringify(merged);
}

/**
 * @param {unknown} jsonSchema
 * @returns {object|undefined}
 */
export function toStJsonSchema(jsonSchema) {
    if (!jsonSchema || typeof jsonSchema !== 'object') {
        return undefined;
    }
    const s = /** @type {Record<string, unknown>} */ (jsonSchema);
    if (s.value && typeof s.value === 'object') {
        return {
            name: typeof s.name === 'string' ? s.name : 'response',
            description: typeof s.description === 'string' ? s.description : undefined,
            strict: s.strict ?? true,
            value: s.value,
        };
    }
    if (s.type === 'json_schema' && s.json_schema && typeof s.json_schema === 'object') {
        const inner = /** @type {Record<string, unknown>} */ (s.json_schema);
        return {
            name: typeof inner.name === 'string' ? inner.name : 'response',
            strict: inner.strict ?? true,
            value: inner.schema ?? inner,
        };
    }
    return {
        name: 'response',
        strict: true,
        value: s,
    };
}

/**
 * 从 /status 响应抽出模型 id 列表。
 * @param {unknown} payload
 * @returns {string[]}
 */
export function extractModelIdsFromStatus(payload) {
    if (!payload || typeof payload !== 'object') {
        return [];
    }
    const root = /** @type {Record<string, unknown>} */ (payload);
    if (root.error === true) {
        return [];
    }
    let list = root.data;
    if (!Array.isArray(list) && Array.isArray(root.models)) {
        list = root.models;
    }
    if (!Array.isArray(list)) {
        return [];
    }
    /** @type {string[]} */
    const ids = [];
    for (const item of list) {
        if (typeof item === 'string' && item.trim()) {
            ids.push(item.trim());
            continue;
        }
        if (item && typeof item === 'object') {
            const id = /** @type {Record<string, unknown>} */ (item).id
                ?? /** @type {Record<string, unknown>} */ (item).name;
            if (typeof id === 'string' && id.trim()) {
                ids.push(id.trim());
            }
        }
    }
    return ids;
}
