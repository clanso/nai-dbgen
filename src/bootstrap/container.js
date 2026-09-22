/**
 * L0 装配 · 唯一 new/工厂调用点：组装 ports 实现并注入用例。
 * 归属：W3-J 装配代理实现。
 *
 * 三处同实例（写错不报错但行为会错）：
 * - llm：tagRecall 与 generateSlots 必须同一实例
 * - tagRecall：generateSlots 与 workbench 必须同一实例（D33）
 * - bus：generateSlots、renderSlot、autoTrigger 必须同一个（D32）
 *
 * createRenderSlotUseCase 必填 host（D36 getCurrentChatId）。
 */

import { createEventBus } from '../infra/event-bus.js';
import { newId } from '../infra/id.js';
import { nowIso } from '../infra/clock.js';

import { createSillyTavernHost } from '../adapters/host/sillytavern.host.js';
import { createStMacroBridge } from '../adapters/host/st-macro.bridge.js';

import { openIdb } from '../adapters/storage/idb.js';
import { createMessageExtraStore } from '../adapters/storage/message-extra.store.js';
import { createSettingsStore } from '../adapters/storage/settings.store.js';
import { createCharacterRepo } from '../adapters/storage/repos/character.repo.js';
import { createTagRepo } from '../adapters/storage/repos/tag.repo.js';
import { createArtistRepo } from '../adapters/storage/repos/artist.repo.js';
import { createPresetRepo } from '../adapters/storage/repos/preset.repo.js';
import { createLlmConfigRepo, createNaiConfigRepo } from '../adapters/storage/repos/api-config.repo.js';
import { createSlotRepo } from '../adapters/storage/repos/slot.repo.js';
import { createImageRepo } from '../adapters/storage/image.repo.js';

import { createLlmGateway } from '../adapters/llm/llm.gateway.js';
import { createDirectLlmTransport } from '../adapters/llm/transport/direct.js';
import { createStBackendLlmTransport } from '../adapters/llm/transport/st-backend.js';

import { createNaiGateway } from '../adapters/nai/nai.gateway.js';
import { createDirectTransport } from '../adapters/nai/transport/direct.js';
import { createStCorsProxyTransport } from '../adapters/nai/transport/st-cors-proxy.js';
import { decodeZip } from '../adapters/nai/decoder/zip.js';
import { decodeJsonBase64 } from '../adapters/nai/decoder/json-base64.js';

import { createContextCollector } from '../application/context-collector.js';
import { createWorldInfoResolver } from '../application/worldinfo-resolver.js';
import { createTagRecallService } from '../application/tag-recall.service.js';
import { createGenerateSlotsUseCase } from '../application/generate-slots.usecase.js';
import { createImageGenService } from '../application/image-gen.service.js';
import { createRenderSlotUseCase } from '../application/render-slot.usecase.js';
import { createArtistPreviewService } from '../application/artist-preview.service.js';
import { createWorkbenchService } from '../application/workbench.service.js';
import { createAutoTriggerService } from '../application/auto-trigger.service.js';

/**
 * @typedef {object} AppRepos
 * @property {import('../ports/repository.port.js').CharacterRepository} character
 * @property {import('../ports/repository.port.js').TagRepository} tag
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/artist.js').ArtistString>} artist
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/preset.js').Preset>} preset
 * @property {import('../ports/repository.port.js').SlotRepository} slot
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/api-config.js').LlmApiConfig>} llmConfig
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/api-config.js').NaiApiConfig>} naiConfig
 * @property {import('../ports/repository.port.js').ImageRepository} image
 */

