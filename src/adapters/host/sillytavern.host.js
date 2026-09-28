/**
 * L2 适配器 · HostPort 的 SillyTavern 实现（版本敏感代码唯一容身处）。
 * 归属：W1-B 宿主代理实现。W0 仅冻结签名。
 */

import { Ok, Err } from '../../infra/result.js';
import { hostError } from '../../infra/errors.js';
import {
    defaultPluginSettings,
    normalizePluginSettings,
    validatePluginSettings,
} from '../../domain/model/plugin-settings.js';
import { createRegexScriptInstaller } from './regex-script.installer.js';
import {
    buildWorldInfoScanInput,
    createWorldInfoSource,
} from './worldinfo.source.js';
import {
    createGenerateInterceptor,
    registerGenerateInterceptorGlobal,
    unregisterGenerateInterceptorGlobal,
} from './generate-interceptor.js';
import { resolveStPublicModuleUrl } from './st-yaml.js';

/** extension_settings / message.extra 命名空间（裁决 D8 / D12） */
export const PLUGIN_NS = 'nai-dbgen';

/** 设置抽屉 DOM id（dispose 必须移除，裁决 D28；单例保留 id） */
export const SETTINGS_DRAWER_ID = 'nai-dbgen-settings-drawer';

/** 作用域根 class（裁决 D52；可多实例并存，不用 id） */
export const ND_ROOT_CLASS = 'nd-root';

/**
 * @typedef {object} SillyTavernHostDeps
 * @property {() => any} getContext 通常 () => SillyTavern.getContext()
 * @property {ReturnType<import('../../infra/event-bus.js').createEventBus>} [bus]
 */

/**
 * @param {any} msg
 * @param {number} messageId
 * @returns {import('../../ports/host.port.js').HostMessage}
 */
function toHostMessage(msg, messageId) {
    return {
        messageId,
        name: typeof msg?.name === 'string' ? msg.name : '',
        text: typeof msg?.mes === 'string' ? msg.mes : '',
        isUser: !!msg?.is_user,
        isSystem: !!msg?.is_system,
        extra: msg?.extra && typeof msg.extra === 'object' ? msg.extra : undefined,
    };
}

/**
 * @param {any} ctx
 * @returns {any[]}
 */
function getChatArray(ctx) {
    return Array.isArray(ctx?.chat) ? ctx.chat : [];
}

/**
 * 读取 world_info_include_names（宿主知识，不上浮）。
 * 优先动态 import 酒馆模块；失败则默认 true（与 ST 默认一致）。
 * @returns {Promise<boolean>}
 */
async function readWorldInfoIncludeNames() {
    try {
        const url = resolveStPublicModuleUrl('scripts/world-info.js');
        const mod = await import(url);
        if (typeof mod.world_info_include_names === 'boolean') {
            return mod.world_info_include_names;
        }
    } catch {
        // Node / 无 ST 环境
    }
    return true;
}

/**
 * 与 script.js getMaxPromptTokens() 同一口径：世界书预算按这个数算。
 * Chat Completion 用 openai_max_context 减回复长度。maxContext 是文本补全那条滑杆，不能拿来算。
 * @param {any} ctx
 * @returns {number}
 */
function worldInfoMaxContext(ctx) {
    const api = ctx?.mainApi;
    if (api === 'openai') {
        const oai = ctx.chatCompletionSettings;
        const max = Number(oai?.openai_max_context);
        const reserved = Number(oai?.openai_max_tokens);
        if (Number.isFinite(max) && max > 0) {
            const reply = Number.isFinite(reserved) && reserved > 0 ? reserved : 0;
            return Math.max(0, max - reply);
        }
    }
    const max = Number(ctx?.maxContext);
    return Number.isFinite(max) && max > 0 ? max : 0;
}

/**
 * @param {any} ctx
 * @returns {object}
 */
