/**
 * 演示页同款装配（Node 冒烟）：fake host + fixtures + fake gateways + 内存服务器文件。
 */

import { activate, dispose, _runtimeForTest, PUBLIC_API_NAME } from '../../src/bootstrap/lifecycle.js';
import { createMemoryIdb } from '../../src/adapters/storage/memory-idb.js';
import { createMemoryServerFiles } from '../../src/adapters/storage/memory-server-files.js';
import { createArtistPreviewService } from '../../src/application/artist-preview.service.js';
import { GENERATE_INTERCEPTOR_GLOBAL_NAME } from '../../src/adapters/host/generate-interceptor.js';
import { createFakeHost } from '../../preview/fake-host.js';
import { createFakeLlmPort, createFakeImageGenPort } from '../../preview/fake-gateways.js';
import {
    FIXTURE_CHAT_ID,
    fixtureIdbSeed,
    fixtureSettings,
    fixtureWorldInfo,
} from '../../preview/fixtures.js';
import { installFakeDom } from '../ui/fake-dom.js';

/**
 * @returns {{ getItem: (k: string) => string|null, setItem: (k: string, v: string) => void, clear: () => void }}
 */
function createMemoryStorage() {
    /** @type {Map<string, string>} */
    const map = new Map();
    return {
        getItem(k) {
            return map.has(k) ? /** @type {string} */ (map.get(k)) : null;
        },
        setItem(k, v) {
            map.set(String(k), String(v));
        },
        clear() {
            map.clear();
        },
    };
}

/**
 * @returns {object}
 */
function createPreviewStContext() {
    return {
        chat: [],
        chatId: FIXTURE_CHAT_ID,
        maxContext: 4096,
        extensionSettings: {
            regex: [],
            disabledExtensions: [],
            'nai-dbgen': undefined,
        },
        extensionPrompts: {},
        powerUserSettings: { encode_tags: false },
        eventTypes: {
            CHAT_CHANGED: 'chat_id_changed',
            CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
            MESSAGE_UPDATED: 'message_updated',
            MORE_MESSAGES_LOADED: 'more_messages_loaded',
        },
        eventSource: {
            on() {},
            removeListener() {},
        },
        getCurrentChatId: () => FIXTURE_CHAT_ID,
        saveSettingsDebounced() {},
        async saveChat() {},
        updateMessageBlock() {},
        async getWorldInfoPrompt() {
            return { worldInfoString: '' };
        },
        setExtensionPrompt() {},
        SlashCommandParser: { addCommandObject() {} },
        SlashCommand: { fromProps: (spec) => spec },
        substituteParams: (t) => t,
        callGenericPopup: async () => {},
    };
}

/**
 * @param {object} [opts]
 * @returns {Promise<{
 *   host: ReturnType<typeof createFakeHost>,
 *   llm: ReturnType<typeof createFakeLlmPort>,
 *   imageGen: ReturnType<typeof createFakeImageGenPort>,
 *   container: NonNullable<ReturnType<typeof _runtimeForTest>['container']>,
 *   serverFiles: ReturnType<typeof createMemoryServerFiles>,
 *   fakeDom: ReturnType<typeof installFakeDom>,
 *   destroy: () => Promise<void>,
 * }>}
 */
export async function bootPreviewRuntime(opts = {}) {
    await dispose();

    const fakeDom = installFakeDom();
    const chatRoot = fakeDom.document.createElement('div');
    chatRoot.id = 'chat';
    const settingsMount = fakeDom.document.createElement('div');
    settingsMount.id = 'pv-settings-mount';
    fakeDom.document.body.appendChild(chatRoot);
    fakeDom.document.body.appendChild(settingsMount);

    if (typeof globalThis[GENERATE_INTERCEPTOR_GLOBAL_NAME] !== 'function') {
        globalThis[GENERATE_INTERCEPTOR_GLOBAL_NAME] = function NaiDbGen_StripSlots(text) {
            return text;
        };
    }

    const host = createFakeHost({
        settings: fixtureSettings(),
        worldInfoText: fixtureWorldInfo(),
        ...(opts.hostOpts && typeof opts.hostOpts === 'object' ? opts.hostOpts : {}),
    });
    host._ctrl.setChatRoot(chatRoot);
    host._ctrl.setSettingsMount(settingsMount);

    const llm = createFakeLlmPort({ delayMs: 0 });
    const imageGen = createFakeImageGenPort({ delayMs: 0 });
    const db = createMemoryIdb(fixtureIdbSeed());
    const serverFiles = createMemoryServerFiles();
    const seedStorage = createMemoryStorage();
    const getContext = () => createPreviewStContext();

    await activate({
        getContext,
        containerOpts: {
            host,
            llm,
            imageGenPort: imageGen,
            db,
            serverFiles,
            getContext,
            factories: {
                createArtistPreviewService: (deps) => createArtistPreviewService({
                    ...deps,
                    makeCardImage: async (blob) => blob,
                }),
            },
        },
        seedOpts: {
            storage: seedStorage,
            getContext,
        },
    });

    const container = _runtimeForTest().container;
    if (!container) {
        fakeDom.restore();
        throw new Error('bootPreviewRuntime: activate 后 container 为空');
    }

    return {
        host,
        llm,
        imageGen,
        container,
        serverFiles,
        fakeDom,
        api: globalThis[PUBLIC_API_NAME],
        async destroy() {
            await dispose();
            fakeDom.restore();
        },
    };
}
