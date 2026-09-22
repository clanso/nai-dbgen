/**
 * W1-C · NAI / LLM 网关：错误映射、重试、代理探测（假 fetch，不联网）
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createNaiGateway } from '../../src/adapters/nai/nai.gateway.js';
import { createDirectTransport } from '../../src/adapters/nai/transport/direct.js';
import { createStCorsProxyTransport } from '../../src/adapters/nai/transport/st-cors-proxy.js';
import { decodeJsonBase64 } from '../../src/adapters/nai/decoder/json-base64.js';
import { decodeZip } from '../../src/adapters/nai/decoder/zip.js';
import { createLlmGateway } from '../../src/adapters/llm/llm.gateway.js';
import { createDirectLlmTransport } from '../../src/adapters/llm/transport/direct.js';
import { createStBackendLlmTransport } from '../../src/adapters/llm/transport/st-backend.js';
import { extractJson } from '../../src/adapters/llm/json-extract.js';
import { isOk, isErr } from '../../src/infra/result.js';
import { ERROR_CATEGORY } from '../../src/infra/errors.js';
import { assertImageGenPort } from '../../src/ports/image-gen.port.js';
import { assertLlmPort } from '../../src/ports/llm.port.js';

function naiConfig(overrides = {}) {
    return {
        schemaVersion: 1,
        id: 'n1',
        name: 'test',
        baseUrl: 'https://image.novelai.net',
        apiKey: 'pst-secret-token-do-not-log',
        transport: 'direct',
        decoder: 'json',
        createdAt: 't',
        updatedAt: 't',
        ...overrides,
    };
}

function llmConfig(overrides = {}) {
    return {
        schemaVersion: 1,
        id: 'l1',
        name: 'test',
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'sk-secret-do-not-log',
        model: 'gpt-test',
        transport: 'direct',
        createdAt: 't',
        updatedAt: 't',
        ...overrides,
    };
}

const samplePngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('createNaiGateway', () => {
    it('assertImageGenPort passes', () => {
        const gw = createNaiGateway({
            transports: {
                direct: createDirectTransport({ fetch: async () => new Response('{}') }),
            },
            decoders: {
                'json-base64': { decode: decodeJsonBase64 },
                zip: { decode: decodeZip },
            },
        });
        const checked = assertImageGenPort(gw);
        assert.equal(isOk(checked), true);
    });

    it('maps 401 via upstreamFromHttpStatus and does not retry', async () => {
        let calls = 0;
        const fetchMock = async () => {
            calls += 1;
            return new Response('{"message":"no"}', { status: 401 });
        };
        const gw = createNaiGateway({
            transports: { direct: createDirectTransport({ fetch: fetchMock }) },
            decoders: {
                'json-base64': { decode: decodeJsonBase64 },
                zip: { decode: decodeZip },
            },
            maxAttempts: 3,
            sleep: async () => {},
        });
        const result = await gw.generate(
            { input: 'a', model: 'm', parameters: {} },
            { config: naiConfig() },
        );
        assert.equal(isErr(result), true);
        assert.equal(result.error.code, 'NAI_401');
        assert.equal(result.error.retryable, false);
        assert.equal(result.error.context.disableConfig, true);
        assert.equal(calls, 1);
        assert.equal(JSON.stringify(result.error).includes('pst-secret'), false);
    });

    it('retries 429 respecting Retry-After', async () => {
        let calls = 0;
        const waits = [];
        const fetchMock = async () => {
            calls += 1;
            if (calls === 1) {
                return new Response('rate', {
                    status: 429,
                    headers: { 'Retry-After': '7' },
                });
            }
            return new Response(JSON.stringify({
                images: [{ image: samplePngB64, seed: 1 }],
            }), { status: 201 });
        };
        const gw = createNaiGateway({
            transports: { direct: createDirectTransport({ fetch: fetchMock }) },
            decoders: {
                'json-base64': { decode: decodeJsonBase64 },
                zip: { decode: decodeZip },
            },
            maxAttempts: 3,
            sleep: async (ms) => { waits.push(ms); },
        });
        const result = await gw.generate(
            { input: 'a', model: 'm', parameters: {} },
            { config: naiConfig() },
        );
        assert.equal(isOk(result), true);
        assert.equal(calls, 2);
        assert.equal(waits[0], 7000);
    });

    it('st-cors-proxy probe reports enableCorsProxy hint when disabled', async () => {
        const fetchMock = async (url) => {
            if (String(url).includes('/proxy/')) {
                return new Response(
                    'CORS proxy is disabled. Enable it in config.yaml or use the --corsProxy flag.',
                    { status: 404 },
                );
            }
            return new Response('unexpected', { status: 500 });
        };
        const proxy = createStCorsProxyTransport({ fetch: fetchMock });
        const gw = createNaiGateway({
            transports: {
                direct: createDirectTransport({
                    fetch: async () => { throw new TypeError('Failed to fetch'); },
                }),
                'st-cors-proxy': proxy,
            },
            decoders: {
                'json-base64': { decode: decodeJsonBase64 },
                zip: { decode: decodeZip },
            },
        });
        const report = await gw.probe(naiConfig({ transport: 'st-cors-proxy' }));
        assert.equal(report.ok, false);
        assert.equal(report.error.code, 'NAI_CORS_PROXY_DISABLED');
        assert.match(report.error.hint, /enableCorsProxy/);
        assert.match(report.error.hint, /config\.yaml/);
    });

    it('does not put apiKey into Authorization log context on success path headers check', async () => {
        /** @type {RequestInit|null} */
        let seenInit = null;
        const fetchMock = async (_url, init) => {
            seenInit = init;
            return new Response(JSON.stringify({
                images: [{ image: samplePngB64 }],
            }), { status: 201 });
        };
        const gw = createNaiGateway({
            transports: { direct: createDirectTransport({ fetch: fetchMock }) },
            decoders: {
                'json-base64': { decode: decodeJsonBase64 },
                zip: { decode: decodeZip },
            },
        });
        const result = await gw.generate(
            { input: 'a', model: 'm', parameters: {} },
            { config: naiConfig() },
        );
        assert.equal(isOk(result), true);
        assert.ok(String(seenInit?.headers?.Authorization).includes('Bearer '));
        // 凭证只在请求头，不在 Result / Error 里
        assert.equal(JSON.stringify(result).includes('pst-secret'), false);
    });

    it('propagates AbortSignal as non-retryable', async () => {
        const ac = new AbortController();
        ac.abort();
        const gw = createNaiGateway({
            transports: {
                direct: createDirectTransport({
                    fetch: async () => new Response('{}', { status: 200 }),
                }),
            },
            decoders: {
                'json-base64': { decode: decodeJsonBase64 },
                zip: { decode: decodeZip },
            },
        });
        const result = await gw.generate(
            { input: 'a', model: 'm', parameters: {} },
            { config: naiConfig(), signal: ac.signal },
        );
        assert.equal(isErr(result), true);
        assert.equal(result.error.retryable, false);
        assert.equal(result.error.code, 'UPSTREAM_ABORTED');
    });
});