function buildGlobalScanData(ctx) {
    try {
        if (typeof ctx.getCharacterCardFields === 'function') {
            const fields = ctx.getCharacterCardFields();
            return {
                personaDescription: fields?.persona ?? '',
                characterDescription: fields?.description ?? '',
                characterPersonality: fields?.personality ?? '',
                characterDepthPrompt: fields?.charDepthPrompt ?? '',
                scenario: fields?.scenario ?? '',
                creatorNotes: fields?.creatorNotes ?? '',
                trigger: 'normal',
            };
        }
    } catch {
        // fall through
    }
    return {
        personaDescription: '',
        characterDescription: '',
        characterPersonality: '',
        characterDepthPrompt: '',
        scenario: '',
        creatorNotes: '',
        trigger: 'normal',
    };
}

/**
 * @param {SillyTavernHostDeps} deps
 * @returns {import('../../ports/host.port.js').HostPort}
 */
export function createSillyTavernHost(deps) {
    if (!deps || typeof deps.getContext !== 'function') {
        throw new Error('invalid argument: deps.getContext');
    }
    const getContext = deps.getContext;

    const regexInstaller = createRegexScriptInstaller({ getContext });
    const worldInfoSource = createWorldInfoSource({ getContext });

    /** @type {Set<(mes: string, msgMeta: object) => string>} */
    const outboundTransforms = new Set();

    const interceptor = createGenerateInterceptor({
        getTransforms: () => [...outboundTransforms],
    });
    registerGenerateInterceptorGlobal(interceptor);

    /** @type {Set<(messageEl: Element, messageId: number) => void>} */
    const domReadyListeners = new Set();
    /** @type {Set<(chatId: string|null) => void>} */
    const chatChangedListeners = new Set();
    /** @type {Set<(chatFileName: string) => void>} */
    const chatDeletedListeners = new Set();
    /** @type {Set<(groupChatId: string) => void>} */
    const groupChatDeletedListeners = new Set();
    /** @type {Set<(info: object) => void>} */
    const chatRenamedListeners = new Set();
    /** @type {Set<(messageId: number) => void>} */
    const aiSettledListeners = new Set();

    /** @type {Array<{ event: string, handler: Function }>} */
    const eventBindings = [];
    /** @type {MutationObserver|null} */
    let domReadyObserver = null;
    /** @type {ReturnType<typeof setTimeout>|null} */
    let domReadyDebounce = null;
    let lifecycleBound = false;

    /**
     * 已注册斜杠命令名（宿主无卸载 API，裁决 D28：幂等覆盖注册）。
     * @type {Set<string>}
     */
    const registeredSlashNames = new Set();

    /**
     * @returns {void}
     */
    function ensureLifecycleBound() {
        if (lifecycleBound) {
            return;
        }
        lifecycleBound = true;
        const ctx = safeContext();
        const es = ctx?.eventSource;
        const et = ctx?.eventTypes ?? ctx?.event_types;
        if (es && et && typeof es.on === 'function') {
            const onChat = (chatId) => {
                for (const fn of chatChangedListeners) {
                    try {
                        fn(chatId ?? null);
                    } catch {
                        // ignore listener errors
                    }
                }
            };
            const onSettled = (messageId) => {
                const id = Number(messageId);
                if (!Number.isInteger(id)) {
                    return;
                }
                for (const fn of aiSettledListeners) {
                    try {
                        fn(id);
                    } catch {
                        // ignore
                    }
                }
            };
            bindEvent(es, et.CHAT_CHANGED, onChat);
            if (et.CHAT_DELETED) {
                bindEvent(es, et.CHAT_DELETED, (name) => {
                    const fileName = String(name ?? '');
                    for (const fn of chatDeletedListeners) {
                        try {
                            fn(fileName);
                        } catch {
                            // ignore
                        }
                    }
                });
            }
            if (et.GROUP_CHAT_DELETED) {
                bindEvent(es, et.GROUP_CHAT_DELETED, (id) => {
                    const groupChatId = String(id ?? '');
                    for (const fn of groupChatDeletedListeners) {
                        try {
                            fn(groupChatId);
                        } catch {
                            // ignore
                        }
                    }
                });
            }
            if (et.CHAT_RENAMED) {
                bindEvent(es, et.CHAT_RENAMED, (info) => {
                    for (const fn of chatRenamedListeners) {
                        try {
                            fn(info && typeof info === 'object' ? info : {});
                        } catch {
                            // ignore
                        }
                    }
                });
            }
            if (et.CHARACTER_MESSAGE_RENDERED) {
                bindEvent(es, et.CHARACTER_MESSAGE_RENDERED, onSettled);
            }
            // 裁决 D38：故意不接 MESSAGE_SWIPED。
            // 回翻已有 swipe 与「overswipe 开新生成」都会 emit MESSAGE_SWIPED
            //（script.js:10315），事件载荷只有 mesId，无法区分。
            // 新 swipe 正文落定仍由 CHARACTER_MESSAGE_RENDERED 覆盖
            //（非流式 script.js:6693；流式 :3800）。宁可少触发，不可浏览扣费。
            if (et.MESSAGE_UPDATED) {
                bindEvent(es, et.MESSAGE_UPDATED, (messageId) => {
                    notifyDomReadyForMessage(Number(messageId));
                });
            }
            if (et.MORE_MESSAGES_LOADED) {
                bindEvent(es, et.MORE_MESSAGES_LOADED, () => {
                    scheduleDomReadySweep();
                });
            }
        }
        ensureDomReadyObserver();
    }

    /**
     * @param {any} es
     * @param {string} event
     * @param {Function} handler
     * @returns {void}
     */
    function bindEvent(es, event, handler) {
        if (!event || typeof handler !== 'function') {
            return;
        }
        es.on(event, handler);
        eventBindings.push({ event, handler });
    }

    /**
     * @returns {any|null}
     */
    function safeContext() {
        try {
            return getContext();
        } catch {
            return null;
        }
    }

    /**
     * @returns {void}
     */
    function ensureDomReadyObserver() {
        if (domReadyObserver || typeof MutationObserver !== 'function') {
            return;
        }
        const root = typeof document !== 'undefined' ? document.getElementById('chat') : null;
        if (!root) {
            return;
        }
        domReadyObserver = new MutationObserver(() => {
            scheduleDomReadySweep();
        });
        domReadyObserver.observe(root, { childList: true, subtree: true });
        scheduleDomReadySweep();
    }

    /**
     * @returns {void}
     */
    function scheduleDomReadySweep() {
        if (domReadyDebounce != null) {
            clearTimeout(domReadyDebounce);
        }
        domReadyDebounce = setTimeout(() => {
            domReadyDebounce = null;
            sweepDomReady();
        }, 50);
    }

    /**
     * @returns {void}
     */
    function sweepDomReady() {
        if (typeof document === 'undefined') {
            return;
        }
        const nodes = document.querySelectorAll('#chat .mes[mesid]');
        for (const messageEl of nodes) {
            const id = Number(messageEl.getAttribute('mesid'));
            if (!Number.isInteger(id)) {
                continue;
            }
            notifyDomReadyListeners(messageEl, id);
        }
    }

    /**
     * @param {number} messageId
     * @returns {void}
     */
    function notifyDomReadyForMessage(messageId) {
        if (typeof document === 'undefined' || !Number.isInteger(messageId)) {
            return;
        }
        const messageEl = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
        if (messageEl) {
            notifyDomReadyListeners(messageEl, messageId);
        }
    }

    /**
     * @param {Element} messageEl
     * @param {number} messageId
     * @returns {void}
     */
    function notifyDomReadyListeners(messageEl, messageId) {
        for (const fn of domReadyListeners) {
            try {
                fn(messageEl, messageId);
            } catch {
                // ignore
            }
        }
    }

    /**
     * @returns {import('../../ports/host.port.js').HostPort}
     */
    const host = {
        getCurrentChatId() {
            const ctx = safeContext();
            if (!ctx) {
                return null;
            }
            try {
                if (typeof ctx.getCurrentChatId === 'function') {
                    const id = ctx.getCurrentChatId();
                    return id == null || id === '' ? null : String(id);
                }
                if (ctx.chatId != null && ctx.chatId !== '') {
                    return String(ctx.chatId);
                }
            } catch {
                // ignore
            }
            return null;
        },

        getSessionId() {
            const ctx = safeContext();
            if (!ctx) {
                return null;
            }
            try {
                let meta = ctx.chatMetadata || ctx.chat_metadata;
                if (!meta || typeof meta !== 'object') {
                    meta = {};
                    if (ctx.chatMetadata !== undefined) {
                        ctx.chatMetadata = meta;
                    }
                }
                if (meta.integrity != null && String(meta.integrity).trim()) {
                    return String(meta.integrity);
                }
                const generated = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
                    ? crypto.randomUUID()
                    : `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
                meta.integrity = generated;
                if (typeof ctx.saveMetadataDebounced === 'function') {
                    try {
                        ctx.saveMetadataDebounced();
                    } catch {
                        // ignore
                    }
                } else if (typeof ctx.saveMetadata === 'function') {
                    try {
                        void ctx.saveMetadata();
                    } catch {
                        // ignore
                    }
                }
                return generated;
            } catch {
                return null;
            }
        },

        getChatLocation() {
            const ctx = safeContext();
            /** @type {{ chatFileName: string|null, avatarUrl: string|null, groupId: string|null }} */
            const empty = { chatFileName: null, avatarUrl: null, groupId: null };
            if (!ctx) {
                return empty;
            }
            try {
                const chatFileName = (() => {
                    if (typeof ctx.getCurrentChatId === 'function') {
                        const id = ctx.getCurrentChatId();
                        return id == null || id === '' ? null : String(id);
                    }
                    return ctx.chatId != null && ctx.chatId !== '' ? String(ctx.chatId) : null;
                })();
                const groupId = ctx.groupId != null && ctx.groupId !== ''
                    ? String(ctx.groupId)
                    : null;
                let avatarUrl = null;
                try {
                    const characters = ctx.characters;
                    const chid = ctx.characterId ?? ctx.this_chid;
                    if (Array.isArray(characters) && chid != null && characters[chid]) {
                        avatarUrl = characters[chid].avatar != null
                            ? String(characters[chid].avatar)
                            : null;
                    }
                } catch {
                    // ignore
                }
                return { chatFileName, avatarUrl, groupId };
            } catch {
                return empty;
            }
        },

        getMessages() {
            const chat = getChatArray(safeContext());
            return chat.map((m, i) => toHostMessage(m, i));
        },

        getRecentAiMessages(n) {
            const limit = Number.isFinite(Number(n)) ? Math.max(0, Math.floor(Number(n))) : 0;
            const chat = getChatArray(safeContext());
            /** @type {import('../../ports/host.port.js').HostMessage[]} */
            const out = [];
            for (let i = chat.length - 1; i >= 0 && out.length < limit; i -= 1) {
                const m = chat[i];
                if (!m || m.is_user || m.is_system) {
                    continue;
                }
                out.push(toHostMessage(m, i));
            }
            return out;
        },

        getMessage(messageId) {
            const chat = getChatArray(safeContext());
            const id = Number(messageId);
            if (!Number.isInteger(id) || id < 0 || id >= chat.length) {
                return null;
            }
            return toHostMessage(chat[id], id);
        },

        getMessageSwipeTexts(messageId) {
            const chat = getChatArray(safeContext());
            const id = Number(messageId);
            if (!Number.isInteger(id) || id < 0 || id >= chat.length) {
                return [];
            }
            const msg = chat[id];
            /** @type {string[]} */
            const texts = [];
            if (Array.isArray(msg?.swipes) && msg.swipes.length > 0) {
                for (const swipe of msg.swipes) {
                    texts.push(typeof swipe === 'string' ? swipe : String(swipe ?? ''));
                }
            } else {
                texts.push(typeof msg?.mes === 'string' ? msg.mes : '');
            }
            return texts;
        },

        async replaceMessageText(messageId, newText) {
            try {
                const ctx = safeContext();
                const chat = getChatArray(ctx);
                const id = Number(messageId);
                if (!ctx || !Number.isInteger(id) || id < 0 || id >= chat.length) {
                    return Err(hostError({
                        code: 'MESSAGE_NOT_FOUND',
                        message: '找不到要改写的楼层',
                        context: { messageId },
                    }));
                }
                const text = String(newText ?? '');
                const msg = chat[id];
                msg.mes = text;
                if (Array.isArray(msg.swipes)) {
                    const swipeId = Number.isInteger(msg.swipe_id) ? msg.swipe_id : 0;
                    if (swipeId >= 0 && swipeId < msg.swipes.length) {
                        msg.swipes[swipeId] = text;
                    }
                }
                if (msg.extra && typeof msg.extra === 'object') {
                    delete msg.extra.display_text;
                }
                if (typeof ctx.updateMessageBlock === 'function') {
                    ctx.updateMessageBlock(id, msg, { rerenderMessage: true });
                }
                const updated = ctx.eventTypes?.MESSAGE_UPDATED;
                if (updated && typeof ctx.eventSource?.emit === 'function') {
                    await ctx.eventSource.emit(updated, id);
                }
                if (typeof ctx.saveChat === 'function') {
                    await ctx.saveChat();
                }
                return Ok(undefined);
            } catch (cause) {
                return Err(hostError({
                    code: 'MESSAGE_WRITE_FAILED',
                    message: '改写楼层正文失败',
                    cause,
                    context: { messageId },
                }));
            }
        },

        rerenderMessage(messageId) {
            try {
                const ctx = safeContext();
                const chat = getChatArray(ctx);
                const id = Number(messageId);
                if (!ctx || !Number.isInteger(id) || id < 0 || id >= chat.length) {
                    return;
                }
                if (typeof ctx.updateMessageBlock === 'function') {
                    ctx.updateMessageBlock(id, chat[id], { rerenderMessage: true });
                }
            } catch {
                // ignore
            }
        },

        ensureSlotRegexInstalled() {
            return regexInstaller.ensureInstalled();
        },

        onMessageDomReady(fn) {
            if (typeof fn !== 'function') {
                return () => {};
            }
            ensureLifecycleBound();
            domReadyListeners.add(fn);
            return () => {
                domReadyListeners.delete(fn);
            };
        },

        registerOutboundTransform(fn) {
            if (typeof fn !== 'function') {
                return () => {};
            }
            outboundTransforms.add(fn);
            return () => {
                outboundTransforms.delete(fn);
            };
        },

        async resolveWorldInfo(args) {
            try {
                const contextWindow = Array.isArray(args?.contextWindow) ? args.contextWindow : [];
                const includeNames = await readWorldInfoIncludeNames();
                const scanInput = buildWorldInfoScanInput(contextWindow, includeNames);
                const ctx = safeContext();
                const maxContext = worldInfoMaxContext(ctx);
                const globalScanData = buildGlobalScanData(ctx);
                return await worldInfoSource.resolve(scanInput, maxContext, globalScanData);
            } catch (cause) {
                return Err(hostError({
                    code: 'WORLDINFO_RESOLVE_FAILED',
                    message: '解析世界书失败',
                    hint: '将按空世界书继续',
                    cause,
                    context: { messageId: args?.messageId },
                }));
            }
        },

        onChatChanged(fn) {
            if (typeof fn !== 'function') {
                return () => {};
            }
            ensureLifecycleBound();
            chatChangedListeners.add(fn);
            return () => {
                chatChangedListeners.delete(fn);
            };
        },

        onChatDeleted(fn) {
            if (typeof fn !== 'function') {
                return () => {};
            }
            ensureLifecycleBound();
            chatDeletedListeners.add(fn);
            return () => {
                chatDeletedListeners.delete(fn);
            };
        },

        onGroupChatDeleted(fn) {
            if (typeof fn !== 'function') {
                return () => {};
            }
            ensureLifecycleBound();
            groupChatDeletedListeners.add(fn);
            return () => {
                groupChatDeletedListeners.delete(fn);
            };
        },

        onChatRenamed(fn) {
            if (typeof fn !== 'function') {
                return () => {};
            }
            ensureLifecycleBound();
            chatRenamedListeners.add(fn);
            return () => {
                chatRenamedListeners.delete(fn);
            };
        },

        async listAliveChats() {
            try {
                const ctx = safeContext();
                if (!ctx || typeof ctx.getRequestHeaders !== 'function') {
                    return Err(hostError({
                        code: 'HOST_CONTEXT_MISSING',
                        message: '无法列出聊天：宿主上下文不可用',
                    }));
                }
                const headers = ctx.getRequestHeaders();
                /** @type {Array<{ chatFileName: string, avatarUrl: string|null, groupId: string|null, integrity: string|null }>} */
                const out = [];

                const characters = Array.isArray(ctx.characters) ? ctx.characters : [];
                for (const character of characters) {
                    const avatarUrl = character?.avatar != null ? String(character.avatar) : null;
                    if (!avatarUrl) {
                        continue;
                    }
                    let res;
                    try {
                        res = await fetch('/api/characters/chats', {
                            method: 'POST',
                            headers,
                            body: JSON.stringify({ avatar_url: avatarUrl, metadata: true }),
                        });
                    } catch (cause) {
                        return Err(hostError({
                            code: 'LIST_CHATS_NETWORK',
                            message: '列出角色聊天失败（网络）',
                            cause,
                            retryable: true,
                        }));
                    }
                    if (!res.ok) {
                        return Err(hostError({
                            code: 'LIST_CHATS_HTTP',
                            message: `列出角色聊天失败（HTTP ${res.status}）`,
                            hint: '清理已中止：无法确认会话是否仍存在，请稍后重试',
                            retryable: res.status >= 500,
                            context: { avatarUrl, status: res.status },
                        }));
                    }
                    let data;
                    try {
                        data = await res.json();
                    } catch (cause) {
                        return Err(hostError({
                            code: 'LIST_CHATS_BODY',
                            message: '列出角色聊天返回无法解析',
                            hint: '清理已中止：无法确认会话是否仍存在，请稍后重试',
                            cause,
                            context: { avatarUrl },
                        }));
                    }
                    // 酒馆：无聊天目录时返回 { error: true }（非数组），视为该角色无聊天
                    if (data && typeof data === 'object' && !Array.isArray(data) && data.error === true) {
                        continue;
                    }
                    if (!Array.isArray(data)) {
                        return Err(hostError({
                            code: 'LIST_CHATS_SHAPE',
                            message: '列出角色聊天返回形状异常',
                            hint: '清理已中止：无法确认会话是否仍存在，请稍后重试',
                            context: { avatarUrl },
                        }));
                    }
                    for (const item of data) {
                        const fileName = String(item?.file_name ?? item?.file_id ?? '')
                            .replace(/\.jsonl$/i, '');
                        if (!fileName) {
                            continue;
                        }
                        const integrity = item?.chat_metadata?.integrity != null
                            ? String(item.chat_metadata.integrity)
                            : null;
                        out.push({
                            chatFileName: fileName,
                            avatarUrl,
                            groupId: null,
                            integrity,
                        });
                    }
                }

                const groups = Array.isArray(ctx.groups) ? ctx.groups : [];
                for (const group of groups) {
                    if (!group) {
                        continue;
                    }
                    const groupId = group.id != null ? String(group.id) : null;
                    const chatIds = Array.isArray(group.chats) && group.chats.length
                        ? group.chats.map(String)
                        : (group.chat_id != null ? [String(group.chat_id)] : []);
                    for (const chatId of chatIds) {
                        let integrity = null;
                        let infoRes;
                        try {
                            infoRes = await fetch('/api/chats/group/info', {
                                method: 'POST',
                                headers,
                                body: JSON.stringify({ id: chatId }),
                            });
                        } catch (cause) {
                            return Err(hostError({
                                code: 'LIST_GROUP_CHAT_NETWORK',
                                message: '读取群聊信息失败（网络）',
                                hint: '清理已中止：无法确认会话是否仍存在，请稍后重试',
                                cause,
                                retryable: true,
                                context: { chatId, groupId },
                            }));
                        }
                        if (!infoRes.ok) {
                            // 群组内存里仍有该 chatId → 视为存活；integrity 缺失时靠 location 匹配
                            if (infoRes.status !== 404) {
                                return Err(hostError({
                                    code: 'LIST_GROUP_CHAT_HTTP',
                                    message: `读取群聊信息失败（HTTP ${infoRes.status}）`,
                                    hint: '清理已中止：无法确认会话是否仍存在，请稍后重试',
                                    retryable: infoRes.status >= 500,
                                    context: { chatId, groupId, status: infoRes.status },
                                }));
                            }
                        } else {
                            try {
                                const info = await infoRes.json();
                                if (info?.chat_metadata?.integrity != null) {
                                    integrity = String(info.chat_metadata.integrity);
                                }
                            } catch (cause) {
                                return Err(hostError({
                                    code: 'LIST_GROUP_CHAT_BODY',
                                    message: '群聊信息返回无法解析',
                                    hint: '清理已中止：无法确认会话是否仍存在，请稍后重试',
                                    cause,
                                    context: { chatId, groupId },
                                }));
                            }
                        }
                        out.push({
                            chatFileName: chatId,
                            avatarUrl: null,
                            groupId,
                            integrity,
                        });
                    }
                }

                return Ok(out);
            } catch (cause) {
                return Err(hostError({
                    code: 'LIST_CHATS_FAILED',
                    message: '列出存活聊天失败',
                    cause,
                }));
            }
        },

        onAiMessageSettled(fn) {
            // 仅封装 CHARACTER_MESSAGE_RENDERED（流式/非流式 AI 楼落定）。
            // 不含 MESSAGE_SWIPED（裁决 D38）。回调签名仅 messageId；
            // 当前激活 swipe 的正文已由酒馆 sync 进 chat[messageId]，
            // 下游用 getMessage 读「当前展示的那一 swipe」。
            if (typeof fn !== 'function') {
                return () => {};
            }
            ensureLifecycleBound();
            aiSettledListeners.add(fn);
            return () => {
                aiSettledListeners.delete(fn);
            };
        },

        loadSettings() {
            try {
                const ctx = safeContext();
                const raw = ctx?.extensionSettings?.[PLUGIN_NS];
                if (!raw || typeof raw !== 'object') {
                    return defaultPluginSettings();
                }
                const validated = validatePluginSettings(raw);
                return validated.ok ? validated.value : defaultPluginSettings();
            } catch {
                return defaultPluginSettings();
            }
        },

        saveSettings(settings) {
            try {
                const ctx = safeContext();
                if (!ctx?.extensionSettings) {
                    return;
                }
                const validated = validatePluginSettings(settings);
                ctx.extensionSettings[PLUGIN_NS] = validated.ok
                    ? validated.value
                    : normalizePluginSettings(settings);
                if (typeof ctx.saveSettingsDebounced === 'function') {
                    ctx.saveSettingsDebounced();
                }
            } catch {
                // ignore
            }
        },

        mountSettingsPanel(element) {
            if (!element || typeof document === 'undefined') {
                return;
            }
            const hostEl = document.getElementById('extensions_settings2')
                || document.getElementById('extensions_settings');
            if (!hostEl) {
                return;
            }
            let drawer = hostEl.querySelector(`#${SETTINGS_DRAWER_ID}`);
            if (!drawer) {
                drawer = document.createElement('div');
                drawer.id = SETTINGS_DRAWER_ID;
                drawer.className = 'inline-drawer';
                hostEl.appendChild(drawer);
            }
            drawer.replaceChildren(element);
        },

        async openModal(opts) {
            const ctx = safeContext();
            const title = opts?.title ? String(opts.title) : '';
            const element = opts?.element;

            if (!ctx) {
                return;
            }

            /** @type {Element|string} */
            let content = element ?? '';
            if (element && title) {
                const wrap = document.createElement('div');
                wrap.classList.add(ND_ROOT_CLASS);
                const h = document.createElement('h3');
                h.textContent = title;
                wrap.appendChild(h);
                wrap.appendChild(element);
                content = wrap;
            } else if (element) {
                if (element instanceof Element) {
                    element.classList.add(ND_ROOT_CLASS);
                }
                content = element;
            }

            // 裁决 D20：透传调用方选项，不得写死 large/scrolling
            /** @type {Record<string, unknown>} */
            const popupOpts = {};
            if (opts && Object.prototype.hasOwnProperty.call(opts, 'wide')) {
                popupOpts.wide = opts.wide;
            }
            if (opts && Object.prototype.hasOwnProperty.call(opts, 'large')) {
                popupOpts.large = opts.large;
            }
            if (opts && Object.prototype.hasOwnProperty.call(opts, 'allowVerticalScrolling')) {
                popupOpts.allowVerticalScrolling = opts.allowVerticalScrolling;
            }

            try {
                if (typeof ctx.Popup === 'function' && ctx.POPUP_TYPE) {
                    const popup = new ctx.Popup(content, ctx.POPUP_TYPE.DISPLAY, '', popupOpts);
                    popup.dlg?.classList?.add(ND_ROOT_CLASS, 'nd-popup');
                    await popup.show();
                    return;
                }
                if (typeof ctx.callGenericPopup === 'function' && ctx.POPUP_TYPE) {
                    await ctx.callGenericPopup(content, ctx.POPUP_TYPE.DISPLAY, '', popupOpts);
                }
            } catch {
                // 弹窗能力缺失时静默降级
            }
        },

        registerSlashCommand(spec) {
            try {
                const ctx = safeContext();
                if (!ctx?.SlashCommandParser || !ctx?.SlashCommand) {
                    return;
                }
                if (!spec || typeof spec !== 'object' || typeof ctx.SlashCommand.fromProps !== 'function') {
                    return;
                }
                const name = typeof spec.name === 'string' ? spec.name : '';
                if (!name) {
                    return;
                }
                // 宿主无卸载 API（SlashCommandParser 仅有 addCommandObject，同名覆盖）。
                // 幂等：同名再注册走覆盖，不累积多份回调表项之外的副作用。
                const command = ctx.SlashCommand.fromProps(spec);
                ctx.SlashCommandParser.addCommandObject(command);
                registeredSlashNames.add(name);
                if (Array.isArray(spec.aliases)) {
                    for (const alias of spec.aliases) {
                        if (typeof alias === 'string' && alias) {
                            registeredSlashNames.add(alias);
                        }
                    }
                }
            } catch {
                // ignore
            }
        },

        toast(level, message) {
            const text = String(message ?? '');
            if (!text) {
                return;
            }
            try {
                const toastr = globalThis.toastr;
                if (!toastr) {
                    return;
                }
                switch (level) {
                    case 'success':
                        toastr.success(text);
                        break;
                    case 'warning':
                        toastr.warning(text);
                        break;
                    case 'error':
                        toastr.error(text);
                        break;
                    default:
                        toastr.info(text);
                        break;
                }
            } catch {
                // ignore
            }
        },

        /**
         * 干净卸载（裁决 D18 / D28）：事件、观察器、全局拦截器、设置抽屉 DOM。
         * 斜杠命令宿主无正式卸载 API，仅清本地登记；再 enable 时同名覆盖注册。
         * @returns {void}
         */
        dispose() {
            const ctx = safeContext();
            const es = ctx?.eventSource;
            if (es && typeof es.removeListener === 'function') {
                for (const { event, handler } of eventBindings) {
                    try {
                        es.removeListener(event, handler);
                    } catch {
                        // ignore
                    }
                }
            }
            eventBindings.length = 0;
            domReadyListeners.clear();
            chatChangedListeners.clear();
            chatDeletedListeners.clear();
            groupChatDeletedListeners.clear();
            chatRenamedListeners.clear();
            aiSettledListeners.clear();
            outboundTransforms.clear();
            registeredSlashNames.clear();
            if (domReadyDebounce != null) {
                clearTimeout(domReadyDebounce);
                domReadyDebounce = null;
            }
            if (domReadyObserver) {
                domReadyObserver.disconnect();
                domReadyObserver = null;
            }
            unregisterGenerateInterceptorGlobal();
            lifecycleBound = false;

            // 裁决 D28：移除设置抽屉，避免 disable/enable 残留重复 DOM
            try {
                if (typeof document !== 'undefined') {
                    const drawer = document.getElementById(SETTINGS_DRAWER_ID);
                    if (drawer && typeof drawer.remove === 'function') {
                        drawer.remove();
                    } else if (drawer?.parentNode) {
                        drawer.parentNode.removeChild(drawer);
                    }
                }
            } catch {
                // ignore
            }
        },
    };

    return host;
}
