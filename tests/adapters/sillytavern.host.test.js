import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createSillyTavernHost, PLUGIN_NS } from '../../src/adapters/host/sillytavern.host.js';
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
        maxContext: 4096,
        extensionSettings,
        extensionPrompts,
        powerUserSettings: { encode_tags: false },
        eventTypes: {
            CHAT_CHANGED: 'chat_id_changed',
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
        saveSettingsDebounced() {},
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

    it('writeMessageExtra 合并写入 nai-dbgen 命名空间', async () => {
        const ctx = makeFakeContext();
        const host = createSillyTavernHost({ getContext: () => ctx });
        const r = await host.writeMessageExtra(1, { slots: { 1: { status: 'ready' } } });
        assert.equal(isOk(r), true);
        assert.deepEqual(host.readMessageExtra(1).slots, { 1: { status: 'ready' } });
        const r2 = await host.writeMessageExtra(1, { note: 'x' });
        assert.equal(isOk(r2), true);
        assert.equal(host.readMessageExtra(1).note, 'x');
        assert.ok(host.readMessageExtra(1).slots);
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
});