describe('createLlmGateway', () => {
    it('assertLlmPort passes', () => {
        const gw = createLlmGateway({
            transports: {
                direct: createDirectLlmTransport({
                    fetch: async () => new Response(JSON.stringify({
                        choices: [{ message: { content: '{}' } }],
                    })),
                }),
            },
            extractJson,
        });
        assert.equal(isOk(assertLlmPort(gw)), true);
    });

    it('direct transport posts to normalized chat/completions URL', async () => {
        /** @type {string[]} */
        const urls = [];
        const fetchMock = async (url) => {
            urls.push(String(url));
            return new Response(JSON.stringify({
                choices: [{ message: { content: '{"ok":true}' } }],
            }), { status: 200 });
        };
        const gw = createLlmGateway({
            transports: {
                direct: createDirectLlmTransport({ fetch: fetchMock }),
            },
            extractJson,
        });
        const result = await gw.complete({
            messages: [{ role: 'user', content: 'hi' }],
            config: llmConfig({ baseUrl: 'https://api.example.com/v1' }),
            jsonSchema: { type: 'object', properties: {} },
        });
        assert.equal(isOk(result), true);
        assert.equal(urls[0], 'https://api.example.com/v1/chat/completions');
        assert.deepEqual(result.value.json, { ok: true });
        assert.equal(JSON.stringify(result).includes('sk-secret'), false);
    });

    it('st-backend uses ChatCompletionService with reverse_proxy + proxy_password', async () => {
        /** @type {object|null} */
        let seenData = null;
        const getContext = () => ({
            ChatCompletionService: {
                createRequestData(data) {
                    return { ...data, use_sysprompt: true };
                },
                async sendRequest(data) {
                    seenData = data;
                    return { content: '```json\n{"keys":["a"]}\n```' };
                },
            },
        });
        const gw = createLlmGateway({
            transports: {
                'st-backend': createStBackendLlmTransport({ getContext }),
            },
            extractJson,
        });
        const result = await gw.complete({
            messages: [{ role: 'user', content: 'recall' }],
            config: llmConfig({
                transport: 'st-backend',
                baseUrl: 'https://llm.example.com',
            }),
            jsonSchema: { name: 'keys', value: { type: 'object' } },
        });
        assert.equal(isOk(result), true);
        assert.equal(seenData.chat_completion_source, 'openai');
        assert.equal(seenData.reverse_proxy, 'https://llm.example.com');
        assert.equal(seenData.proxy_password, 'sk-secret-do-not-log');
        assert.equal(seenData.stream, false);
        assert.deepEqual(result.value.json, { keys: ['a'] });
        // 错误/结果对象不回传 key
        assert.equal(JSON.stringify(result).includes('sk-secret'), false);
    });

    it('ContractError preserves raw LLM text when extract fails', async () => {
        const gw = createLlmGateway({
            transports: {
                direct: createDirectLlmTransport({
                    fetch: async () => new Response(JSON.stringify({
                        choices: [{ message: { content: '抱歉我不能输出 JSON' } }],
                    })),
                }),
            },
            extractJson,
        });
        const result = await gw.complete({
            messages: [{ role: 'user', content: 'x' }],
            config: llmConfig(),
            jsonSchema: { type: 'object' },
        });
        assert.equal(isErr(result), true);
        assert.equal(result.error.category, ERROR_CATEGORY.CONTRACT);
        assert.equal(result.error.context.rawText, '抱歉我不能输出 JSON');
    });

    it('retries retryable upstream then succeeds', async () => {
        let calls = 0;
        const gw = createLlmGateway({
            transports: {
                direct: createDirectLlmTransport({
                    fetch: async () => {
                        calls += 1;
                        if (calls === 1) {
                            return new Response('busy', { status: 503 });
                        }
                        return new Response(JSON.stringify({
                            choices: [{ message: { content: 'done' } }],
                        }));
                    },
                }),
            },
            extractJson,
            maxAttempts: 3,
            sleep: async () => {},
        });
        const result = await gw.complete({
            messages: [{ role: 'user', content: 'x' }],
            config: llmConfig(),
        });
        assert.equal(isOk(result), true);
        assert.equal(result.value.text, 'done');
        assert.equal(calls, 2);
    });
});
