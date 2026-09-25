/**
 * 4.16 单图提示词用例测试。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Ok, Err, isOk, isErr } from '../../src/infra/result.js';
import { upstreamFromHttpStatus } from '../../src/infra/errors.js';
import { createContextCollector } from '../../src/application/context-collector.js';
import { createWorldInfoResolver } from '../../src/application/worldinfo-resolver.js';
import { createViewpointBlocksBuilder } from '../../src/application/viewpoint-blocks.js';
import {
    createSinglePromptUseCase,
    extractSingleCaption,
} from '../../src/application/single-prompt.usecase.js';
import {
    baseSettings,
    createFakeHost,
    createFakeCharacterRepo,
    createFakeTagRepo,
    createFakeSlotRepo,
    createMemoryRepo,
    makeLlmConfig,
    makePreset,
    makeCaption,
} from './_fakes.js';

/**
 * @param {object} [overrides]
 */
function buildSinglePrompt(overrides = {}) {
    let settings = baseSettings({
        activeSingleRecallPresetId: 'preset-single-recall',
        activeSingleImagegenPresetId: 'preset-single-imagegen',
        ...overrides.settingsPatch,
    });

    const host = overrides.host ?? createFakeHost({
        aiMessages: [
            {
                messageId: 2,
                name: 'Bot',
                text: 'Alice walked into the garden with 金发.',
                isUser: false,
                isSystem: false,
            },
            {
                messageId: 1,
                name: 'Bot',
                text: 'Earlier scene.',
                isUser: false,
                isSystem: false,
            },
        ],
        worldInfoText: 'WI_OK',
        ...(overrides.hostOpts ?? {}),
    });

    const groups = overrides.groups ?? [{
        schemaVersion: 1, id: 'g1', name: 'g1', active: true, order: 0,
        createdAt: '', updatedAt: '',
    }];
    const characters = overrides.characters ?? [{
        schemaVersion: 1, id: 'c1', groupId: 'g1', name: 'Alice',
        keywords: ['Alice'], fixedFeatures: 'black hair',
        variableFeatures: [], matchOverrides: null, createdAt: '', updatedAt: '',
    }];
    const libraries = overrides.libraries ?? [
        {
            schemaVersion: 1, id: 'lib-comp', name: '构图', active: true,
            kind: 'composition', createdAt: '', updatedAt: '',
        },
        {
            schemaVersion: 1, id: 'lib-feat', name: '特征', active: true,
            kind: 'feature', createdAt: '', updatedAt: '',
        },
        {
            schemaVersion: 1, id: 'lib-off', name: '关', active: false,
            kind: 'composition', createdAt: '', updatedAt: '',
        },
    ];
    const tagEntries = overrides.tagEntries ?? [
        {
            schemaVersion: 1, id: 't1', libraryId: 'lib-comp',
            key: 'garden', value: 'flower garden, sunny',
            createdAt: '', updatedAt: '',
        },
        {
            schemaVersion: 1, id: 't2', libraryId: 'lib-feat',
            key: '金发', value: 'blonde hair',
            createdAt: '', updatedAt: '',
        },
        {
            schemaVersion: 1, id: 't3', libraryId: 'lib-off',
            key: 'night', value: 'should-not',
            createdAt: '', updatedAt: '',
        },
    ];

    const presetRepo = createMemoryRepo([
        makePreset('preset-recall', 'recall', 'floor-recall={{当前上下文}}'),
        makePreset('preset-imagegen', 'imagegen', 'floor-imagegen={{世界书}}'),
        makePreset(
            'preset-single-recall',
            'single-recall',
            'ctx={{当前上下文}}\ndesc={{用户描述}}\nkeys={{候选 key}}',
        ),
        makePreset(
            'preset-single-imagegen',
            'single-imagegen',
            'W={{世界书}} C={{当前上下文}} R={{角色库}} Comp={{构图标签}} F={{特征参考}} K={{常驻标签}} Recent={{近期生图记录}} D={{用户描述}}',
        ),
        ...(overrides.extraPresets ?? []),
    ]);
    const llmConfigRepo = createMemoryRepo([
        makeLlmConfig('llm-recall'),
        makeLlmConfig('llm-prompt'),
    ]);

    /** @type {any[]} */
    const llmCalls = [];
    const llm = {
        complete: async (req) => {
            llmCalls.push(req);
            if (overrides.llmComplete) {
                return overrides.llmComplete(req, llmCalls.length);
            }
            if (req.config.id === 'llm-recall') {
                return Ok({ text: '{"key":["1"]}', json: { key: ['1'] } });
            }
            return Ok({
                text: '',
                json: { 生图内容: makeCaption('single garden') },
            });
        },
        probe: async () => ({ ok: true, transport: 'st-backend', decoder: 'json' }),
        listModels: async () => Ok({ models: ['m'], count: 1 }),
    };

    /** @type {any[]} */
    const naiCalls = [];

    const characterRepo = createFakeCharacterRepo(groups, characters);
    const tagRepo = createFakeTagRepo(libraries, tagEntries);
    const slotRepo = createFakeSlotRepo();

    const loadSettings = () => settings;
    const runHostMacros = (t) => t;
    const newTraceId = () => `trace-${llmCalls.length + 1}`;

    const contextCollector = createContextCollector({ host, loadSettings });
    const worldInfoResolver = createWorldInfoResolver({ host });
    const viewpointBlocks = createViewpointBlocksBuilder({
        host,
        characterRepo,
        tagRepo,
        contextCollector,
        worldInfoResolver,
        loadSettings,
    });
    const singlePrompt = createSinglePromptUseCase({
        host,
        llm,
        tagRepo,
        presetRepo,
        llmConfigRepo,
        slotRepo,
        viewpointBlocks,
        loadSettings,
        runHostMacros,
        newTraceId,
    });

    return {
        host,
        llm,
        llmCalls,
        naiCalls,
        slotRepo,
        settings,
        singlePrompt,
    };
}

