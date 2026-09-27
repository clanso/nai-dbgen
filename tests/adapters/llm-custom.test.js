/**
 * LLM custom 来源：请求体构造、密钥保护、拉模型、完整 yaml。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import {
    createLlmApiConfig,
    validateLlmApiConfig,
    llmConfigForExport,
    llmConfigHasKey,
    LLM_SECRET_KEY,
} from '../../src/domain/model/api-config.js';
import {
    buildCustomChatCompletionRequest,
    buildCustomStatusRequest,
    buildIncludeBody,
    extractModelIdsFromStatus,
} from '../../src/adapters/llm/request-data.js';
import { createLlmSecretsStore } from '../../src/adapters/llm/secrets-store.js';
import { createStBackendLlmTransport } from '../../src/adapters/llm/transport/st-backend.js';
import { createLlmGateway } from '../../src/adapters/llm/llm.gateway.js';
import {
    parseYamlObject,
    parseYamlArray,
    yamlApiFromModule,
} from '../../src/adapters/host/st-yaml.js';

const yaml = yamlApiFromModule(YAML);

function baseLlm(overrides = {}) {
    return createLlmApiConfig({
        name: '测试 LLM',
        baseUrl: 'https://api.example.com/v1',
        secretId: 'sec-1',
        model: 'gpt-test',
        ...overrides,
    }, { id: 'llm-1', now: '2026-01-01T00:00:00.000Z' });
}

describe('LLM request-data', () => {
    it('留空的生成参数不出现在请求体；只填温度与最大回复长度时请求体只多这两项', () => {
        const cfg = baseLlm({
            temperature: 0.7,
            maxTokens: 1024,
            apiKey: 'sk-test',
        });
        const body = buildCustomChatCompletionRequest(cfg, {
            messages: [{ role: 'user', content: 'hi' }],
            yaml,
        });
        assert.equal(body.chat_completion_source, 'custom');
        assert.equal(body.custom_url, 'https://api.example.com/v1');
        assert.equal(body.custom_include_headers, 'Authorization: "Bearer sk-test"');
        assert.equal('secret_id' in body, false);
        assert.equal('reverse_proxy' in body, false);
        assert.equal('proxy_password' in body, false);
        assert.equal(body.model, 'gpt-test');
        assert.equal(body.temperature, 0.7);
        assert.equal(body.max_tokens, 1024);
        assert.equal('top_p' in body, false);
        assert.equal('custom_include_body' in body, false);
        assert.deepEqual(Object.keys(body).sort(), [
            'chat_completion_source',
            'custom_include_headers',
            'custom_url',
            'max_tokens',
            'messages',
            'model',
            'stream',
            'temperature',
            'use_sysprompt',
        ].sort());
    });

    it('无推理强度时追加请求体原文原样发出', () => {
        const raw = 'nested:\n  a: 1\n# keep comment line is user text\nfoo: "bar baz"\n';
        const cfg = baseLlm({ customIncludeBody: raw });
        assert.equal(buildIncludeBody(cfg, yaml), raw);
        const body = buildCustomChatCompletionRequest(cfg, {
            messages: [{ role: 'user', content: 'x' }],
            yaml,
        });
        assert.equal(body.custom_include_body, raw);
    });

    it('推理强度经 custom_include_body 合并；用户原文优先', () => {
        const cfg = baseLlm({
            reasoningEffort: 'high',
            customIncludeBody: 'reasoning_effort: low\nfoo: 1\nnested:\n  x: 2',
        });
        const include = buildIncludeBody(cfg, yaml);
        assert.ok(include);
        const parsed = yaml.parse(include);
        assert.equal(parsed.reasoning_effort, 'low');
        assert.equal(parsed.foo, 1);
        assert.deepEqual(parsed.nested, { x: 2 });

        const body = buildCustomChatCompletionRequest(cfg, {
            messages: [{ role: 'user', content: 'x' }],
            yaml,
        });
        assert.equal(body.custom_include_body, include);
        assert.equal('reasoning_effort' in body, false);
    });

    it('仅填推理强度时 include_body 含 reasoning_effort', () => {
        const cfg = baseLlm({ reasoningEffort: 'medium' });
        const body = buildCustomChatCompletionRequest(cfg, {
            messages: [{ role: 'user', content: 'x' }],
            yaml,
        });
        assert.deepEqual(yaml.parse(String(body.custom_include_body)), {
            reasoning_effort: 'medium',
        });
    });

    it('附加请求头与排除字段透传', () => {
        const cfg2 = baseLlm({
            customIncludeHeaders: 'X-Test: "1"',
            customExcludeBody: '- temperature',
            customPromptPostProcessing: 'merge',
        });
        const body = buildCustomChatCompletionRequest(cfg2, {
            messages: [{ role: 'user', content: 'x' }],
            yaml,
        });
        assert.equal(body.custom_include_headers, 'X-Test: "1"');
        assert.equal(body.custom_exclude_body, '- temperature');
        assert.equal(body.custom_prompt_post_processing, 'merge');
    });

    it('拉模型把密钥放进 Authorization，地址原样交给 custom', () => {
        const body = buildCustomStatusRequest({
            baseUrl: 'https://api.deepseek.com',
            apiKey: 'sk-test',
            secretId: 'sec-1',
            customIncludeHeaders: 'X-Test: "1"',
        });
        assert.equal(body.chat_completion_source, 'custom');
        assert.equal(body.custom_url, 'https://api.deepseek.com');
        assert.equal(body.custom_include_headers, 'Authorization: "Bearer sk-test"\nX-Test: "1"');
        assert.equal('secret_id' in body, false);
        assert.equal('reverse_proxy' in body, false);
    });

    it('官方地址不加 /v1，末尾斜杠去掉', () => {
        const body = buildCustomChatCompletionRequest(baseLlm({
            baseUrl: 'https://api.deepseek.com/',
            apiKey: 'sk-test',
            customIncludeBody: 'reasoning_effort: high',
        }), {
            messages: [{ role: 'user', content: 'hi' }],
            yaml,
        });
        assert.equal(body.custom_url, 'https://api.deepseek.com');
        assert.equal(body.chat_completion_source, 'custom');
        assert.equal(body.custom_include_body, 'reasoning_effort: high');
        assert.equal(body.custom_include_headers, 'Authorization: "Bearer sk-test"');
    });
});

describe('LLM config model + yaml', () => {
    it('无 secretId 视为未填 Key；导出不含 secretId', () => {
        const cfg = baseLlm({ secretId: null });
        assert.equal(llmConfigHasKey(cfg), false);
        const exported = llmConfigForExport(cfg);
        assert.equal('secretId' in exported, false);
        assert.equal('apiKey' in exported, false);
        assert.equal('transport' in exported, false);
    });

    it('无 yaml 注入时有 YAML 字段则校验失败', () => {
        const r = validateLlmApiConfig(baseLlm({
            customIncludeBody: 'foo: 1',
        }));
        assert.equal(r.ok, false);
        assert.match(r.error.message, /YAML 解析器不可用/);
    });

    it('YAML 列表误作对象时校验失败', () => {
        const r = validateLlmApiConfig({
            ...baseLlm(),
            customIncludeBody: '- only\n- list',
        }, { yaml });
        assert.equal(r.ok, false);
        assert.match(r.error.message, /追加请求体|YAML/);
    });

    it('合法嵌套 / 引号 / 行内 {} [] / 注释 通过', () => {
        const body = [
            '# comment ok',
            'top_k: 20',
            'nested:',
            '  a: "quoted value"',
            'inline_obj: { k: 1, t: true }',
            'inline_arr: [1, 2, three]',
        ].join('\n');
        const r = validateLlmApiConfig(baseLlm({
            customIncludeBody: body,
            customExcludeBody: '- frequency_penalty\n- presence_penalty',
            customIncludeHeaders: 'X-Custom-Header: value',
        }), { yaml });
        assert.equal(r.ok, true);

        const obj = parseYamlObject(yaml, body);
        assert.equal(obj.ok, true);
        assert.equal(obj.value.top_k, 20);
        assert.equal(obj.value.nested.a, 'quoted value');
        assert.deepEqual(obj.value.inline_obj, { k: 1, t: true });
        assert.deepEqual(obj.value.inline_arr, [1, 2, 'three']);

        const arr = parseYamlArray(yaml, '- frequency_penalty\n- presence_penalty');
        assert.equal(arr.ok, true);
        assert.deepEqual(arr.value, ['frequency_penalty', 'presence_penalty']);
    });
});

describe('LLM secrets store', () => {
    it('写入不改变原激活项；换 Key 删旧；删配置删密钥；失败不静默', async () => {
        /** @type {Array<{id:string,value:string,label:string,active:boolean}>} */
        let secrets = [
            { id: 'main', value: 'sk-main', label: '主连接', active: true },
        ];

        const store = createLlmSecretsStore({
            secretKey: LLM_SECRET_KEY,
            getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
            fetch: async (url, init) => {
                const path = String(url);
                const body = init?.body ? JSON.parse(String(init.body)) : {};
                if (path.includes('/read')) {
                    return new Response(JSON.stringify({
                        [LLM_SECRET_KEY]: secrets.map((s) => ({
                            ...s,
                            value: '*******ain',
                        })),
                    }), { status: 200 });
                }
                if (path.includes('/write')) {
                    for (const s of secrets) s.active = false;
                    const id = `new-${secrets.length + 1}`;
                    secrets.push({
                        id,
                        value: body.value,
                        label: body.label,
                        active: true,
                    });
                    return new Response(JSON.stringify({ id }), { status: 200 });
                }
                if (path.includes('/rotate')) {
                    for (const s of secrets) s.active = s.id === body.id;
                    return new Response('{}', { status: 200 });
                }
                if (path.includes('/delete')) {
                    secrets = secrets.filter((s) => s.id !== body.id);
                    if (secrets.length && !secrets.some((s) => s.active)) {
                        secrets[0].active = true;
                    }
                    return new Response('{}', { status: 200 });
                }
                if (path.includes('/rename')) {
                    const t = secrets.find((s) => s.id === body.id);
                    if (t) t.label = body.label;
                    return new Response('{}', { status: 200 });
                }
                return new Response('no', { status: 404 });
            },
        });

        const written = await store.writePreservingActive({
            value: 'sk-plugin',
            label: '酒馆数据库生图：测',
        });
        assert.equal(written.ok, true);
        assert.equal(written.value.restoredActive, true);
        assert.equal(written.value.wasFirstSecret, false);
        assert.equal(secrets.find((s) => s.id === 'main')?.active, true);

        const replaced = await store.replaceKey({
            oldId: written.value.id,
            value: 'sk-plugin-2',
            label: '酒馆数据库生图：测',
        });
        assert.equal(replaced.ok, true);
        assert.equal(secrets.some((s) => s.id === written.value.id), false);

        const del = await store.deleteById(replaced.value.id);
        assert.equal(del.ok, true);

        const failStore = createLlmSecretsStore({
            getRequestHeaders: () => ({}),
            fetch: async () => {
                throw new Error('network down');
            },
        });
        const fail = await failStore.writePreservingActive({ value: 'x', label: 'y' });
        assert.equal(fail.ok, false);
        assert.match(fail.error.message, /写入|读取|失败/);
    });

    it('原先无密钥时 wasFirstSecret=true', async () => {
        /** @type {Array<{id:string,value:string,label:string,active:boolean}>} */
        let secrets = [];
        const store = createLlmSecretsStore({
            getRequestHeaders: () => ({}),
            fetch: async (url, init) => {
                const path = String(url);
                const body = init?.body ? JSON.parse(String(init.body)) : {};
                if (path.includes('/read')) {
                    return new Response(JSON.stringify({
                        [LLM_SECRET_KEY]: secrets.length ? secrets : null,
                    }), { status: 200 });
                }
                if (path.includes('/write')) {
                    const id = 'only-one';
                    secrets = [{ id, value: body.value, label: body.label, active: true }];
                    return new Response(JSON.stringify({ id }), { status: 200 });
                }
                return new Response('{}', { status: 200 });
            },
        });
        const r = await store.writePreservingActive({ value: 'sk', label: 'x' });
        assert.equal(r.ok, true);
        assert.equal(r.value.wasFirstSecret, true);
        assert.equal(r.value.restoredActive, false);
        assert.equal(secrets[0].active, true);
    });
});

