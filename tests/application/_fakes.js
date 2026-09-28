/**
 * application 层测试用假端口 / 工厂。
 */
import { Ok, Err } from '../../src/infra/result.js';
import { createEventBus } from '../../src/infra/event-bus.js';
import { defaultPluginSettings } from '../../src/domain/model/plugin-settings.js';
import { emptyNaiCaption } from '../../src/domain/model/nai-params.js';
import { createContextCollector } from '../../src/application/context-collector.js';
import { createWorldInfoResolver } from '../../src/application/worldinfo-resolver.js';
import { createTagRecallService } from '../../src/application/tag-recall.service.js';
import { createViewpointBlocksBuilder } from '../../src/application/viewpoint-blocks.js';
import { createGenerateSlotsUseCase } from '../../src/application/generate-slots.usecase.js';
import { createImageGenService } from '../../src/application/image-gen.service.js';
import { createRenderSlotUseCase } from '../../src/application/render-slot.usecase.js';
import { createArtistPreviewService } from '../../src/application/artist-preview.service.js';
import { createWorkbenchService } from '../../src/application/workbench.service.js';
import { createAutoTriggerService } from '../../src/application/auto-trigger.service.js';
import { hostError } from '../../src/infra/errors.js';

/**
 * @returns {import('../../src/domain/model/plugin-settings.js').PluginSettings}
 */
export function baseSettings(patch = {}) {
    return {
        ...defaultPluginSettings(),
        recallLlmConfigId: 'llm-recall',
        promptGenLlmConfigId: 'llm-prompt',
        activeRecallPresetId: 'preset-recall',
        activeImagegenPresetId: 'preset-imagegen',
        activeNaiConfigId: 'nai-1',
        activeArtistId: 'artist-active',
        contextWindowSize: 5,
        ...patch,
    };
}

export function makeLlmConfig(id, name = id) {
    return {
        schemaVersion: 1,
        id,
        name,
        baseUrl: 'https://example.test/v1',
        secretId: 'sec-test',
        model: 'm',
    };
}

export function makeNaiConfig(id = 'nai-1') {
    return {
        schemaVersion: 1,
        id,
        name: id,
        baseUrl: 'https://nai.test',
        apiKey: 'k',
        transport: 'direct',
        decoder: 'auto',
    };
}

export function makeArtist(id, positive = 'artist_pos', negative = 'artist_neg') {
    return {
        schemaVersion: 1,
        id,
        name: id,
        sequence: 0,
        positivePrompt: positive,
        negativePrompt: negative,
        referenceImageRef: null,
        cardImageRef: null,
        createdAt: 't0',
        updatedAt: 't0',
    };
}

export function makePreset(id, kind, content) {
    return {
        schemaVersion: 1,
        id,
        name: id,
        kind,
        prompts: [{
            identifier: 'main',
            name: 'main',
            role: 'user',
            content,
            enabled: true,
            injection_position: 0,
            injection_depth: 0,
            injection_order: 0,
        }],
        prompt_order: [{ identifier: 'main', enabled: true }],
        createdAt: 't0',
        updatedAt: 't0',
    };
}

export function makeCaption(base = 'scene') {
    const c = emptyNaiCaption();
    c.v4_prompt.caption.base_caption = base;
    c.v4_negative_prompt.caption.base_caption = 'uc';
    return c;
}

/**
 * @returns {any}
 */
