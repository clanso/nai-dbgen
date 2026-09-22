/**
 * L2 适配器 · LlmPort 实现（默认 st-backend，可选 direct）。
 * 归属：W1-C 网关代理实现。W0 仅冻结签名。
 */

import { Ok, Err, isOk, isErr } from '../../infra/result.js';
import {
    configError,
    transportError,
    upstreamFromHttpStatus,
} from '../../infra/errors.js';
import { extractJson as defaultExtractJson } from './json-extract.js';

const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60000;

/**
 * @typedef {import('../../ports/llm.port.js').LlmGatewayDeps} LlmGatewayDeps
 */

/**
 * @param {LlmGatewayDeps} deps
 * @returns {import('../../ports/llm.port.js').LlmPort}
 */
export function createLlmGateway(deps) {
    if (!deps || typeof deps !== 'object') {
        throw new Error('invalid argument: deps');
    }
    const transports = deps.transports ?? {};
    const extractJsonFn = typeof deps.extractJson === 'function'
        ? deps.extractJson
        : defaultExtractJson;
    const maxAttempts = Number(deps.maxAttempts) > 0
        ? Number(deps.maxAttempts)
        : DEFAULT_MAX_ATTEMPTS;
    const sleepFn = typeof deps.sleep === 'function' ? deps.sleep : sleep;

    return {
        async complete(req) {
            const config = req?.config;
            const traceId = req?.traceId ?? null;

            if (!config || typeof config !== 'object') {
                return Err(configError({
                    code: 'LLM_CONFIG_MISSING',
                    message: '未提供 LLM 接口配置',
                    hint: '请先在 LLM API 库中配置并选择当前项',
                    traceId,
                }));
            }

            const transportName = config.transport === 'direct' ? 'direct' : 'st-backend';
            const transport = transports[transportName];
            if (!transport || typeof transport.complete !== 'function') {
                return Err(configError({
                    code: 'LLM_TRANSPORT_MISSING',
                    message: `未注册 LLM 传输：${transportName}`,
                    hint: '请检查 container 传输注册表',
                    traceId,
                    context: { transport: transportName },
                }));
            }

            /** @type {import('../../infra/errors.js').AppError|null} */
            let lastError = null;

            for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
                if (req.signal?.aborted) {
                    return Err(upstreamFromHttpStatus(0, {
                        cause: abortCause(req.signal),
                        traceId,
                    }));
                }

                const result = await transport.complete(req);
                if (isErr(result)) {
                    const err = stampTrace(result.error, traceId);
                    if (!err.retryable || attempt === maxAttempts - 1) {
                        return Err(err);
                    }
                    lastError = err;
                    const waitMs = backoffMs(attempt, err.context?.retryAfterSec);
                    const waited = await safeSleep(sleepFn, waitMs, req.signal, traceId);
                    if (isErr(waited)) {
                        return waited;
                    }
                    continue;
                }

                const value = result.value;
                let text = value?.text ?? '';
                let json = value?.json;

                // 若调用方要结构化输出且尚未有 json：容错提取（R-06）
                if (json === undefined && req.jsonSchema != null) {
                    const extracted = extractJsonFn(text);
                    if (isOk(extracted)) {
                        json = extracted.value;
                    } else {
                        const err = stampTrace(extracted.error, traceId);
                        if (!err.context) {
                            err.context = {};
                        }
                        if (err.context.rawText == null) {
                            err.context.rawText = text;
                        }
                        return Err(err);
                    }
                } else if (json === undefined && looksLikeJson(text)) {
                    const extracted = extractJsonFn(text);
                    if (isOk(extracted)) {
                        json = extracted.value;
                    }
                }

                /** @type {import('../../ports/llm.port.js').LlmCompleteResult} */
                const out = { text };
                if (json !== undefined) {
                    out.json = json;
                }
                return Ok(out);
            }

            return Err(stampTrace(lastError, traceId) ?? transportError({
                code: 'LLM_COMPLETE_FAILED',
                message: 'LLM 调用失败',
                traceId,
            }));
        },

        async probe(config) {
            if (!config || typeof config !== 'object') {
                const error = configError({
                    code: 'LLM_CONFIG_MISSING',
                    message: '未提供 LLM 接口配置',
                });
                return {
                    ok: false,
                    transport: '',
                    decoder: 'json-extract',
                    detail: error.message,
                    error,
                };
            }

            const preferred = config.transport === 'direct' ? 'direct' : 'st-backend';
            const order = preferred === 'st-backend'
                ? ['st-backend', 'direct']
                : ['direct', 'st-backend'];

            /** @type {import('../../infra/errors.js').AppError|null} */
            let lastError = null;

            for (const name of order) {
                const transport = transports[name];
                if (!transport || typeof transport.complete !== 'function') {
                    continue;
                }

                const result = await transport.complete({
                    messages: [{ role: 'user', content: 'ping' }],
                    config: { ...config, transport: name },
                    // 探测不强制 schema，避免中转因 json_schema 直接 400
                });

                if (isOk(result)) {
                    return {
                        ok: true,
                        transport: name,
                        decoder: 'json-extract',
                        detail: `通道 ${name} 可达`,
                    };
                }

                lastError = result.error;
                // 401/403：通道通但鉴权失败，仍算「传输可用」
                if (lastError.context?.status === 401 || lastError.context?.status === 403) {
                    return {
                        ok: true,
                        transport: name,
                        decoder: 'json-extract',
                        detail: `通道 ${name} 可达，但鉴权失败（请检查 Key）`,
                        error: lastError,
                    };
                }
            }

            return {
                ok: false,
                transport: preferred,
                decoder: 'json-extract',
                detail: lastError?.message ?? '所有 LLM 传输均不可用',
                error: lastError ?? transportError({
                    code: 'LLM_PROBE_FAILED',
                    message: 'LLM 连通性自检失败',
                }),
            };
        },
    };
}

