/**
 * live-ports：请求组装与本机路径（假 fetch，不访问外网）。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    LIVE_LLM_PATH,
    LIVE_NAI_PATH,
    LIVE_STATUS_PATH,
    LIVE_NAI_PLACEHOLDER_KEY,
    buildLiveLlmBody,
    createLiveLlmPort,
    createLiveImageGenPort,
    fetchLiveStatus,
} from '../../preview/live-ports.js';
import { isOk } from '../../src/infra/result.js';
import { DEFAULT_NAI_BASE_URL } from '../../src/domain/model/api-config.js';

describe('preview live-ports · request assembly', () => {
    it('buildLiveLlmBody 只带 messages / temperature / max_tokens', () => {
        const body = buildLiveLlmBody({
            messages: [{ role: 'user', content: 'hi' }],
            config: {
                id: 'llm-1',
                model: 'should-not-appear',
                baseUrl: 'https://should-not-appear.example/v1',
                secretId: 'secret-should-not-appear',
                temperature: 0.4,
                maxTokens: 256,
            },
            jsonSchema: { name: 'slot_plan_array', value: { type: 'array' } },
        });
        assert.deepEqual(body.messages, [{ role: 'user', content: 'hi' }]);
        assert.equal(body.temperature, 0.4);
        assert.equal(body.max_tokens, 256);
        assert.equal('json_schema' in body, false);
        const raw = JSON.stringify(body);
        assert.equal(raw.includes('should-not-appear'), false);
        assert.equal(raw.includes('secret-should-not-appear'), false);
        assert.equal('model' in body, false);
        assert.equal('baseUrl' in body, false);
        assert.equal('apiKey' in body, false);
    });

    it('complete POST 到 LIVE_LLM_PATH，且不带密钥字段', async () => {
        /** @type {Array<{ url: string, init: RequestInit }>} */
        const seen = [];
        const fetchMock = async (url, init = {}) => {
            seen.push({ url: String(url), init });
            return new Response(JSON.stringify({ text: '{"ok":true}' }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        };
        const llm = createLiveLlmPort({ fetch: fetchMock, model: 'from-status' });
        const result = await llm.complete({
            messages: [{ role: 'user', content: 'ping' }],
            config: {
                id: 'llm-1',
                model: 'browser-model',
                baseUrl: 'https://browser.example/v1',
                secretId: 'browser-secret',
                temperature: 0.2,
            },
            jsonSchema: { name: 'recall_positions' },
        });
        assert.equal(isOk(result), true);
        assert.equal(seen.length, 1);
        assert.equal(seen[0].url, LIVE_LLM_PATH);
        const posted = JSON.parse(String(seen[0].init.body));
        assert.equal(posted.messages[0].content, 'ping');
        assert.equal(posted.temperature, 0.2);
        assert.equal('json_schema' in posted, false);
        assert.equal('model' in posted, false);
        assert.equal('apiKey' in posted, false);
        assert.equal(result.value.json.ok, true);

        const models = await llm.listModels();
        assert.equal(isOk(models), true);
        assert.deepEqual(models.value.models, ['from-status']);
    });

    it('NAI generate 把 body POST 到 LIVE_NAI_PATH，且不转发 Authorization', async () => {
        /** @type {Array<{ url: string, init: RequestInit }>} */
        const seen = [];
        const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
        const fetchMock = async (url, init = {}) => {
            seen.push({ url: String(url), init });
            return new Response(JSON.stringify({
                images: [pngB64],
            }), {
                status: 201,
                headers: { 'Content-Type': 'application/json' },
            });
        };
        const imageGen = createLiveImageGenPort({ fetch: fetchMock });
        const result = await imageGen.generate(
            {
                input: '1girl',
                model: 'nai-diffusion-4-5-full',
                parameters: {
                    width: 512,
                    height: 768,
                    scale: 5,
                    sampler: 'k_euler',
                    steps: 28,
                    n_samples: 1,
                    ucPreset: 0,
                    qualityToggle: true,
                    negative_prompt: 'lowres',
                    params_version: 3,
                    legacy: false,
                    legacy_v3_extend: false,
                },
            },
            {
                config: {
                    id: 'nai-1',
                    name: 'NAI',
                    baseUrl: DEFAULT_NAI_BASE_URL,
                    apiKey: LIVE_NAI_PLACEHOLDER_KEY,
                    transport: 'direct',
                    decoder: 'json',
                },
                traceId: 't-live',
            },
        );
        assert.equal(isOk(result), true);
        assert.equal(seen.length, 1);
        assert.equal(seen[0].url, LIVE_NAI_PATH);
        const headers = /** @type {Record<string, string>} */ (seen[0].init.headers || {});
        const authKey = Object.keys(headers).find((k) => k.toLowerCase() === 'authorization');
        assert.equal(authKey, undefined);
        const posted = JSON.parse(String(seen[0].init.body));
        assert.equal(posted.input, '1girl');
        assert.equal(String(seen[0].init.body).includes(LIVE_NAI_PLACEHOLDER_KEY), false);
    });

    it('fetchLiveStatus 走 LIVE_STATUS_PATH；非 ok 返回原样对象', async () => {
        const fetchMock = async (url) => {
            assert.equal(String(url), LIVE_STATUS_PATH);
            return new Response(JSON.stringify({
                ok: false,
                missing: ['llm.apiKey', 'nai.apiKey'],
            }), { status: 200 });
        };
        const status = await fetchLiveStatus(fetchMock);
        assert.equal(status.ok, false);
        assert.deepEqual(status.missing, ['llm.apiKey', 'nai.apiKey']);
    });

    it('fetchLiveStatus 网络失败返回 null（维持假端口）', async () => {
        const status = await fetchLiveStatus(async () => {
            throw new Error('offline');
        });
        assert.equal(status, null);
    });
});
