/**
 * L2 适配器 · HostPort 的 SillyTavern 实现（版本敏感代码唯一容身处）。
 * 归属：W1-B 宿主代理实现。W0 仅冻结签名。
 */

import { Ok, Err } from '../../infra/result.js';
import { hostError } from '../../infra/errors.js';
import {
    defaultPluginSettings,
    migratePluginSettings,
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
        const mod = await import('/scripts/world-info.js');
        if (typeof mod.world_info_include_names === 'boolean') {
            return mod.world_info_include_names;
        }
    } catch {
        // Node / 无 ST 环境
    }
    return true;
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
                chat[id].mes = String(newText ?? '');
                if (typeof ctx.updateMessageBlock === 'function') {
                    ctx.updateMessageBlock(id, chat[id], { rerenderMessage: true });
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

        readMessageExtra(messageId) {
            const msg = host.getMessage(messageId);
            if (!msg) {
                return {};
            }
            const extra = msg.extra && typeof msg.extra === 'object' ? msg.extra : {};
            const ns = extra[PLUGIN_NS];
            return ns && typeof ns === 'object' ? { ...ns } : {};
        },

        async writeMessageExtra(messageId, patch) {
            try {
                const ctx = safeContext();
                const chat = getChatArray(ctx);
                const id = Number(messageId);
                if (!ctx || !Number.isInteger(id) || id < 0 || id >= chat.length) {
                    return Err(hostError({
                        code: 'MESSAGE_NOT_FOUND',
                        message: '找不到要写入 extra 的楼层',
                        context: { messageId },
                    }));
                }
                const message = chat[id];
                if (!message.extra || typeof message.extra !== 'object') {
                    message.extra = {};
                }
                const prev = message.extra[PLUGIN_NS] && typeof message.extra[PLUGIN_NS] === 'object'
                    ? message.extra[PLUGIN_NS]
                    : {};
                message.extra[PLUGIN_NS] = {
                    ...prev,
                    ...(patch && typeof patch === 'object' ? patch : {}),
                };
                if (typeof ctx.saveChat === 'function') {
                    await ctx.saveChat();
                }
                return Ok(undefined);
            } catch (cause) {
                return Err(hostError({
                    code: 'MESSAGE_EXTRA_WRITE_FAILED',
                    message: '写入 message.extra 失败',
                    cause,
                    context: { messageId },
                }));
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
                const maxContext = Number(ctx?.maxContext) || 0;
                const globalScanData = buildGlobalScanData(ctx);
                return await worldInfoSource.resolve(scanInput, maxContext, globalScanData);
            } catch (cause) {
                return Err(hostError({
                    code: 'WORLDINFO_RESOLVE_FAILED',
                    message: '解析世界书失败',
                    hint: '将以降级为空世界书块继续',
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

        onAiMessageSettled(fn) {
            // 仅封装 CHARACTER_MESSAGE_RENDERED（流式/非流式 AI 楼落定）。
            // 不含 MESSAGE_SWIPED（裁决 D38）。回调签名仅 messageId；
            // 当前激活 swipe 的正文/extra 已由酒馆 sync 进 chat[messageId]，
            // 下游用 getMessage / readMessageExtra 读「当前展示的那一 swipe」。
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
                const fromVersion = Number(raw.schemaVersion) || 1;
                if (fromVersion !== 1) {
                    const migrated = migratePluginSettings(raw, fromVersion);
                    if (migrated.ok) {
                        return migrated.value;
                    }
                }
                const validated = validatePluginSettings(raw);
                return validated.ok ? validated.value : normalizePluginSettings(raw);
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
                if (typeof ctx.callGenericPopup === 'function' && ctx.POPUP_TYPE) {
                    await ctx.callGenericPopup(
                        content,
                        ctx.POPUP_TYPE.DISPLAY,
                        '',
                        popupOpts,
                    );
                    return;
                }
                if (ctx.Popup && ctx.POPUP_TYPE) {
                    const popup = new ctx.Popup(content, ctx.POPUP_TYPE.DISPLAY, '', popupOpts);
                    await popup.show();
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
