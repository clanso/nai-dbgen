/**
 * L2 适配器 · LLM 浏览器直连（绕开 ST 服务端）。
 * 归属：W1-C 网关代理实现。W0 仅冻结签名。
 */

import { Ok, Err } from '../../../infra/result.js';
import {
    configError,
    transportError,
    upstreamFromHttpStatus,
    contractError,
} from '../../../infra/errors.js';

/**
 * @param {object} [deps]
 * @returns {{
 *   name: string,
 *   complete: (req: import('../../../ports/llm.port.js').LlmCompleteRequest) => Promise<import('../../../infra/result.js').Ok<import('../../../ports/llm.port.js').LlmCompleteResult>|import('../../../infra/result.js').Err<import('../../../infra/errors.js').AppError>>,
 * }}
 */
export function createDirectLlmTransport(deps = {}) {
    const fetchImpl = deps.fetch ?? globalThis.fetch.bind(globalThis);

    return {
        name: 'direct',

        /**
         * @param {import('../../../ports/llm.port.js').LlmCompleteRequest} req
         */
        async complete(req) {
            const config = req?.config;
            if (!config || !String(config.baseUrl || '').trim()) {
                return Err(configError({
                    code: 'LLM_CONFIG_URL',
                    message: 'LLM 接口地址为空',
                    hint: '请在 LLM API 库填写 baseUrl',
                }));
            }
            if (!String(config.apiKey || '').trim()) {
                return Err(configError({
                    code: 'LLM_CONFIG_KEY',
                    message: 'LLM API Key 为空',
                    hint: '请在 LLM API 库填写 Key',
                }));
            }
            if (!String(config.model || '').trim()) {
                return Err(configError({
                    code: 'LLM_CONFIG_MODEL',
                    message: 'LLM 模型名为空',
                    hint: '请在 LLM API 库填写模型名',
                }));
            }
            if (!Array.isArray(req.messages) || req.messages.length === 0) {
                return Err(configError({
                    code: 'LLM_MESSAGES_EMPTY',
                    message: '没有可发送的聊天消息',
                }));
            }
            if (typeof fetchImpl !== 'function') {
                return Err(transportError({
                    code: 'LLM_FETCH_UNAVAILABLE',
                    message: '当前环境无法发起网络请求',
                    retryable: false,
                }));
            }

            let url;
            try {
                url = normalizeChatCompletionsUrl(config.baseUrl);
            } catch (cause) {
                return Err(configError({
                    code: 'LLM_CONFIG_URL_INVALID',
                    message: cause instanceof Error ? cause.message : 'API 地址格式不正确',
                    cause,
                }));
            }

            /** @type {Record<string, unknown>} */
            const payload = {
                model: config.model,
                messages: req.messages.map((m) => ({
                    role: m.role,
                    content: m.content,
                })),
                stream: false,
            };
            const schema = toOpenAiResponseFormat(req.jsonSchema);
            if (schema) {
                payload.response_format = schema;
            }

            try {
                const response = await fetchImpl(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
                        Authorization: `Bearer ${config.apiKey}`,
                    },
                    body: JSON.stringify(payload),
                    signal: req.signal,
                    mode: 'cors',
                    credentials: 'omit',
                });

                const textBody = await response.text();
                if (!response.ok) {
                    const retryAfterSec = parseRetryAfterHeader(response.headers);
                    return Err(upstreamFromHttpStatus(response.status, {
                        cause: null,
                        context: {
                            transport: 'direct',
                            ...(retryAfterSec != null ? { retryAfterSec } : {}),
                            // 不把响应体全文塞进错误（可能含敏感回显）；只留短预览
                            preview: textBody.slice(0, 300),
                        },
                    }));
                }

                let json;
                try {
                    json = JSON.parse(textBody);
                } catch (cause) {
                    return Err(contractError({
                        code: 'LLM_RESPONSE_NOT_JSON',
                        message: 'LLM 直连响应不是 JSON',
                        cause,
                        context: { rawText: textBody },
                    }));
                }

                if (json && typeof json === 'object' && json.error) {
                    const msg = json.error?.message || 'LLM 返回 error 字段';
                    return Err(upstreamFromHttpStatus(response.status || 502, {
                        message: String(msg),
                        context: { transport: 'direct' },
                    }));
                }

                const content = extractChoiceContent(json);
                return Ok({
                    text: content,
                });
            } catch (cause) {
                if (isAbortError(cause) || req.signal?.aborted) {
                    return Err(upstreamFromHttpStatus(0, { cause: toAbort(cause) }));
                }
                return Err(transportError({
                    code: 'LLM_DIRECT_FAILED',
                    message: '浏览器直连 LLM 失败（可能是 CORS 或网络不通）',
                    hint: '建议改用 st-backend 传输（经酒馆服务端，无 CORS 问题）',
                    retryable: true,
                    cause,
                    context: { transport: 'direct' },
                }));
            }
        },
    };
}

/**
 * @param {string} baseUrl
 * @returns {string}
 */
function normalizeChatCompletionsUrl(baseUrl) {
    const trimmed = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (!trimmed) {
        throw new Error('请填写 OpenAI-compatible API 地址。');
    }
    let url;
    try {
        url = new URL(trimmed);
    } catch {
        throw new Error('API 地址格式不正确。');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('API 地址只支持 http 或 https。');
    }
    if (/\/chat\/completions$/i.test(url.pathname)) {
        return url.toString();
    }
    const suffix = url.pathname.endsWith('/v1') ? 'chat/completions' : 'v1/chat/completions';
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${suffix}`;
    return url.toString();
}

/**
 * @param {unknown} jsonSchema
 * @returns {object|null}
 */
function toOpenAiResponseFormat(jsonSchema) {
    if (!jsonSchema || typeof jsonSchema !== 'object') {
        return null;
    }
    const s = /** @type {Record<string, unknown>} */ (jsonSchema);
    // 已是 OpenAI response_format
    if (s.type === 'json_schema' && s.json_schema) {
        return s;
    }
    // ST 形状 { name, value, strict? }
    if (s.value && typeof s.value === 'object') {
        return {
            type: 'json_schema',
            json_schema: {
                name: typeof s.name === 'string' ? s.name : 'response',
                strict: s.strict ?? true,
                schema: s.value,
            },
        };
    }
    // 裸 schema 对象
    return {
        type: 'json_schema',
        json_schema: {
            name: 'response',
            strict: true,
            schema: s,
        },
    };
}

/**
 * @param {any} json
 * @returns {string}
 */
function extractChoiceContent(json) {
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content === 'string') {
        return content;
    }
    if (content != null) {
        return JSON.stringify(content);
    }
    return '';
}

/**
 * @param {Headers} headers
 * @returns {number|null}
 */
function parseRetryAfterHeader(headers) {
    const raw = headers?.get?.('retry-after');
    if (raw == null || raw === '') {
        return null;
    }
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, n) : null;
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isAbortError(err) {
    if (err == null || typeof err !== 'object') {
        return false;
    }
    const e = /** @type {{ name?: string, code?: string }} */ (err);
    return e.name === 'AbortError' || e.code === 'ABORT_ERR';
}

/**
 * @param {unknown} cause
 * @returns {Error}
 */
function toAbort(cause) {
    if (cause instanceof Error) {
        if (cause.name !== 'AbortError') {
            cause.name = 'AbortError';
        }
        return cause;
    }
    const err = new Error('aborted');
    err.name = 'AbortError';
    return err;
}