/**
 * @typedef {object} AppContainer
 * @property {import('../ports/host.port.js').HostPort} host
 * @property {import('../ports/image-gen.port.js').ImageGenPort} imageGenPort
 * @property {import('../ports/llm.port.js').LlmPort} llm
 * @property {AppRepos} repos
 * @property {object} services
 * @property {object} useCases
 * @property {ReturnType<import('../infra/event-bus.js').createEventBus>} bus
 * @property {ReturnType<import('../adapters/storage/settings.store.js').createSettingsStore>} settingsStore
 * @property {() => import('../domain/model/plugin-settings.js').PluginSettings} loadSettings
 * @property {(template: string) => string} runHostMacros
 * @property {{ llm: object, tagRecall: object, bus: object }} shared
 *   三处同实例的显式引用，供测试断言
 * @property {() => void} dispose
 */

/** 应用层工厂必填字段（与「应用层接口交接.md §3」对齐，含 D36 host） */
export const REQUIRED_APP_DEPS = Object.freeze({
    createContextCollector: Object.freeze(['host', 'loadSettings']),
    createWorldInfoResolver: Object.freeze(['host']),
    createTagRecallService: Object.freeze([
        'llm', 'tagRepo', 'presetRepo', 'llmConfigRepo', 'loadSettings', 'runHostMacros',
    ]),
    createGenerateSlotsUseCase: Object.freeze([
        'host', 'llm', 'characterRepo', 'tagRepo', 'presetRepo', 'slotRepo', 'llmConfigRepo',
        'contextCollector', 'worldInfoResolver', 'tagRecall', 'bus',
        'loadSettings', 'runHostMacros', 'newId', 'nowIso', 'newTraceId',
    ]),
    createImageGenService: Object.freeze([
        'imageGenPort', 'artistRepo', 'naiConfigRepo', 'loadSettings', 'newTraceId',
    ]),
    createRenderSlotUseCase: Object.freeze([
        'imageGen', 'slotRepo', 'imageRepo', 'host', 'bus', 'nowIso', 'newTraceId',
    ]),
    createArtistPreviewService: Object.freeze(['imageGen', 'artistRepo', 'imageRepo']),
    createWorkbenchService: Object.freeze([
        'llm', 'imageGen', 'characterRepo', 'tagRepo', 'llmConfigRepo',
        'tagRecall', 'loadSettings', 'runHostMacros',
    ]),
    createAutoTriggerService: Object.freeze([
        'host', 'generateSlots', 'renderSlot', 'slotRepo', 'loadSettings', 'bus',
    ]),
});

/**
 * 校验工厂 deps 是否含全部必填键；缺一即抛（装配期早失败）。
 * @param {string} factoryName
 * @param {object} deps
 * @param {readonly string[]} keys
 * @returns {void}
 */
export function assertRequiredDeps(factoryName, deps, keys) {
    if (!deps || typeof deps !== 'object') {
        throw new Error(`${factoryName}: deps 必须是对象`);
    }
    /** @type {string[]} */
    const missing = [];
    for (const key of keys) {
        if (deps[key] == null) {
            missing.push(key);
        }
    }
    if (missing.length > 0) {
        throw new Error(`${factoryName}: 缺少必填 deps：${missing.join(', ')}`);
    }
}

/**
 * @returns {() => any}
 */
function defaultGetContext() {
    return () => {
        const st = globalThis.SillyTavern;
        if (!st || typeof st.getContext !== 'function') {
            throw new Error('找不到 SillyTavern.getContext；请确认在酒馆页面内加载本插件');
        }
        return st.getContext();
    };
}

/**
 * 创建并装配全部依赖。不得在模块顶层自动执行。
 * 须分别调用 createLlmConfigRepo 与 createNaiConfigRepo（裁决 D7），禁止单一 api-config 仓库。
 *
 * @param {object} [opts]
 * @param {() => any} [opts.getContext]
 * @param {import('../ports/host.port.js').HostPort} [opts.host] 测试注入
 * @param {object} [opts.db] 测试注入内存 IDB
 * @param {object} [opts.idbOpts] 传给 openIdb
 * @param {ReturnType<import('../infra/event-bus.js').createEventBus>} [opts.bus]
 * @param {import('../ports/llm.port.js').LlmPort} [opts.llm]
 * @param {import('../ports/image-gen.port.js').ImageGenPort} [opts.imageGenPort]
 * @param {object} [opts.factories] 可替换应用层工厂（测同实例）
 * @returns {Promise<AppContainer>}
 */
