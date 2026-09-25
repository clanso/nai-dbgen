import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSillyTavernHost, PLUGIN_NS, ND_ROOT_CLASS, SETTINGS_DRAWER_ID } from '../../src/adapters/host/sillytavern.host.js';
import { defaultPluginSettings } from '../../src/domain/model/plugin-settings.js';
import { assertHostPort } from '../../src/ports/host.port.js';
import { isOk } from '../../src/infra/result.js';
import { GENERATE_INTERCEPTOR_GLOBAL_NAME } from '../../src/adapters/host/generate-interceptor.js';

function makeFakeContext() {
    const chat = [
        { name: 'User', mes: 'hi', is_user: true, is_system: false, extra: {} },
        { name: 'Char', mes: 'hello <IMG>\n1\n</IMG>', is_user: false, is_system: false, extra: {} },
        { name: 'Char', mes: 'second', is_user: false, is_system: false, extra: {} },
    ];
    const extensionSettings = {
        regex: [],
        disabledExtensions: [],
        [PLUGIN_NS]: undefined,
    };
    const extensionPrompts = {};
    const listeners = new Map();

    return {
        chat,
        chatId: 'chat-1',
        chatMetadata: { integrity: 'sess-test-1' },
        maxContext: 4096,
        extensionSettings,
        extensionPrompts,
        powerUserSettings: { encode_tags: false },
        eventTypes: {
            CHAT_CHANGED: 'chat_id_changed',
            CHAT_DELETED: 'chat_deleted',
            GROUP_CHAT_DELETED: 'group_chat_deleted',
            CHAT_RENAMED: 'chat_renamed',
            CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
            MESSAGE_SWIPED: 'message_swiped',
            MESSAGE_UPDATED: 'message_updated',
            MORE_MESSAGES_LOADED: 'more_messages_loaded',
        },
        eventSource: {
            on(event, handler) {
                if (!listeners.has(event)) {
                    listeners.set(event, new Set());
                }
                listeners.get(event).add(handler);
            },
            removeListener(event, handler) {
                listeners.get(event)?.delete(handler);
            },
            emit(event, ...args) {
                for (const h of listeners.get(event) ?? []) {
                    h(...args);
                }
            },
        },
        getCurrentChatId: () => 'chat-1',
        getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
        characters: [],
        groups: [],
        saveSettingsDebounced() {},
        saveMetadataDebounced() {},
        async saveChat() {},
        updateMessageBlock() {},
        getCharacterCardFields: () => ({
            persona: 'p',
            description: 'd',
            personality: 'per',
            charDepthPrompt: '',
            scenario: 's',
            creatorNotes: '',
        }),
        async getWorldInfoPrompt(scanInput) {
            return { worldInfoString: `WI:${scanInput.join('|')}` };
        },
        setExtensionPrompt(key, value, position, depth, scan, role, filter) {
            extensionPrompts[key] = { value, position, depth, scan, role, filter };
        },
        _listeners: listeners,
    };
}