describe('extractSingleCaption', () => {
    it('reads 生图内容', () => {
        const cap = makeCaption('x');
        assert.deepEqual(extractSingleCaption({ 生图内容: cap }), cap);
    });

    it('accepts bare caption object', () => {
        const cap = makeCaption('y');
        assert.deepEqual(extractSingleCaption(cap), cap);
    });

    it('rejects array / null', () => {
        assert.equal(extractSingleCaption([]), null);
        assert.equal(extractSingleCaption(null), null);
    });
});

describe('single-prompt.usecase', () => {
    it('empty description → Err, no LLM', async () => {
        const p = buildSinglePrompt();
        const r = await p.singlePrompt.execute({ description: '   ' });
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'SINGLE_DESC_EMPTY');
        assert.equal(p.llmCalls.length, 0);
    });

    it('default viewpoint = latest AI floor', async () => {
        const p = buildSinglePrompt();
        const r = await p.singlePrompt.execute({ description: '画一张花园图' });
        assert.equal(isOk(r), true);
        assert.equal(r.value.messageId, 2);
    });

    it('explicit messageId is used', async () => {
        const p = buildSinglePrompt();
        const r = await p.singlePrompt.execute({
            description: '画一张',
            messageId: 1,
        });
        assert.equal(isOk(r), true);
        assert.equal(r.value.messageId, 1);
    });

    it('missing viewpoint → Err', async () => {
        const host = createFakeHost({ aiMessages: [] });
        const p = buildSinglePrompt({ host });
        const r = await p.singlePrompt.execute({ description: 'x' });
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'VIEWPOINT_NOT_FOUND');
        assert.equal(p.llmCalls.length, 0);
    });

    it('description participates in character + feature scan', async () => {
        const p = buildSinglePrompt({
            host: createFakeHost({
                aiMessages: [{
                    messageId: 2,
                    name: 'Bot',
                    text: 'Someone stood still.',
                    isUser: false,
                    isSystem: false,
                }],
                worldInfoText: 'WI',
            }),
            llmComplete: async (req, n) => {
                if (n === 1) {
                    return Ok({ text: '', json: { key: [] } });
                }
                const userMsg = req.messages.map((m) => m.content).join('\n');
                assert.match(userMsg, /Alice/);
                assert.match(userMsg, /blonde hair|特征/);
                return Ok({ text: '', json: { 生图内容: makeCaption('ok') } });
            },
        });
        // description contains Alice + 金发 which are not in context
        const r = await p.singlePrompt.execute({
            description: 'Alice with 金发 posing',
        });
        assert.equal(isOk(r), true);
    });

    it('candidates only from active composition libs (not feature / inactive)', async () => {
        const p = buildSinglePrompt({
            llmComplete: async (req, n) => {
                if (n === 1) {
                    const text = req.messages.map((m) => m.content).join('\n');
                    const keysLine = text.split('\n').find((l) => l.startsWith('keys=')) || '';
                    assert.equal(keysLine, 'keys=1 garden');
                    assert.equal(keysLine.includes('金发'), false);
                    assert.equal(keysLine.includes('night'), false);
                    assert.match(text, /desc=画花园/);
                    return Ok({ text: '', json: { key: ['1'] } });
                }
                return Ok({ text: '', json: { 生图内容: makeCaption('ok') } });
            },
        });
        const r = await p.singlePrompt.execute({ description: '画花园' });
        assert.equal(isOk(r), true);
        assert.deepEqual(r.value.recalledKeys, ['garden']);
    });

    it('no composition candidates → skip recall, llmCallCount=1', async () => {
        const p = buildSinglePrompt({
            libraries: [{
                schemaVersion: 1, id: 'lib-feat', name: '特征', active: true,
                kind: 'feature', createdAt: '', updatedAt: '',
            }],
            tagEntries: [{
                schemaVersion: 1, id: 't2', libraryId: 'lib-feat',
                key: '金发', value: 'blonde hair',
                createdAt: '', updatedAt: '',
            }],
        });
        const r = await p.singlePrompt.execute({ description: '画一张' });
        assert.equal(isOk(r), true);
        assert.equal(r.value.llmCallCount, 1);
        assert.equal(p.llmCalls.length, 1);
        assert.equal(p.llmCalls[0].config.id, 'llm-prompt');
        assert.deepEqual(r.value.recalledKeys, []);
    });

    it('happy path: exactly 2 LLM calls using single presets', async () => {
        const p = buildSinglePrompt();
        const r = await p.singlePrompt.execute({ description: '画花园' });
        assert.equal(isOk(r), true);
        assert.equal(r.value.llmCallCount, 2);
        assert.equal(p.llmCalls.length, 2);
        assert.equal(p.llmCalls[0].config.id, 'llm-recall');
        assert.equal(p.llmCalls[1].config.id, 'llm-prompt');
        // 渲染内容应来自单图预设，不是楼中预设
        const recallText = p.llmCalls[0].messages.map((m) => m.content).join('\n');
        assert.match(recallText, /desc=/);
        assert.equal(recallText.includes('floor-recall'), false);
        const promptText = p.llmCalls[1].messages.map((m) => m.content).join('\n');
        assert.match(promptText, /Comp=/);
        assert.match(promptText, /D=/);
        assert.equal(promptText.includes('floor-imagegen'), false);
        assert.equal(r.value.caption.v4_prompt.caption.base_caption, 'single garden');
    });

    it('wrong single-recall preset kind → Err', async () => {
        const p = buildSinglePrompt({
            settingsPatch: { activeSingleRecallPresetId: 'preset-recall' },
        });
        const r = await p.singlePrompt.execute({ description: 'x' });
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'SINGLE_RECALL_PRESET_MISSING');
    });

    it('unset single-imagegen preset → Err', async () => {
        const p = buildSinglePrompt({
            settingsPatch: { activeSingleImagegenPresetId: null },
            libraries: [],
            tagEntries: [],
        });
        const r = await p.singlePrompt.execute({ description: 'x' });
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'SINGLE_IMAGEGEN_PRESET_UNSET');
    });

    it('unset prompt LLM → Err', async () => {
        const p = buildSinglePrompt({
            settingsPatch: { promptGenLlmConfigId: null },
            libraries: [],
            tagEntries: [],
        });
        const r = await p.singlePrompt.execute({ description: 'x' });
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'PROMPT_LLM_UNSET');
    });

    it('LLM failure → Err, no half result', async () => {
        const p = buildSinglePrompt({
            llmComplete: async () => Err(upstreamFromHttpStatus(500, {
                code: 'UPSTREAM_5XX',
                message: 'boom',
            })),
        });
        const r = await p.singlePrompt.execute({ description: 'x' });
        assert.equal(isErr(r), true);
        assert.equal(r.value, undefined);
    });

    it('bad caption shape → Err', async () => {
        const p = buildSinglePrompt({
            llmComplete: async (req, n) => {
                if (n === 1) return Ok({ text: '', json: { key: ['1'] } });
                return Ok({ text: '', json: { foo: 1 } });
            },
        });
        const r = await p.singlePrompt.execute({ description: 'x' });
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'SINGLE_CAPTION_SHAPE');
    });

    it('concurrent same chat+floor+desc share one Promise', async () => {
        let inFlight = 0;
        let maxInFlight = 0;
        const p = buildSinglePrompt({
            llmComplete: async (req, n) => {
                inFlight += 1;
                maxInFlight = Math.max(maxInFlight, inFlight);
                await new Promise((resolve) => setTimeout(resolve, 20));
                inFlight -= 1;
                if (req.config.id === 'llm-recall') {
                    return Ok({ text: '', json: { key: ['1'] } });
                }
                return Ok({ text: '', json: { 生图内容: makeCaption(`n${n}`) } });
            },
        });
        const [a, b] = await Promise.all([
            p.singlePrompt.execute({ description: 'same' }),
            p.singlePrompt.execute({ description: 'same' }),
        ]);
        assert.equal(isOk(a), true);
        assert.equal(isOk(b), true);
        assert.equal(a.value.traceId, b.value.traceId);
        assert.equal(p.llmCalls.length, 2);
        assert.ok(maxInFlight <= 1 || p.llmCalls.length === 2);
    });

    it('does not write slot / change floor / call NAI', async () => {
        const p = buildSinglePrompt();
        const beforeText = p.host.getMessage(2).text;
        const beforeSlots = await p.slotRepo.getByMessage(2);
        const r = await p.singlePrompt.execute({ description: '画' });
        assert.equal(isOk(r), true);
        assert.equal(p.host.getMessage(2).text, beforeText);
        const afterSlots = await p.slotRepo.getByMessage(2);
        assert.deepEqual(afterSlots.value, beforeSlots.value);
        assert.equal(p.naiCalls.length, 0);
        // settings unchanged for floor presets
        assert.equal(p.settings.activeRecallPresetId, 'preset-recall');
        assert.equal(p.settings.activeImagegenPresetId, 'preset-imagegen');
    });

    it('signal abort mid-flight → Err', async () => {
        const ac = new AbortController();
        const p = buildSinglePrompt({
            llmComplete: async () => {
                ac.abort();
                return Err(upstreamFromHttpStatus(0, {
                    code: 'UPSTREAM_ABORTED',
                    message: '请求已取消',
                    cause: Object.assign(new Error('aborted'), { name: 'AbortError' }),
                }));
            },
        });
        const r = await p.singlePrompt.execute({
            description: 'x',
            signal: ac.signal,
        });
        assert.equal(isErr(r), true);
    });

    it('returns 尺寸 / 解析; injects retained recent slots', async () => {
        const { createSlotRecord } = await import('../../src/domain/model/slot.js');
        const p = buildSinglePrompt({
            llmComplete: async (req, n) => {
                if (n === 1) {
                    return Ok({ text: '', json: { key: ['1'] } });
                }
                const promptText = req.messages.map((m) => m.content).join('\n');
                assert.match(promptText, /Recent=slotid: 7/);
                assert.match(promptText, /解析: 旧解析/);
                assert.match(promptText, /尺寸: 832x1216/);
                return Ok({
                    text: '',
                    json: {
                        生图内容: makeCaption('single with size'),
                        尺寸: '1024x1024',
                        解析: '方图解析',
                    },
                });
            },
        });
        await p.slotRepo.put(1, [
            createSlotRecord({
                messageId: 1,
                slotId: 7,
                caption: makeCaption('old'),
                size: '832x1216',
                analysis: '旧解析',
            }, { now: '2026-01-01T00:00:00.000Z' }),
        ]);
        const r = await p.singlePrompt.execute({ description: '画一张方图' });
        assert.equal(isOk(r), true, r.ok ? '' : r.error?.message);
        assert.equal(r.value.size, '1024x1024');
        assert.equal(r.value.analysis, '方图解析');
    });

    it('empty 尺寸 / 解析 are omitted from result', async () => {
        const p = buildSinglePrompt({
            llmComplete: async (_req, n) => {
                if (n === 1) {
                    return Ok({ text: '', json: { key: [] } });
                }
                return Ok({
                    text: '',
                    json: {
                        生图内容: makeCaption('no extras'),
                        尺寸: '',
                        解析: '  ',
                    },
                });
            },
        });
        const r = await p.singlePrompt.execute({ description: '无尺寸' });
        assert.equal(isOk(r), true);
        assert.equal('size' in r.value, false);
        assert.equal('analysis' in r.value, false);
    });
});