/**
 * 确保 AppError.traceId 不为空（裁决 D14 / 架构 §10）。
 * @template {import('../../infra/errors.js').AppError} E
 * @param {E|null|undefined} err
 * @param {string|null} traceId
 * @returns {E|null|undefined}
 */
function stampTrace(err, traceId) {
    if (err && traceId && !err.traceId) {
        err.traceId = traceId;
    }
    return err;
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function looksLikeJson(text) {
    const t = String(text || '').trim();
    return t.startsWith('{') || t.startsWith('[') || t.includes('```');
}

/**
 * @param {number} attempt
 * @param {unknown} retryAfterSec
 * @returns {number}
 */
function backoffMs(attempt, retryAfterSec) {
    const sec = Number(retryAfterSec);
    if (Number.isFinite(sec) && sec > 0) {
        return Math.min(MAX_BACKOFF_MS, Math.floor(sec * 1000));
    }
    return Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * (2 ** attempt)) + Math.floor(Math.random() * 500);
}

/**
 * @param {(ms: number, signal?: AbortSignal) => Promise<void>} sleepFn
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @param {string|null} traceId
 */
async function safeSleep(sleepFn, ms, signal, traceId) {
    try {
        await sleepFn(ms, signal);
        return Ok(true);
    } catch (cause) {
        return Err(upstreamFromHttpStatus(0, {
            cause: isAbortError(cause) ? /** @type {Error} */ (cause) : abortCause(signal),
            traceId,
        }));
    }
}

/**
 * @param {number} ms
 * @param {AbortSignal} [signal]
 */
function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(abortCause(signal));
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, Math.max(0, ms));
        function onAbort() {
            clearTimeout(timer);
            reject(abortCause(signal));
        }
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

/**
 * @param {AbortSignal} [signal]
 * @returns {Error}
 */
function abortCause(signal) {
    const reason = signal?.reason;
    if (reason instanceof Error) {
        if (reason.name !== 'AbortError') {
            reason.name = 'AbortError';
        }
        return reason;
    }
    const err = new Error('aborted');
    err.name = 'AbortError';
    return err;
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
