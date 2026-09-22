/**
 * W3 · lifecycle：activate 失败回滚、dispose 再 activate、对外入口、宿主降级。
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    activate,
    dispose,
    _runtimeForTest,
    PUBLIC_API_NAME,
} from '../../src/bootstrap/lifecycle.js';
import { createContainer } from '../../src/bootstrap/container.js';
import { createMemoryIdb } from '../../src/adapters/storage/memory-idb.js';
import { createSillyTavernHost, PLUGIN_NS } from '../../src/adapters/host/sillytavern.host.js';
import { GENERATE_INTERCEPTOR_GLOBAL_NAME } from '../../src/adapters/host/generate-interceptor.js';
import { installFakeDom } from '../ui/fake-dom.js';
import { emptyNaiCaption } from '../../src/domain/model/nai-params.js';
import { probeCapabilities } from '../../src/bootstrap/capabilities.js';

function makeFakeContext(overrides = {}) {
    const slashRegistry = [];
    const listeners = new Map();
    const ctx = {
        chat: [
            { name: 'User', mes: 'hi', is_user: true, is_system: false, extra: {} },
            { name: 'Char', mes: 'hello', is_user: false, is_system: false, extra: {} },
        ],
        chatId: 'chat-life',
        maxContext: 4096,
        extensionSettings: {
            regex: [],
            disabledExtensions: [],
            [PLUGIN_NS]: undefined,
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
            on(event, handler) {
                if (!listeners.has(event)) listeners.set(event, new Set());
                listeners.get(event).add(handler);
            },
            removeListener(event, handler) {
                listeners.get(event)?.delete(handler);
            },
        },
        getCurrentChatId: () => 'chat-life',
        saveSettingsDebounced() {},
        async saveChat() {},
        updateMessageBlock() {},
        async getWorldInfoPrompt() {
            return { worldInfoString: '' };
        },
        setExtensionPrompt() {},
        SlashCommandParser: {
            addCommandObject(cmd) {
                slashRegistry.push(cmd?.name ?? '');
            },
        },
        SlashCommand: {
            fromProps(spec) {
                return spec;
            },
        },
        substituteParams: (t) => t,
        callGenericPopup: async () => {},
        _slashRegistry: slashRegistry,
        ...overrides,
    };
    return ctx;
}

describe('bootstrap/lifecycle', () => {
    /** @type {ReturnType<typeof installFakeDom>|null} */
    let fakeDom = null;
    /** @type {string[]} */
    let toasts = [];

    beforeEach(async () => {
        await dispose();
        toasts = [];
        globalThis.toastr = {
            info: (m) => { toasts.push(['info', m]); },
            success: (m) => { toasts.push(['success', m]); },
            warning: (m) => { toasts.push(['warning', m]); },
            error: (m) => { toasts.push(['error', m]); },
        };
        fakeDom = installFakeDom();
        // extensions_settings2 挂载点
        const settings = fakeDom.document.createElement('div');
        settings.id = 'extensions_settings2';
        fakeDom.document.body.appendChild(settings);
        const chat = fakeDom.document.createElement('div');
        chat.id = 'chat';
        fakeDom.document.body.appendChild(chat);
    });

    afterEach(async () => {
        await dispose();
        fakeDom?.restore();
        fakeDom = null;
        delete globalThis.toastr;
        delete globalThis[PUBLIC_API_NAME];
        delete globalThis[GENERATE_INTERCEPTOR_GLOBAL_NAME];
    });

    it('activate 成功：挂上对外入口与 interceptor', async () => {
        const ctx = makeFakeContext();
        const getContext = () => ctx;
        await activate({
            getContext,
            createContainer: (opts) => createContainer({
                ...opts,
                getContext,
                host: createSillyTavernHost({ getContext }),
                db: createMemoryIdb(),
            }),
        });

        const rt = _runtimeForTest();
        assert.ok(rt.container);
        assert.equal(typeof globalThis[PUBLIC_API_NAME].generate, 'function');
        assert.equal(typeof globalThis[GENERATE_INTERCEPTOR_GLOBAL_NAME], 'function');
        assert.ok(ctx._slashRegistry.includes('naigen'));
        assert.ok(ctx._slashRegistry.includes('naiwb'));
    });

    it('对外入口缺 replaceCharacterKeywords → 报错', async () => {
        const ctx = makeFakeContext();
        const getContext = () => ctx;
        await activate({
            getContext,
            createContainer: (opts) => createContainer({
                ...opts,
                getContext,
                host: createSillyTavernHost({ getContext }),
                db: createMemoryIdb(),
            }),
        });

        await assert.rejects(
            () => globalThis[PUBLIC_API_NAME].generate({ caption: emptyNaiCaption() }),
            /replaceCharacterKeywords/,
        );
    });

    it('activate 中途失败 → 已建资源被回收、不抛到宿主', async () => {
        const ctx = makeFakeContext();
        const getContext = () => ctx;
        let disposed = false;

        await activate({
            getContext,
            createContainer: async (opts) => {
                const c = await createContainer({
                    ...opts,
                    getContext,
                    host: createSillyTavernHost({ getContext }),
                    db: createMemoryIdb(),
                });
                const origDispose = c.dispose.bind(c);
                c.dispose = () => {
                    disposed = true;
                    origDispose();
                };
                const origStart = c.services.autoTrigger.start.bind(c.services.autoTrigger);
                c.services.autoTrigger.start = () => {
                    throw new Error('模拟自动触发启动失败');
                };
                // 保留 stop
                c.services.autoTrigger._origStart = origStart;
                return c;
            },
        });

        // 不抛；运行时已清空
        const rt = _runtimeForTest();
        assert.equal(rt.container, null);
        assert.equal(globalThis[PUBLIC_API_NAME], undefined);
        assert.equal(disposed, true);
        assert.ok(toasts.some((t) => t[0] === 'error' && /启动失败/.test(t[1])));
    });

    it('dispose 后再 activate → 斜杠不重复累积泄漏态', async () => {
        const ctx = makeFakeContext();
        const getContext = () => ctx;
        const make = () => activate({
            getContext,
            createContainer: (opts) => createContainer({
                ...opts,
                getContext,
                host: createSillyTavernHost({ getContext }),
                db: createMemoryIdb(),
            }),
        });

        await make();
        const firstCount = ctx._slashRegistry.filter((n) => n === 'naigen').length;
        await dispose();
        assert.equal(_runtimeForTest().container, null);
        assert.equal(globalThis[PUBLIC_API_NAME], undefined);

        await make();
        const secondCount = ctx._slashRegistry.filter((n) => n === 'naigen').length;
        // 宿主无卸载 API：会再注册一次（覆盖语义），但运行时只有一份 container
        assert.equal(firstCount, 1);
        assert.equal(secondCount, 2);
        assert.ok(_runtimeForTest().container);
    });

    it('宿主缺关键 API → 优雅降级并报中文错误', async () => {
        // getContext 抛错 → 能力探测失败
        await activate({
            getContext: () => {
                throw new Error('no ctx');
            },
            createContainer: async () => {
                // 仍需一个能 dispose 的最小容器；这里直接让 create 抛
                throw new Error('找不到 SillyTavern.getContext；请确认在酒馆页面内加载本插件');
            },
        });

        assert.equal(_runtimeForTest().container, null);
        assert.ok(toasts.some((t) => t[0] === 'error' && /启动失败|找不到/.test(t[1])));
    });

    it('probeCapabilities：旧版缺 eventSource 标为不可用', async () => {
        const host = {
            getCurrentChatId: () => null,
            ensureSlotRegexInstalled: async () => ({ ok: true }),
            toast() {},
            dispose() {},
        };
        const report = await probeCapabilities(/** @type {any} */ (host), {
            getContext: () => ({
                extensionSettings: {},
                // 无 eventSource
            }),
            assume: { indexedDB: true },
        });
        const item = report.items.find((i) => i.id === 'eventSource');
        assert.equal(item?.available, false);
        assert.ok(/自动写 slot/.test(item?.detail || ''));
    });
});