export function createFakeHost(opts = {}) {
    /** @type {import('../../src/ports/host.port.js').HostMessage[]} */
    const aiMessages = opts.aiMessages ?? [
        {
            messageId: 2,
            name: 'Bot',
            text: 'Alice walked into the garden.',
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
    ];
    /** @type {Map<number, import('../../src/ports/host.port.js').HostMessage>} */
    const byId = new Map(aiMessages.map((m) => [m.messageId, { ...m }]));
    if (opts.message) {
        byId.set(opts.message.messageId, { ...opts.message });
    }

    /** @type {Array<(id: number) => void>} */
    const settledListeners = [];
    /** @type {Array<(chatId: string|null) => void>} */
    const chatListeners = [];
    /** @type {import('../../src/ports/host.port.js').HostMessage[][]} */
    const resolveWorldInfoCalls = [];
    let chatId = opts.chatId ?? 'chat-1';

    const host = {
        resolveWorldInfoCalls,
        settledListeners,
        byId,
        get chatId() { return chatId; },
        setChatId(next) {
            chatId = next;
            for (const fn of chatListeners) fn(chatId);
        },
        getCurrentChatId: () => chatId,
        getSessionId: () => opts.sessionId ?? `sess-${chatId}`,
        getChatLocation: () => ({
            chatFileName: chatId,
            avatarUrl: opts.avatarUrl ?? 'char.png',
            groupId: opts.groupId ?? null,
        }),
        getMessages: () => [...byId.values()].sort((a, b) => a.messageId - b.messageId),
        getRecentAiMessages: (n) => aiMessages.slice(0, n).map((m) => ({ ...m })),
        getMessage: (id) => {
            const m = byId.get(id);
            return m ? { ...m } : null;
        },
        getMessageSwipeTexts: (id) => {
            if (opts.swipeTextsByMessageId && opts.swipeTextsByMessageId[id]) {
                return [...opts.swipeTextsByMessageId[id]];
            }
            const m = byId.get(id);
            return m ? [String(m.text ?? '')] : [];
        },
        replaceMessageText: async (id, text) => {
            if (opts.replaceFail) {
                return Err(hostError({ code: 'REPLACE_FAIL', message: 'replace failed' }));
            }
            const m = byId.get(id);
            if (!m) {
                return Err(hostError({ code: 'NO_MSG', message: 'no message' }));
            }
            byId.set(id, { ...m, text });
            return Ok(undefined);
        },
        rerenderMessage: () => {},
        ensureSlotRegexInstalled: async () => Ok(undefined),
        onMessageDomReady: () => () => {},
        registerOutboundTransform: () => () => {},
        resolveWorldInfo: async ({ contextWindow }) => {
            resolveWorldInfoCalls.push(contextWindow);
            if (opts.worldInfoFail) {
                return Err(hostError({
                    code: 'WI_FAIL',
                    message: 'worldinfo failed',
                }));
            }
            return Ok(opts.worldInfoText ?? 'WORLD_INFO_TEXT');
        },
        onChatChanged: (fn) => {
            chatListeners.push(fn);
            return () => {
                const i = chatListeners.indexOf(fn);
                if (i >= 0) chatListeners.splice(i, 1);
            };
        },
        onChatDeleted: () => () => {},
        onGroupChatDeleted: () => () => {},
        onChatRenamed: () => () => {},
        listAliveChats: async () => Ok(opts.aliveChats ?? []),
        onAiMessageSettled: (fn) => {
            settledListeners.push(fn);
            return () => {
                const i = settledListeners.indexOf(fn);
                if (i >= 0) settledListeners.splice(i, 1);
            };
        },
        loadSettings: () => baseSettings(),
        saveSettings: () => {},
        mountSettingsPanel: () => {},
        openModal: async () => {},
        registerSlashCommand: () => {},
        toast: () => {},
        dispose: () => {},
        emitSettled(messageId) {
            for (const fn of settledListeners) fn(messageId);
        },
    };
    return host;
}

export function createMemoryRepo(initial = []) {
    /** @type {Map<string, any>} */
    const map = new Map(initial.map((e) => [e.id, e]));
    return {
        list: async () => Ok([...map.values()]),
        get: async (id) => Ok(map.has(id) ? map.get(id) : null),
        put: async (entity) => {
            map.set(entity.id, entity);
            return Ok(entity);
        },
        remove: async (id) => {
            map.delete(id);
            return Ok(undefined);
        },
        exportJson: async () => Ok({}),
        importJson: async () => Ok({ imported: 0, skipped: 0, errors: [] }),
        onChanged: () => () => {},
        _map: map,
    };
}

export function createFakeCharacterRepo(groups = [], characters = []) {
    return {
        listGroups: async () => Ok(groups),
        getGroup: async (id) => Ok(groups.find((g) => g.id === id) ?? null),
        putGroup: async (g) => Ok(g),
        removeGroup: async () => Ok(undefined),
        listByGroup: async (groupId) => Ok(characters.filter((c) => c.groupId === groupId)),
        get: async (id) => Ok(characters.find((c) => c.id === id) ?? null),
        put: async (c) => Ok(c),
        remove: async () => Ok(undefined),
        exportJson: async () => Ok({}),
        importJson: async () => Ok({ imported: 0, skipped: 0, errors: [] }),
        onChanged: () => () => {},
    };
}

export function createFakeTagRepo(libraries = [], entries = []) {
    return {
        listLibraries: async () => Ok(libraries),
        getLibrary: async (id) => Ok(libraries.find((l) => l.id === id) ?? null),
        putLibrary: async (l) => Ok(l),
        removeLibrary: async () => Ok(undefined),
        listEntries: async (libraryId) => {
            if (libraryId == null) return Ok(entries);
            return Ok(entries.filter((e) => e.libraryId === libraryId));
        },
        get: async (id) => Ok(entries.find((e) => e.id === id) ?? null),
        put: async (e) => Ok(e),
        remove: async () => Ok(undefined),
        exportJson: async () => Ok({}),
        importJson: async () => Ok({ imported: 0, skipped: 0, errors: [] }),
        onChanged: () => () => {},
    };
}

export function createFakeSlotRepo() {
    /** @type {Map<string, any>} */
    const map = new Map();
    const key = (m, s) => `${m}:${s}`;
    /** @type {any} */
    const repo = {
        failGet: false,
        failGetByMessage: false,
        failListRetained: false,
        failPut: false,
        failRecordImageOnce: false,
        listRetained: async () => {
            if (repo.failListRetained) {
                return Err(hostError({ code: 'LIST_RETAINED_FAIL', message: 'listRetained failed' }));
            }
            return Ok([...map.values()]);
        },
        getByMessage: async (messageId) => {
            if (repo.failGetByMessage) {
                return Err(hostError({ code: 'GET_BY_MSG_FAIL', message: 'getByMessage failed' }));
            }
            const out = [];
            for (const [k, v] of map) {
                if (k.startsWith(`${messageId}:`)) out.push(v);
            }
            return Ok(out);
        },
        get: async (messageId, slotId) => {
            if (repo.failGet) {
                return Err(hostError({ code: 'GET_FAIL', message: 'get failed' }));
            }
            return Ok(map.get(key(messageId, slotId)) ?? null);
        },
        put: async (messageId, records) => {
            if (repo.failPut) {
                return Err(hostError({ code: 'PUT_FAIL', message: 'put failed' }));
            }
            for (const r of records) {
                map.set(key(messageId, r.slotId), r);
            }
            return Ok(undefined);
        },
        recordImage: async (messageId, slotId, imageRef, meta = {}) => {
            if (repo.failRecordImageOnce) {
                repo.failRecordImageOnce = false;
                return Err(hostError({ code: 'RECORD_FAIL', message: 'recordImage failed' }));
            }
            const prev = map.get(key(messageId, slotId));
            if (!prev) {
                return Err(hostError({ code: 'NO_SLOT', message: 'no slot' }));
            }
            const next = {
                ...prev,
                images: [
                    ...(prev.images ?? []),
                    {
                        imageRef,
                        createdAt: meta.createdAt ?? 't',
                        naiConfigId: null,
                        artistId: null,
                    },
                ],
            };
            map.set(key(messageId, slotId), next);
            return Ok(next);
        },
        onChanged: () => () => {},
        _map: map,
    };
    return repo;
}

export function createFakeImageRepo() {
    let n = 0;
    /** @type {Map<string, Blob>} */
    const blobs = new Map();
    return {
        put: async (blob) => {
            n += 1;
            const ref = `img-${n}`;
            blobs.set(ref, blob);
            return Ok(ref);
        },
        getUrl: async (ref) => Ok(blobs.has(ref) ? `blob:${ref}` : null),
        gc: async () => Ok({ removed: 0 }),
        _blobs: blobs,
    };
}

/**
 * 组装一套可跑通七步链路的用例。
 */
export function buildPipeline(overrides = {}) {
    let settings = baseSettings(overrides.settingsPatch);
    const host = overrides.host ?? createFakeHost(overrides.hostOpts);
    const bus = createEventBus();

    const groups = overrides.groups ?? [
        {
            schemaVersion: 1, id: 'g1', name: 'g1', active: true, order: 0,
            createdAt: '', updatedAt: '',
        },
        {
            schemaVersion: 1, id: 'g2', name: 'g2', active: false, order: 1,
            createdAt: '', updatedAt: '',
        },
    ];
    const characters = overrides.characters ?? [
        {
            schemaVersion: 1, id: 'c1', groupId: 'g1', name: 'Alice',
            keywords: ['Alice'], fixedFeatures: 'black hair',
            variableFeatures: [{ name: '日常服饰', prompt: 'dress' }],
            matchOverrides: null, createdAt: '', updatedAt: '',
        },
        {
            schemaVersion: 1, id: 'c2', groupId: 'g2', name: 'Bob',
            keywords: ['Alice'], fixedFeatures: 'should-not-appear',
            variableFeatures: [], matchOverrides: null, createdAt: '', updatedAt: '',
        },
    ];
    const libraries = overrides.libraries ?? [
        {
            schemaVersion: 1, id: 'lib1', name: 'lib1', active: true,
            kind: 'composition', createdAt: '', updatedAt: '',
        },
        {
            schemaVersion: 1, id: 'lib2', name: 'lib2', active: false,
            kind: 'composition', createdAt: '', updatedAt: '',
        },
        {
            schemaVersion: 1, id: 'lib-feat', name: 'lib-feat', active: true,
            kind: 'feature', createdAt: '', updatedAt: '',
        },
    ];
    const tagEntries = overrides.tagEntries ?? [
        {
            schemaVersion: 1, id: 't1', libraryId: 'lib1',
            key: 'garden', value: 'flower garden, sunny',
            createdAt: '', updatedAt: '',
        },
        {
            schemaVersion: 1, id: 't2', libraryId: 'lib2',
            key: 'night', value: 'should-not-recall',
            createdAt: '', updatedAt: '',
        },
        {
            schemaVersion: 1, id: 't3', libraryId: 'lib-feat',
            key: 'Alice', value: 'silver hair feature ref',
            createdAt: '', updatedAt: '',
        },
    ];

    const presetRepo = createMemoryRepo(overrides.presets ?? [
        makePreset('preset-recall', 'recall', 'ctx={{当前上下文}}\nkeys={{候选 key}}\nuser={{用户描述}}'),
        makePreset(
            'preset-imagegen',
            'imagegen',
            'W={{世界书}} C={{当前上下文}} R={{角色库}} T={{构图标签}} F={{特征参考}} K={{常驻标签}} Recent={{近期生图记录}} U={{用户描述}}',
        ),
    ]);
    const llmConfigRepo = createMemoryRepo([
        makeLlmConfig('llm-recall'),
        makeLlmConfig('llm-prompt'),
    ]);
    const artistRepo = createMemoryRepo([
        makeArtist('artist-active', 'ACTIVE_POS', 'ACTIVE_NEG'),
        makeArtist('artist-editing', 'EDIT_POS', 'EDIT_NEG'),
    ]);
    const naiConfigRepo = createMemoryRepo([makeNaiConfig()]);

    /** @type {any[]} */
    const llmCalls = [];
    const llm = {
        complete: async (req) => {
            llmCalls.push(req);
            if (overrides.llmComplete) {
                return overrides.llmComplete(req, llmCalls.length);
            }
            // 第 1 次召回 / 第 2 次提示词（需求 4.11 / §5）
            if (req.config.id === 'llm-recall') {
                const positions = [{
                    生成点: 'Alice walked into the garden.',
                    key: ['1'],
                }];
                return Ok({ text: JSON.stringify(positions), json: positions });
            }
            return Ok({
                text: '[]',
                json: [{
                    slotid: 1,
                    生图内容: makeCaption('a garden scene'),
                }],
            });
        },
        probe: async () => ({ ok: true, transport: 'st-backend', decoder: 'json' }),
        listModels: async () => Ok({ models: ['m'], count: 1 }),
    };

    /** @type {any[]} */
    const naiCalls = [];
    const imageGenPort = {
        generate: async (payload, opts) => {
            naiCalls.push({ payload, opts });
            return Ok([{ blob: new Blob(['img']), mimeType: 'image/png', seed: 1 }]);
        },
        probe: async () => ({ ok: true, transport: 'direct', decoder: 'json' }),
    };

    const characterRepo = createFakeCharacterRepo(groups, characters);
    const tagRepo = createFakeTagRepo(libraries, tagEntries);
    const slotRepo = createFakeSlotRepo();
    const imageRepo = createFakeImageRepo();

    const loadSettings = () => settings;
    const runHostMacros = (t) => t;
    const newTraceId = () => 'trace-fixed';
    const nowIso = () => '2026-01-01T00:00:00.000Z';

    const contextCollector = createContextCollector({ host, loadSettings });
    const worldInfoResolver = createWorldInfoResolver({ host });
    const viewpointBlocks = createViewpointBlocksBuilder({
        host, characterRepo, tagRepo, contextCollector, worldInfoResolver, loadSettings,
    });
    const tagRecall = createTagRecallService({
        llm, tagRepo, presetRepo, llmConfigRepo, loadSettings, runHostMacros,
    });
    const imageGen = createImageGenService({
        imageGenPort, artistRepo, naiConfigRepo, characterRepo, loadSettings, newTraceId,
    });
    const generateSlots = createGenerateSlotsUseCase({
        host, llm, characterRepo, tagRepo, presetRepo, slotRepo, llmConfigRepo,
        contextCollector, worldInfoResolver, viewpointBlocks, tagRecall, bus,
        loadSettings, runHostMacros,
        newId: () => 'id-1',
        nowIso,
        newTraceId,
    });
    const renderSlot = createRenderSlotUseCase({
        imageGen, slotRepo, imageRepo, host, bus, nowIso, newTraceId,
    });
    const artistPreview = createArtistPreviewService({
        imageGen,
        artistRepo,
        savePreviewPair: async (_artistId, _refBlob, _cardBlob, _oldRefs) => Ok({
            referenceImageRef: 'preview-ref-test',
            cardImageRef: 'preview-card-test',
        }),
        makeCardImage: async (blob) => blob,
    });
    const workbench = createWorkbenchService({
        llm, imageGen, characterRepo, tagRepo, presetRepo, llmConfigRepo,
        tagRecall, host, viewpointBlocks, slotRepo, loadSettings, runHostMacros,
    });
    const autoTrigger = createAutoTriggerService({
        host, generateSlots, renderSlot, slotRepo, loadSettings, bus,
    });

    // 默认目标楼：正文含生成点
    if (!host.byId.has(2)) {
        host.byId.set(2, {
            messageId: 2,
            name: 'Bot',
            text: 'Alice walked into the garden.',
            isUser: false,
            isSystem: false,
        });
    } else {
        const m = host.byId.get(2);
        host.byId.set(2, {
            ...m,
            text: 'Alice walked into the garden.',
        });
    }

    return {
        host,
        bus,
        llm,
        llmCalls,
        naiCalls,
        settings,
        setSettings(next) { settings = next; },
        patchSettings(p) { settings = { ...settings, ...p }; },
        characterRepo,
        tagRepo,
        slotRepo,
        imageRepo,
        artistRepo,
        contextCollector,
        worldInfoResolver,
        viewpointBlocks,
        tagRecall,
        imageGen,
        generateSlots,
        renderSlot,
        artistPreview,
        workbench,
        autoTrigger,
        loadSettings,
    };
}
