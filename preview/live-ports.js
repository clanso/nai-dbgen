/**
 * 预览沙箱 · 真实 LLM / NAI 端口（经本机 live-server 代理，密钥不进浏览器）。
 * 形状对齐 fake-gateways：带 `_ctrl.setOnCall` / `getCalls` 供链路面板使用。
 */

import { Ok, Err } from '../src/infra/result.js';
import { assertLlmPort } from '../src/ports/llm.port.js';
import { assertImageGenPort } from '../src/ports/image-gen.port.js';
import {
    transportError,
    upstreamFromHttpStatus,
} from '../src/infra/errors.js';
import { extractJson } from '../src/adapters/llm/json-extract.js';
import { createNaiGateway } from '../src/adapters/nai/nai.gateway.js';
import { decodeJsonBase64 } from '../src/adapters/nai/decoder/json-base64.js';
import { decodeZip } from '../src/adapters/nai/decoder/zip.js';
import { DEFAULT_NAI_BASE_URL } from '../src/domain/model/api-config.js';
import { classifyLlmRequest } from './fake-gateways.js';

export const LIVE_STATUS_PATH = '/nai-dbgen/preview/live/status';
export const LIVE_LLM_PATH = '/nai-dbgen/preview/live/llm';
export const LIVE_NAI_PATH = '/nai-dbgen/preview/live/nai';

/** 浏览器侧 NAI 占位 Key：仅用于过网关校验，不得离开本机代理。 */
export const LIVE_NAI_PLACEHOLDER_KEY = 'local-proxy';

/**
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<object|null>}
 */
export async function fetchLiveStatus(fetchImpl = globalThis.fetch.bind(globalThis)) {
    if (typeof fetchImpl !== 'function') {
        return null;
    }
    try {
        const res = await fetchImpl(LIVE_STATUS_PATH, {
            method: 'GET',
            cache: 'no-store',
            headers: { Accept: 'application/json' },
        });
        if (!res || !res.ok) {
            return null;
        }
        const data = await res.json();
        return data && typeof data === 'object' ? data : null;
    } catch {
        return null;
    }
}

/**
 * 组装发给本机 `/live/llm` 的正文（不含 model / baseUrl / apiKey）。
 * @param {import('../src/ports/llm.port.js').LlmCompleteRequest} req
 * @returns {{ messages: object[], temperature?: number, max_tokens?: number }}
 */
export function buildLiveLlmBody(req) {
    /** @type {{ messages: object[], temperature?: number, max_tokens?: number }} */
    const body = {
        messages: Array.isArray(req?.messages) ? req.messages : [],
    };
    const config = req?.config;
    if (config && typeof config === 'object') {
        if (config.temperature != null) {
            body.temperature = config.temperature;
        }
        if (config.maxTokens != null) {
            body.max_tokens = config.maxTokens;
        }
    }
    return body;
}

/**
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetch]
 * @param {string} [opts.model] status 返回的模型名（listModels / probe 展示用）
 * @returns {import('../src/ports/llm.port.js').LlmPort & { _ctrl: object }}
 */