describe('sillytavern.host HostPort', () => {
    it('assertHostPort 通过', () => {
        const ctx = makeFakeContext();
        const host = createSillyTavernHost({ getContext: () => ctx });
        const check = assertHostPort(host);
        assert.equal(check.ok, true);
        host.dispose();
    });

    it('getRecentAiMessages 新→旧且跳过用户/系统楼', () => {
        const ctx = makeFakeContext();
        const host = createSillyTavernHost({ getContext: () => ctx });
        const recent = host.getRecentAiMessages(10);
        assert.equal(recent.length, 2);
        assert.equal(recent[0].text, 'second');
        assert.equal(recent[1].text, 'hello <IMG>\n1\n</IMG>');
        assert.equal(recent[0].messageId, 2);
        host.dispose();
    });

    it('loadSettings / saveSettings 走 PluginSettings', () => {
        const ctx = makeFakeContext();
        const host = createSillyTavernHost({ getContext: () => ctx });
        const defaults = host.loadSettings();
        assert.equal(defaults.contextWindowSize, defaultPluginSettings().contextWindowSize);
        host.saveSettings({ ...defaults, contextWindowSize: 7, autoWriteSlots: true });
        assert.equal(ctx.extensionSettings[PLUGIN_NS].contextWindowSize, 7);
        assert.equal(ctx.extensionSettings[PLUGIN_NS].autoWriteSlots, true);
        host.dispose();
    });


    it('registerOutboundTransform 可取消；创建时注册全局 interceptor', async () => {
        const ctx = makeFakeContext();
        const host = createSillyTavernHost({ getContext: () => ctx });
        assert.equal(typeof globalThis[GENERATE_INTERCEPTOR_GLOBAL_NAME], 'function');
        const unsub = host.registerOutboundTransform((mes) => mes + '!');
        const chat = [{ mes: 'a <IMG>1</IMG>' }];
        await globalThis[GENERATE_INTERCEPTOR_GLOBAL_NAME](chat, 0, () => {}, 'normal');
        assert.equal(chat[0].mes.includes('<IMG>'), false);
        assert.ok(chat[0].mes.endsWith('!'));
        unsub();
        host.dispose();
        assert.equal(globalThis[GENERATE_INTERCEPTOR_GLOBAL_NAME], undefined);
    });

    it('onAiMessageSettled / onChatChanged 可退订', () => {
        const ctx = makeFakeContext();
        const host = createSillyTavernHost({ getContext: () => ctx });
        const settled = [];
        const chats = [];
        const u1 = host.onAiMessageSettled((id) => settled.push(id));
        const u2 = host.onChatChanged((id) => chats.push(id));
        ctx.eventSource.emit(ctx.eventTypes.CHARACTER_MESSAGE_RENDERED, 5);
        ctx.eventSource.emit(ctx.eventTypes.CHAT_CHANGED, 'c2');
        assert.deepEqual(settled, [5]);
        assert.deepEqual(chats, ['c2']);
        u1();
        u2();
        ctx.eventSource.emit(ctx.eventTypes.CHARACTER_MESSAGE_RENDERED, 6);
        assert.deepEqual(settled, [5]);
        host.dispose();
    });

    it('D38 回翻 MESSAGE_SWIPED 不触发 settled；RENDERED 仍触发', () => {
        const ctx = makeFakeContext();
        ctx.eventTypes.MESSAGE_SWIPED = 'message_swiped';
        const host = createSillyTavernHost({ getContext: () => ctx });
        const settled = [];
        host.onAiMessageSettled((id) => settled.push(id));

        // 回翻已有 swipe（与新生成 overs wipe 共用同一事件，无法区分）
        ctx.eventSource.emit(ctx.eventTypes.MESSAGE_SWIPED, 2);
        assert.deepEqual(settled, [], '浏览 swipe 不得触发 settled');

        // 新 swipe 生成完成后仍走 CHARACTER_MESSAGE_RENDERED
        ctx.eventSource.emit(ctx.eventTypes.CHARACTER_MESSAGE_RENDERED, 2, 'swipe');
        assert.deepEqual(settled, [2]);
        host.dispose();
    });

    it('resolveWorldInfo 使用 scanInput（含人名）', async () => {
        const ctx = makeFakeContext();
        const host = createSillyTavernHost({ getContext: () => ctx });
        const r = await host.resolveWorldInfo({
            contextWindow: [
                { messageId: 2, name: 'Char', text: 'second', isUser: false, isSystem: false },
                { messageId: 1, name: 'Char', text: 'first', isUser: false, isSystem: false },
            ],
            messageId: 2,
        });
        assert.equal(isOk(r), true);
        // 动态 import world-info 在 Node 失败 → includeNames 默认 true
        assert.equal(r.value, 'WI:Char: second|Char: first');
        host.dispose();
    });

    it('resolveWorldInfo 用 Chat Completion 的可用上下文，不用 maxContext 滑杆', async () => {
        const ctx = makeFakeContext();
        ctx.mainApi = 'openai';
        ctx.maxContext = 2048;
        ctx.chatCompletionSettings = {
            openai_max_context: 128000,
            openai_max_tokens: 4096,
        };
        /** @type {number|undefined} */
        let seenMax;
        ctx.getWorldInfoPrompt = async (scanInput, maxContext) => {
            seenMax = maxContext;
            return { worldInfoString: `WI:${scanInput.join('|')}` };
        };
        const host = createSillyTavernHost({ getContext: () => ctx });
        const r = await host.resolveWorldInfo({
            contextWindow: [{ messageId: 1, name: 'Char', text: 'hi', isUser: false, isSystem: false }],
        });
        assert.equal(isOk(r), true);
        assert.equal(seenMax, 128000 - 4096);
        host.dispose();
    });

    it('D18 dispose 是可枚举契约方法且 assertHostPort 通过', () => {
        const ctx = makeFakeContext();
        const host = createSillyTavernHost({ getContext: () => ctx });
        assert.equal(typeof host.dispose, 'function');
        assert.equal(Object.keys(host).includes('dispose'), true);
        assert.equal(assertHostPort(host).ok, true);
        host.dispose();
        host.dispose(); // 可重复
    });

    it('D20 openModal 透传 wide/large/allowVerticalScrolling；D52 挂 nd-root class', async () => {
        /** @type {object|null} */
        let seenOpts = null;
        /** @type {object|null} */
        let seenContent = null;
        const ctx = makeFakeContext();
        ctx.POPUP_TYPE = { DISPLAY: 4 };
        ctx.callGenericPopup = async (content, _type, _input, popupOpts) => {
            seenContent = content;
            seenOpts = popupOpts;
        };

        const prevDoc = globalThis.document;
        globalThis.document = {
            createElement(tag) {
                const classes = new Set();
                return {
                    id: '',
                    tagName: String(tag).toUpperCase(),
                    textContent: '',
                    classList: {
                        add(...names) {
                            for (const n of names) {
                                classes.add(n);
                            }
                        },
                        contains(n) {
                            return classes.has(n);
                        },
                    },
                    appendChild() {},
                };
            },
        };

        const host = createSillyTavernHost({ getContext: () => ctx });
        const el = {
            nodeType: 1,
            classList: {
                add() {},
                contains() {
                    return false;
                },
            },
        };
        await host.openModal({
            title: '小确认',
            element: el,
            wide: false,
            large: false,
            allowVerticalScrolling: false,
        });
        assert.deepEqual(seenOpts, {
            wide: false,
            large: false,
            allowVerticalScrolling: false,
        });
        assert.equal(seenContent?.classList?.contains(ND_ROOT_CLASS), true);
        assert.notEqual(seenContent?.id, 'nai-dbgen-root');

        seenOpts = null;
        await host.openModal({
            title: '管理台',
            element: el,
            wide: true,
            large: true,
            allowVerticalScrolling: true,
        });
        assert.deepEqual(seenOpts, {
            wide: true,
            large: true,
            allowVerticalScrolling: true,
        });

        // 未传的选项不得被写死塞进 popupOpts
        seenOpts = null;
        await host.openModal({ title: 't', element: el });
        assert.deepEqual(seenOpts, {});
        host.dispose();
        globalThis.document = prevDoc;
    });

    it('D28 dispose 移除设置抽屉；斜杠同名幂等覆盖', () => {
        const commands = {};
        const ctx = makeFakeContext();
        ctx.SlashCommand = {
            fromProps(spec) {
                return { name: spec.name, aliases: spec.aliases ?? [], ...spec };
            },
        };
        ctx.SlashCommandParser = {
            addCommandObject(cmd) {
                commands[cmd.name] = cmd;
            },
            commands,
        };

        // 最小 document 替身
        const drawers = new Map();
        const fakeDoc = {
            getElementById(id) {
                if (id === 'extensions_settings2') {
                    return {
                        querySelector(sel) {
                            if (sel === '#nai-dbgen-settings-drawer') {
                                return drawers.get('nai-dbgen-settings-drawer') ?? null;
                            }
                            return null;
                        },
                        appendChild(el) {
                            drawers.set(el.id, el);
                        },
                    };
                }
                return drawers.get(id) ?? null;
            },
        };
        const prevDoc = globalThis.document;
        globalThis.document = fakeDoc;

        const host = createSillyTavernHost({ getContext: () => ctx });
        const panel = {
            id: 'panel',
            // replaceChildren no-op for duck
        };
        // mountSettingsPanel 需要 element 与 createElement
        fakeDoc.createElement = (tag) => {
            const el = {
                id: '',
                className: '',
                tagName: tag,
                replaceChildren() {},
                remove() {
                    drawers.delete(this.id);
                },
                parentNode: {
                    removeChild(child) {
                        drawers.delete(child.id);
                    },
                },
            };
            return el;
        };
        // Re-get hostEl path: getElementById extensions_settings2
        const hostEl = fakeDoc.getElementById('extensions_settings2');
        let drawerRef = null;
        hostEl.querySelector = (sel) => {
            if (sel === '#nai-dbgen-settings-drawer') {
                return drawerRef;
            }
            return null;
        };
        hostEl.appendChild = (el) => {
            drawerRef = el;
            drawers.set(el.id, el);
            el.remove = () => {
                drawers.delete(el.id);
                drawerRef = null;
            };
        };

        host.mountSettingsPanel(panel);
        assert.ok(drawers.has(SETTINGS_DRAWER_ID));

        host.registerSlashCommand({ name: 'naidb', callback: () => 'a' });
        host.registerSlashCommand({ name: 'naidb', callback: () => 'b' });
        assert.equal(commands.naidb.callback(), 'b');

        host.dispose();
        assert.equal(drawers.has(SETTINGS_DRAWER_ID), false);

        globalThis.document = prevDoc;
    });
});
