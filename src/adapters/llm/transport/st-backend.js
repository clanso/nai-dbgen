/**
 * L2 适配器 · 经 ST ChatCompletionService + reverse_proxy（基线 §8.4）。
 * 归属：W1-C 网关代理实现。W0 仅冻结签名。
 *
 * 裁决 D26：AppError.message 必须是中文用户文案；英文宿主信息只进 cause / context.preview。
 * 裁决 D27：无法从宿主异常中解析出真实 HTTP 状态码时，默认不可重试（避免误重试计费/写操作）。
 */

import { Ok, Err } from '../../../infra/result.js';
import {
    configError,
    hostError,
    transportError,
    upstreamFromHttpStatus,
} from '../../../infra/errors.js';

/**
 * @param {object} deps
 * @param {() => any} deps.getContext
 * @returns {{
 *   name: string,
 *   complete: (req: import('../../../ports/llm.port.js').LlmCompleteRequest) => Promise<import('../../../infra/result.js').Ok<import('../../../ports/llm.port.js').LlmCompleteResult>|import('../../../infra/result.js').Err<import('../../../infra/errors.js').AppError>>,
 * }}
 */
export function createStBackendLlmTransport(deps) {
    if (!deps || typeof deps.getContext !== 'function') {
        throw new Error('invalid argument: deps.getContext');
    }
    const getContext = deps.getContext;

    return {
        name: 'st-backend',

        /**
         * @param {import('../../../ports/llm.port.js').LlmCompleteRequest} req
         */
        async complete(req) {
            const config = req?.config;
            const traceId = req?.traceId ?? null;

            if (!config || !String(config.baseUrl || '').trim()) {
                return Err(configError({
                    code: 'LLM_CONFIG_URL',
                    message: 'LLM 接口地址为空',
                    hint: '请在 LLM API 库填写 baseUrl',
                    traceId,
                }));
            }
            if (!String(config.apiKey || '').trim()) {
                return Err(configError({
                    code: 'LLM_CONFIG_KEY',
                    message: 'LLM API Key 为空',
                    hint: '请在 LLM API 库填写 Key',
                    traceId,
                }));
            }
            if (!String(config.model || '').trim()) {
                return Err(configError({
                    code: 'LLM_CONFIG_MODEL',
                    message: 'LLM 模型名为空',
                    hint: '请在 LLM API 库填写模型名',
                    traceId,
                }));
            }
            if (!Array.isArray(req.messages) || req.messages.length === 0) {
                return Err(configError({
                    code: 'LLM_MESSAGES_EMPTY',
                    message: '没有可发送的聊天消息',
                    traceId,
                }));
            }

            let ctx;
            try {
                ctx = getContext();
            } catch (cause) {
                return Err(hostError({
                    code: 'LLM_ST_CONTEXT',
                    message: '无法获取酒馆上下文',
                    hint: '请确认插件在 SillyTavern 页面内加载',
                    cause,
                    traceId,
                }));
            }

            const Service = ctx?.ChatCompletionService;
            if (!Service || typeof Service.sendRequest !== 'function') {
                return Err(hostError({
                    code: 'LLM_ST_CCS_MISSING',
                    message: '宿主缺少 ChatCompletionService',
                    hint: '请升级 SillyTavern，或改用 direct 传输',
                    traceId,
                }));
            }

            /** @type {Record<string, unknown>} */
            const requestData = typeof Service.createRequestData === 'function'
                ? Service.createRequestData({
                    stream: false,
                    messages: req.messages,
                    model: config.model,
                    chat_completion_source: 'openai',
                    reverse_proxy: config.baseUrl,
                    proxy_password: config.apiKey,
                    json_schema: toStJsonSchema(req.jsonSchema),
                })
                : {
                    stream: false,
                    messages: req.messages,
                    model: config.model,
                    chat_completion_source: 'openai',
                    reverse_proxy: config.baseUrl,
                    proxy_password: config.apiKey,
                    use_sysprompt: true,
                    json_schema: toStJsonSchema(req.jsonSchema),
                };

            // 不走流式：本插件两次 LLM 均为一次性取结果
            requestData.stream = false;

            try {
                // extractData=true：得到 { content, reasoning }；若带 json_schema，ST 可能已把 content 解析成对象
                const result = await Service.sendRequest(requestData, true, req.signal ?? null);
                const content = result?.content;
                let text;
                if (typeof content === 'string') {
                    text = content;
                } else if (content != null) {
                    text = JSON.stringify(content);
                } else {
                    text = '';
                }

                /** @type {import('../../../ports/llm.port.js').LlmCompleteResult} */
                const out = { text };
                if (content != null && typeof content === 'object') {
                    out.json = content;
                }
                return Ok(out);
            } catch (cause) {
                if (isAbortError(cause) || req.signal?.aborted) {
                    return Err(upstreamFromHttpStatus(0, {
                        cause: toAbort(cause),
                        traceId,
                    }));
                }
                const preview = (cause instanceof Error ? cause.message : String(cause)).slice(0, 300);
                // 仅当消息里能解析出真实状态码时才映射为 UpstreamError；否则保守不可重试（D27）
                const status = parseHttpStatusFromMessage(preview);
                if (status != null) {
                    // D26：不覆盖中文 message；英文只进 cause / preview
                    return Err(upstreamFromHttpStatus(status, {
                        cause,
                        traceId,
                        context: {
                            transport: 'st-backend',
                            preview,
                        },
                    }));
                }
                return Err(transportError({
                    code: 'LLM_ST_BACKEND_FAILED',
                    message: '经酒馆 ChatCompletionService 调用失败',
                    hint: '请检查接口配置与模型可用性',
                    retryable: false,
                    cause,
                    traceId,
                    context: {
                        transport: 'st-backend',
                        preview,
                    },
                }));
            }
        },
    };
}

/**
 * ST 服务端期望 `json_schema: { name, value, strict?, description? }`
 *（chat-completions.js 多处读取 `.value` / `.name`）。
 * @param {unknown} jsonSchema
 * @returns {object|undefined}
 */
function toStJsonSchema(jsonSchema) {
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
    // 裸 JSON Schema
    return {
        name: 'response',
        strict: true,
        value: s,
    };
}

/**
 * 从宿主英文异常文案中解析 HTTP 状态码。
 * 解析不到则返回 null —— 调用方必须按「不可重试」处理（裁决 D27）。
 *
 * @param {string} message
 * @returns {number|null}
 */
function parseHttpStatusFromMessage(message) {
    const m = String(message);
    // 优先匹配显式数字状态码（含 "Got response status 503"）
    const digit = m.match(/\b([45]\d{2})\b/);
    if (digit) {
        return Number(digit[1]);
    }
    // 无数字时：仅映射语义明确且不可重试的鉴权词；绝不默认 5xx
    if (/unauthorized/i.test(m)) {
        return 401;
    }
    if (/forbidden/i.test(m)) {
        return 403;
    }
    return null;
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