export function createLiveLlmPort(opts = {}) {
    const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    let statusModel = typeof opts.model === 'string' && opts.model.trim()
        ? opts.model.trim()
        : 'live-model';
    /** @type {Array<object>} */
    const calls = [];
    /** @type {((info: object) => void)|null} */
    let onCall = typeof opts.onCall === 'function' ? opts.onCall : null;

    const port = {
        _ctrl: {
            setMode() {
                // 真实模式：调试下拉无效
            },
            getMode() {
                return 'ok';
            },
            setDelayMs() {},
            getDelayMs() {
                return 0;
            },
            getCalls() {
                return [...calls];
            },
            clearCalls() {
                calls.length = 0;
            },
            setOnCall(fn) {
                onCall = typeof fn === 'function' ? fn : null;
            },
            setStatusModel(name) {
                if (typeof name === 'string' && name.trim()) {
                    statusModel = name.trim();
                }
            },
        },

        async complete(req) {
            const traceId = req?.traceId ?? null;
            const kind = classifyLlmRequest(req);
            const started = Date.now();
            const entry = {
                kind,
                traceId,
                configId: req?.config?.id ?? null,
                config: req?.config ?? null,
                messages: req?.messages ?? [],
                schema: req?.jsonSchema?.name ?? null,
                startedAt: started,
            };
            calls.push(entry);
            onCall?.({ phase: 'start', ...entry });

            if (req?.signal?.aborted) {
                const err = Err(upstreamFromHttpStatus(0, {
                    code: 'UPSTREAM_ABORTED',
                    message: '请求已取消',
                    cause: Object.assign(new Error('Aborted'), { name: 'AbortError' }),
                    traceId,
                }));
                entry.error = err.error;
                entry.finishedAt = Date.now();
                onCall?.({ phase: 'error', ...entry });
                return err;
            }

            const body = buildLiveLlmBody(req);
            try {
                const res = await fetchImpl(LIVE_LLM_PATH, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json',
                    },
                    body: JSON.stringify(body),
                    signal: req?.signal,
                });
                const payload = await res.json().catch(() => ({}));
                if (!res.ok) {
                    const err = Err(upstreamFromHttpStatus(res.status, {
                        message: typeof payload?.error === 'string'
                            ? payload.error
                            : `本机 LLM 代理失败（HTTP ${res.status}）`,
                        hint: '请检查 preview/live-api.local.json 与 live-server',
                        traceId,
                    }));
                    entry.error = err.error;
                    entry.finishedAt = Date.now();
                    onCall?.({ phase: 'error', ...entry });
                    return err;
                }
                const text = typeof payload?.text === 'string' ? payload.text : '';
                /** @type {{ text: string, json?: unknown }} */
                const value = { text };
                const extracted = extractJson(text);
                if (extracted.ok) {
                    value.json = extracted.value;
                }
                const result = Ok(value);
                entry.result = result.value;
                entry.finishedAt = Date.now();
                onCall?.({ phase: 'ok', ...entry });
                return result;
            } catch (cause) {
                if (req?.signal?.aborted || (cause && /** @type {Error} */ (cause).name === 'AbortError')) {
                    const err = Err(upstreamFromHttpStatus(0, {
                        code: 'UPSTREAM_ABORTED',
                        message: '请求已取消',
                        cause,
                        traceId,
                    }));
                    entry.error = err.error;
                    entry.finishedAt = Date.now();
                    onCall?.({ phase: 'error', ...entry });
                    return err;
                }
                const err = Err(transportError({
                    code: 'LIVE_LLM_FETCH_FAILED',
                    message: '无法连接本机 LLM 代理',
                    hint: '请确认 npm run preview 使用 live-server，且端口 8765 可达',
                    cause,
                    traceId,
                    retryable: true,
                }));
                entry.error = err.error;
                entry.finishedAt = Date.now();
                onCall?.({ phase: 'error', ...entry });
                return err;
            }
        },

        async listModels() {
            return Ok({ models: [statusModel], count: 1 });
        },

        async probe() {
            return {
                ok: true,
                transport: 'live-proxy',
                decoder: 'json-extract',
                detail: `本机 live LLM 就绪（${statusModel}）`,
                context: { models: [statusModel], count: 1 },
            };
        },
    };

    const check = assertLlmPort(port);
    if (!check.ok) {
        throw new Error(`createLiveLlmPort: ${check.error?.message}`);
    }
    return port;
}

/**
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetch]
 * @returns {import('../src/ports/image-gen.port.js').ImageGenPort & { _ctrl: object }}
 */