describe('LLM listModels / probe', () => {
    it('拉模型成功与失败', async () => {
        /** @type {Record<string, unknown>|null} */
        let seen = null;
        const transport = createStBackendLlmTransport({
            yaml,
            getContext: () => ({
                getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
                ChatCompletionService: {
                    createRequestData: (d) => d,
                    sendRequest: async () => ({ content: 'ok' }),
                },
            }),
            fetch: async (_url, init) => {
                seen = JSON.parse(String(init?.body || '{}'));
                return new Response(JSON.stringify({
                    data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
                }), { status: 200 });
            },
        });
        const ok = await transport.listModels(baseLlm({ apiKey: 'sk-test' }));
        assert.equal(ok.ok, true);
        assert.equal(ok.value.count, 3);
        assert.equal(seen?.chat_completion_source, 'custom');
        assert.equal(seen?.custom_url, 'https://api.example.com/v1');
        assert.equal(seen?.custom_include_headers, 'Authorization: "Bearer sk-test"');
        assert.equal('secret_id' in (seen || {}), false);

        const badTransport = createStBackendLlmTransport({
            yaml,
            getContext: () => ({
                getRequestHeaders: () => ({}),
            }),
            fetch: async () => new Response(JSON.stringify({
                error: { message: 'invalid api key' },
            }), { status: 401 }),
        });
        const bad = await badTransport.listModels(baseLlm({ apiKey: 'sk-test' }));
        assert.equal(bad.ok, false);
        assert.match(bad.error.message, /拉取模型|鉴权|密钥/i);

        const gw = createLlmGateway({
            transports: { 'st-backend': transport },
            sleep: async () => {},
        });
        const probe = await gw.probe(baseLlm({ apiKey: 'sk-test' }));
        assert.equal(probe.ok, true);
        assert.match(probe.detail, /3 个模型/);
    });

    it('extractModelIdsFromStatus 容忍多种形状', () => {
        assert.deepEqual(extractModelIdsFromStatus({ data: [{ id: 'x' }] }), ['x']);
        assert.deepEqual(extractModelIdsFromStatus({ models: [{ name: 'y' }] }), ['y']);
        assert.deepEqual(extractModelIdsFromStatus({ error: true, data: [] }), []);
    });
});