export async function createContainer(opts = {}) {
    const getContext = typeof opts.getContext === 'function'
        ? opts.getContext
        : defaultGetContext();

    const bus = opts.bus ?? createEventBus();

    /** @type {import('../ports/host.port.js').HostPort} */
    const host = opts.host ?? createSillyTavernHost({ getContext, bus });

    const db = opts.db ?? await openIdb(opts.idbOpts);
    const ownsDb = !opts.db;

    const settingsStore = createSettingsStore({ host });
    const loadSettings = () => settingsStore.load();

    const macroBridge = createStMacroBridge({ getContext });
    const runHostMacros = (template) => macroBridge.runHostMacros(template);

    const messageExtra = createMessageExtraStore({ host });

    const characterRepo = createCharacterRepo({ db, bus });
    const tagRepo = createTagRepo({ db, bus });
    const artistRepo = createArtistRepo({ db, bus });
    const presetRepo = createPresetRepo({ db, bus });
    const llmConfigRepo = createLlmConfigRepo({ db, bus });
    const naiConfigRepo = createNaiConfigRepo({ db, bus });
    const slotRepo = createSlotRepo({ db, bus, messageExtra });
    const imageRepo = createImageRepo({ db });

    /** @type {import('../ports/llm.port.js').LlmPort} */
    const llm = opts.llm ?? createLlmGateway({
        transports: {
            'st-backend': createStBackendLlmTransport({ getContext }),
            direct: createDirectLlmTransport(),
        },
    });

    /** @type {import('../ports/image-gen.port.js').ImageGenPort} */
    const imageGenPort = opts.imageGenPort ?? createNaiGateway({
        transports: {
            direct: createDirectTransport(),
            'st-cors-proxy': createStCorsProxyTransport(),
        },
        decoders: {
            'json-base64': { decode: decodeJsonBase64 },
            zip: { decode: decodeZip },
        },
    });

    const newTraceId = () => newId('trace');

    const factories = {
        createContextCollector,
        createWorldInfoResolver,
        createTagRecallService,
        createGenerateSlotsUseCase,
        createImageGenService,
        createRenderSlotUseCase,
        createArtistPreviewService,
        createWorkbenchService,
        createAutoTriggerService,
        ...(opts.factories && typeof opts.factories === 'object' ? opts.factories : {}),
    };

    const contextCollectorDeps = { host, loadSettings };
    assertRequiredDeps('createContextCollector', contextCollectorDeps, REQUIRED_APP_DEPS.createContextCollector);
    const contextCollector = factories.createContextCollector(contextCollectorDeps);

    const worldInfoResolverDeps = { host };
    assertRequiredDeps('createWorldInfoResolver', worldInfoResolverDeps, REQUIRED_APP_DEPS.createWorldInfoResolver);
    const worldInfoResolver = factories.createWorldInfoResolver(worldInfoResolverDeps);

    // ── 同实例 #1：llm ──────────────────────────────────────────
    const tagRecallDeps = {
        llm,
        tagRepo,
        presetRepo,
        llmConfigRepo,
        loadSettings,
        runHostMacros,
    };
    assertRequiredDeps('createTagRecallService', tagRecallDeps, REQUIRED_APP_DEPS.createTagRecallService);
    const tagRecall = factories.createTagRecallService(tagRecallDeps);

    const imageGenDeps = {
        imageGenPort,
        artistRepo,
        naiConfigRepo,
        characterRepo,
        loadSettings,
        newTraceId,
    };
    assertRequiredDeps('createImageGenService', imageGenDeps, REQUIRED_APP_DEPS.createImageGenService);
    const imageGen = factories.createImageGenService(imageGenDeps);

    // ── 同实例 #1+#2+#3：llm / tagRecall / bus 进 generateSlots ──
    const generateSlotsDeps = {
        host,
        llm,
        characterRepo,
        tagRepo,
        presetRepo,
        slotRepo,
        llmConfigRepo,
        contextCollector,
        worldInfoResolver,
        tagRecall,
        bus,
        loadSettings,
        runHostMacros,
        newId,
        nowIso,
        newTraceId,
    };
    assertRequiredDeps('createGenerateSlotsUseCase', generateSlotsDeps, REQUIRED_APP_DEPS.createGenerateSlotsUseCase);
    const generateSlots = factories.createGenerateSlotsUseCase(generateSlotsDeps);

    // ── 同实例 #3：bus；D36：host ────────────────────────────────
    const renderSlotDeps = {
        imageGen,
        slotRepo,
        imageRepo,
        host,
        bus,
        nowIso,
        newTraceId,
    };
    assertRequiredDeps('createRenderSlotUseCase', renderSlotDeps, REQUIRED_APP_DEPS.createRenderSlotUseCase);
    const renderSlot = factories.createRenderSlotUseCase(renderSlotDeps);

    const artistPreviewDeps = { imageGen, artistRepo, imageRepo };
    assertRequiredDeps('createArtistPreviewService', artistPreviewDeps, REQUIRED_APP_DEPS.createArtistPreviewService);
    const artistPreview = factories.createArtistPreviewService(artistPreviewDeps);

    // ── 同实例 #2：tagRecall（D33）────────────────────────────────
    const workbenchDeps = {
        llm,
        imageGen,
        characterRepo,
        tagRepo,
        presetRepo,
        llmConfigRepo,
        tagRecall,
        loadSettings,
        runHostMacros,
    };
    assertRequiredDeps('createWorkbenchService', workbenchDeps, REQUIRED_APP_DEPS.createWorkbenchService);
    const workbench = factories.createWorkbenchService(workbenchDeps);

    // ── 同实例 #3：bus（D32）─────────────────────────────────────
    const autoTriggerDeps = {
        host,
        generateSlots,
        renderSlot,
        slotRepo,
        loadSettings,
        bus,
    };
    assertRequiredDeps('createAutoTriggerService', autoTriggerDeps, REQUIRED_APP_DEPS.createAutoTriggerService);
    const autoTrigger = factories.createAutoTriggerService(autoTriggerDeps);

    let disposed = false;

    /** @type {AppContainer} */
    const container = {
        host,
        imageGenPort,
        llm,
        bus,
        settingsStore,
        loadSettings,
        runHostMacros,
        repos: {
            character: characterRepo,
            tag: tagRepo,
            artist: artistRepo,
            preset: presetRepo,
            slot: slotRepo,
            llmConfig: llmConfigRepo,
            naiConfig: naiConfigRepo,
            image: imageRepo,
        },
        services: {
            contextCollector,
            worldInfoResolver,
            tagRecall,
            imageGen,
            artistPreview,
            workbench,
            autoTrigger,
        },
        useCases: {
            generateSlots,
            renderSlot,
        },
        shared: Object.freeze({ llm, tagRecall, bus }),
        dispose() {
            if (disposed) {
                return;
            }
            disposed = true;
            try {
                autoTrigger.stop();
            } catch {
                // ignore
            }
            try {
                if (typeof imageRepo.revokeAllUrls === 'function') {
                    imageRepo.revokeAllUrls();
                }
            } catch {
                // ignore
            }
            try {
                bus.clear();
            } catch {
                // ignore
            }
            try {
                host.dispose();
            } catch {
                // ignore
            }
            if (ownsDb && db && typeof db.close === 'function') {
                try {
                    db.close();
                } catch {
                    // ignore
                }
            }
        },
    };

    return container;
}