export function createLiveImageGenPort(opts = {}) {
    const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
    /** @type {Array<object>} */
    const calls = [];
    /** @type {((info: object) => void)|null} */
    let onCall = typeof opts.onCall === 'function' ? opts.onCall : null;

    const transport = {
        name: 'direct',
        /**
         * 把 NAI 生图 JSON 转到本机代理；不转发 Authorization（占位 Key 不得离开浏览器）。
         * @param {string} _url
         * @param {RequestInit} init
         */
        async send(_url, init = {}) {
            try {
                const res = await fetchImpl(LIVE_NAI_PATH, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Accept: 'application/json, application/zip, application/octet-stream',
                    },
                    body: init.body,
                    signal: init.signal,
                });
                const body = await res.arrayBuffer();
                return Ok({
                    status: res.status,
                    headers: res.headers,
                    body,
                });
            } catch (cause) {
                if (init.signal?.aborted || (cause && /** @type {Error} */ (cause).name === 'AbortError')) {
                    return Err(transportError({
                        code: 'NAI_ABORTED',
                        message: '生图请求已取消',
                        hint: null,
                        retryable: false,
                        cause,
                    }));
                }
                return Err(transportError({
                    code: 'LIVE_NAI_FETCH_FAILED',
                    message: '无法连接本机 NAI 代理',
                    hint: '请确认 npm run preview 使用 live-server，且端口 8765 可达',
                    retryable: true,
                    cause,
                    context: { transport: 'direct' },
                }));
            }
        },
    };

    const gateway = createNaiGateway({
        transports: { direct: transport },
        decoders: {
            'json-base64': { decode: decodeJsonBase64 },
            zip: { decode: decodeZip },
        },
        maxAttempts: 1,
    });

    const port = {
        _ctrl: {
            setMode() {},
            getMode() {
                return 'ok';
            },
            setDelayMs() {},
            getDelayMs() {
                return 0;
            },
            getCalls() {
                return [...calls];
            },
            clearCalls() {
                calls.length = 0;
            },
            setOnCall(fn) {
                onCall = typeof fn === 'function' ? fn : null;
            },
        },

        async generate(req, optsIn = {}) {
            const traceId = optsIn?.traceId ?? null;
            const started = Date.now();
            const entry = {
                traceId,
                configId: optsIn?.config?.id ?? null,
                width: req?.parameters?.width ?? req?.width ?? null,
                height: req?.parameters?.height ?? req?.height ?? null,
                startedAt: started,
            };
            calls.push(entry);
            onCall?.({ phase: 'start', ...entry });

            const config = {
                ...(optsIn?.config && typeof optsIn.config === 'object' ? optsIn.config : {}),
                baseUrl: DEFAULT_NAI_BASE_URL,
                transport: 'direct',
                apiKey: LIVE_NAI_PLACEHOLDER_KEY,
            };
            const result = await gateway.generate(req, {
                ...optsIn,
                config,
            });
            entry.finishedAt = Date.now();
            if (result.ok) {
                const images = result.value;
                entry.result = {
                    count: Array.isArray(images) ? images.length : 0,
                    mimeType: images?.[0]?.mimeType ?? null,
                };
                onCall?.({ phase: 'ok', ...entry });
            } else {
                entry.error = result.error;
                onCall?.({ phase: 'error', ...entry });
            }
            return result;
        },

        async probe() {
            return {
                ok: true,
                transport: 'direct',
                decoder: 'json-base64',
                detail: '本机 live NAI 代理就绪',
            };
        },
    };

    const check = assertImageGenPort(port);
    if (!check.ok) {
        throw new Error(`createLiveImageGenPort: ${check.error?.message}`);
    }
    return port;
}

/**
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetch]
 * @param {string} [opts.model]
 * @returns {{ llm: ReturnType<typeof createLiveLlmPort>, imageGen: ReturnType<typeof createLiveImageGenPort> }}
 */
export function createLivePorts(opts = {}) {
    return {
        llm: createLiveLlmPort(opts),
        imageGen: createLiveImageGenPort(opts),
    };
}

/**
 * status.ok 时把活跃 LLM 的 model 写成 status 模型名；NAI 用官方地址 + 占位 Key。
 * 密钥不写入 IDB。
 * @param {object} args
 * @param {object} args.container
 * @param {string} args.llmConfigId
 * @param {string} args.naiConfigId
 * @param {string} args.model
 */
export async function applyLiveDisplayConfigs(args) {
    const {
        container, llmConfigId, naiConfigId, model,
    } = args;
    const llmRepo = container?.repos?.llmConfig;
    const naiRepo = container?.repos?.naiConfig;
    const now = new Date().toISOString();

    if (llmRepo && typeof llmRepo.get === 'function' && typeof llmRepo.put === 'function') {
        const got = await llmRepo.get(llmConfigId);
        if (got?.ok && got.value) {
            await llmRepo.put({
                ...got.value,
                model: String(model || got.value.model || ''),
                updatedAt: now,
            });
        }
    }

    if (naiRepo && typeof naiRepo.get === 'function' && typeof naiRepo.put === 'function') {
        const got = await naiRepo.get(naiConfigId);
        if (got?.ok && got.value) {
            await naiRepo.put({
                ...got.value,
                baseUrl: DEFAULT_NAI_BASE_URL,
                transport: 'direct',
                apiKey: LIVE_NAI_PLACEHOLDER_KEY,
                updatedAt: now,
            });
        }
    }
}
