/**
 * 预览沙箱 · 假 HostPort（满足 assertHostPort 全部必需方法）。
 */

import { Ok, Err } from '../src/infra/result.js';
import { assertHostPort } from '../src/ports/host.port.js';
import { hostError } from '../src/infra/errors.js';
import { slotWidgetReplaceTemplate } from '../src/domain/slot/slot-token.js';
import {
    FIXTURE_CHAT_ID,
    fixtureMessages,
    fixtureSettings,
    fixtureWorldInfo,
} from './fixtures.js';

const PLUGIN_NS = 'nai-dbgen';

/**
 * @param {string} text
 * @returns {string}
 */
export function renderMessageHtml(text) {
    const src = String(text ?? '');
    const template = slotWidgetReplaceTemplate();
    return src
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(
            /&lt;IMG&gt;\s*(\d+)\s*&lt;\/IMG&gt;/gi,
            (_m, id) => template.replace(/\$1/g, String(id)),
        )
        .replace(/\n/g, '<br>');
}

/**
 * 注意：聊天正文渲染需要把 slot 骨架写进 DOM。
 * 宿主正则路径会用 replaceString；沙箱直接用 createElement 重建，
 * 仅在「楼层正文容器」上用 text→节点转换，避免对插件控件用 innerHTML。
 * @param {HTMLElement} container
 * @param {string} text
 */
export function paintMessageBody(container, text) {
    container.replaceChildren();
    const html = renderMessageHtml(text);
    // 沙箱外壳：楼层是假宿主 DOM，用 Range 解析一次；slot 控件挂载后不再碰。
    // Node 冒烟（tests/ui/fake-dom）可能没有 createRange —— 退化为纯文本，仍可测用例层。
    if (typeof document !== 'undefined' && typeof document.createRange === 'function') {
        const range = document.createRange();
        range.selectNodeContents(container);
        const frag = range.createContextualFragment(html);
        container.appendChild(frag);
        return;
    }
    const pre = document.createElement('div');
    pre.textContent = String(text ?? '');
    container.appendChild(pre);
}

/**
 * @param {object} [opts]
 * @returns {import('../src/ports/host.port.js').HostPort & object}
 */
export function createFakeHost(opts = {}) {
    /** @type {Map<number, import('../src/ports/host.port.js').HostMessage>} */
    const byId = new Map();
    for (const m of (opts.messages ?? fixtureMessages())) {
        byId.set(m.messageId, {
            ...m,
            extra: m.extra && typeof m.extra === 'object'
                ? structuredClone(m.extra)
                : {},
        });
    }

    /** @type {import('../src/domain/model/plugin-settings.js').PluginSettings} */
    let settings = opts.settings ?? fixtureSettings();
    let chatId = opts.chatId ?? FIXTURE_CHAT_ID;
    let sessionId = opts.sessionId ?? 'sess-preview-1';
    let worldInfoText = opts.worldInfoText ?? fixtureWorldInfo();
    let worldInfoFail = opts.worldInfoFail === true;
    /** @type {Array<{ chatFileName: string, avatarUrl: string|null, groupId: string|null, integrity: string|null }>} */
    let extraAliveChats = Array.isArray(opts.extraAliveChats) ? [...opts.extraAliveChats] : [];

    /** @type {Set<(el: Element, id: number) => void>} */
    const domReadyListeners = new Set();
    /** @type {Set<(chatId: string|null) => void>} */
    const chatChangedListeners = new Set();
    /** @type {Set<(messageId: number) => void>} */
    const aiSettledListeners = new Set();
    /** @type {Array<(mes: string, meta: object) => string>} */
    const outboundTransforms = [];
    /** @type {object[]} */
    const slashCommands = [];
    /** @type {Array<{ level: string, message: string, at: number }>} */
    const toasts = [];

    /** @type {HTMLElement|null} */
    let settingsMount = null;
    /** @type {HTMLElement|null} */
    let toastMount = null;
    /** @type {HTMLElement|null} */
    let toastLiveMount = null;
    /** @type {HTMLElement|null} */
    let chatRoot = null;

    /** 浮动 toast 自动消失（ms） */
    const TOAST_LIVE_MS = 4200;

    /**
     * @param {number} messageId
     */
    function syncMessageDom(messageId) {
        if (!chatRoot) {
            return;
        }
        const msg = byId.get(messageId);
        const mesEl = chatRoot.querySelector(`.mes[mesid="${messageId}"]`);
        if (!msg || !mesEl) {
            return;
        }
        const body = mesEl.querySelector('.mes_text');
        if (body instanceof HTMLElement) {
            paintMessageBody(body, msg.text);
        }
        for (const fn of domReadyListeners) {
            try {
                fn(mesEl, messageId);
            } catch {
                // ignore
            }
        }
    }

    /**
     * @returns {void}
     */
    function rebuildChatDom() {
        if (!chatRoot) {
            return;
        }
        chatRoot.replaceChildren();
        const ordered = [...byId.values()].sort((a, b) => a.messageId - b.messageId);
        for (const msg of ordered) {
            const mes = document.createElement('div');
            mes.className = `mes ${msg.isUser ? 'user_mes' : 'bot_mes'}`;
            mes.setAttribute('mesid', String(msg.messageId));

            const avatar = document.createElement('div');
            avatar.className = 'mes_avatar';
            avatar.setAttribute('aria-hidden', 'true');
            const label = String(msg.name || '?').trim();
            avatar.textContent = label ? label.slice(0, 1).toUpperCase() : '?';

            const block = document.createElement('div');
            block.className = 'mes_block';

            const name = document.createElement('div');
            name.className = 'mes_name';
            name.textContent = msg.name;

            const body = document.createElement('div');
            body.className = 'mes_text';
            paintMessageBody(body, msg.text);

            const buttons = document.createElement('div');
            buttons.className = 'extraMesButtons';

            block.append(name, body, buttons);
            mes.append(avatar, block);
            chatRoot.appendChild(mes);
        }
        for (const msg of ordered) {
            const mesEl = chatRoot.querySelector(`.mes[mesid="${msg.messageId}"]`);
            if (!mesEl) {
                continue;
            }
            for (const fn of domReadyListeners) {
                try {
                    fn(mesEl, msg.messageId);
                } catch {
                    // ignore
                }
            }
        }
    }

    /**
     * @param {'info'|'success'|'warning'|'error'} level
     * @param {string} message
     */
    function pushToast(level, message) {
        const text = String(message ?? '');
        const lvl = String(level || 'info');
        toasts.push({ level: lvl, message: text, at: Date.now() });

        // 调试抽屉内的历史记录
        if (toastMount) {
            const hist = document.createElement('div');
            hist.className = `pv-toast pv-toast--${lvl}`;
            hist.textContent = text;
            toastMount.prepend(hist);
            while (toastMount.childElementCount > 24) {
                toastMount.lastElementChild?.remove();
            }
        }

        // 右上角浮动 toast，几秒后消失（仿酒馆）
        if (!toastLiveMount) {
            toastLiveMount = document.getElementById('pv-toast-live');
        }
        if (!(toastLiveMount instanceof HTMLElement)) {
            return;
        }
        const live = document.createElement('div');
        live.className = `pv-toast pv-toast--${lvl}`;
        live.textContent = text;
        toastLiveMount.prepend(live);
        while (toastLiveMount.childElementCount > 5) {
            toastLiveMount.lastElementChild?.remove();
        }
        window.setTimeout(() => {
            if (!live.isConnected) {
                return;
            }
            live.classList.add('is-leaving');
            window.setTimeout(() => {
                live.remove();
            }, 300);
        }, TOAST_LIVE_MS);
    }

    const host = {
        /** 沙箱控制面 */
        _ctrl: {
            setChatRoot(el) {
                chatRoot = el instanceof HTMLElement ? el : null;
                rebuildChatDom();
            },
            setSettingsMount(el) {
                settingsMount = el instanceof HTMLElement ? el : null;
            },
            setToastMount(el) {
                toastMount = el instanceof HTMLElement ? el : null;
            },
            setToastLiveMount(el) {
                toastLiveMount = el instanceof HTMLElement ? el : null;
            },
            setWorldInfoFail(on) {
                worldInfoFail = !!on;
            },
            setWorldInfoText(text) {
                worldInfoText = String(text ?? '');
            },
            getSettings() {
                return settings;
            },
            setSettings(next) {
                settings = next && typeof next === 'object'
                    ? /** @type {any} */ (next)
                    : fixtureSettings();
            },
            getToasts() {
                return [...toasts];
            },
            clearToasts() {
                toasts.length = 0;
                toastMount?.replaceChildren();
                toastLiveMount?.replaceChildren();
            },
            rebuildChatDom,
            syncMessageDom,
            getSlashCommands() {
                return [...slashCommands];
            },
            emitAiSettled(messageId) {
                for (const fn of aiSettledListeners) {
                    try {
                        fn(messageId);
                    } catch {
                        // ignore
                    }
                }
            },
            setChatId(next) {
                chatId = next;
                for (const fn of chatChangedListeners) {
                    try {
                        fn(chatId);
                    } catch {
                        // ignore
                    }
                }
            },
            setSessionId(next) {
                sessionId = next == null || next === '' ? null : String(next);
            },
            /**
             * 额外「存活」会话（用于演示清理：登记孤儿后不放进这里即可被清掉）。
             * @param {Array<{ chatFileName: string, avatarUrl: string|null, groupId: string|null, integrity: string|null }>} rows
             */
            setExtraAliveChats(rows) {
                extraAliveChats = Array.isArray(rows) ? [...rows] : [];
            },
        },

        getCurrentChatId() {
            return chatId;
        },

        getSessionId() {
            return sessionId;
        },

        getChatLocation() {
            return {
                chatFileName: chatId,
                avatarUrl: null,
                groupId: null,
            };
        },

        getMessages() {
            return [...byId.values()]
                .sort((a, b) => a.messageId - b.messageId)
                .map((m) => ({ ...m }));
        },

        getRecentAiMessages(n) {
            const count = Number(n);
            const ai = [...byId.values()]
                .filter((m) => !m.isUser && !m.isSystem)
                .sort((a, b) => b.messageId - a.messageId);
            return ai.slice(0, Number.isFinite(count) ? count : 5).map((m) => ({ ...m }));
        },

        getMessage(messageId) {
            const m = byId.get(Number(messageId));
            return m ? { ...m, extra: m.extra ? structuredClone(m.extra) : {} } : null;
        },

        getMessageSwipeTexts(messageId) {
            const m = byId.get(Number(messageId));
            if (!m) {
                return [];
            }
            if (Array.isArray(m.swipes) && m.swipes.length > 0) {
                return m.swipes.map((s) => String(s ?? ''));
            }
            return [String(m.text ?? '')];
        },

        async replaceMessageText(messageId, newText) {
            const id = Number(messageId);
            const m = byId.get(id);
            if (!m) {
                return Err(hostError({
                    code: 'MESSAGE_NOT_FOUND',
                    message: '找不到要改正文的楼层',
                    hint: '请确认当前聊天仍打开',
                    context: { messageId: id },
                }));
            }
            byId.set(id, { ...m, text: String(newText ?? '') });
            return Ok(undefined);
        },

        rerenderMessage(messageId) {
            syncMessageDom(Number(messageId));
        },

        async ensureSlotRegexInstalled() {
            return Ok(undefined);
        },

        onMessageDomReady(fn) {
            if (typeof fn !== 'function') {
                return () => {};
            }
            domReadyListeners.add(fn);
            return () => {
                domReadyListeners.delete(fn);
            };
        },

        registerOutboundTransform(fn) {
            if (typeof fn !== 'function') {
                return () => {};
            }
            outboundTransforms.push(fn);
            return () => {
                const i = outboundTransforms.indexOf(fn);
                if (i >= 0) {
                    outboundTransforms.splice(i, 1);
                }
            };
        },

        async resolveWorldInfo({ contextWindow, messageId }) {
            if (worldInfoFail) {
                return Err(hostError({
                    code: 'WORLDINFO_UNAVAILABLE',
                    message: '世界书取不到',
                    hint: '沙箱已注入失败；链路应降级为空世界书块',
                    context: {
                        messageId,
                        windowSize: Array.isArray(contextWindow) ? contextWindow.length : 0,
                    },
                }));
            }
            return Ok(worldInfoText);
        },

        onChatChanged(fn) {
            if (typeof fn !== 'function') {
                return () => {};
            }
            chatChangedListeners.add(fn);
            return () => {
                chatChangedListeners.delete(fn);
            };
        },

        onChatDeleted() {
            return () => {};
        },

        onGroupChatDeleted() {
            return () => {};
        },

        onChatRenamed() {
            return () => {};
        },

        async listAliveChats() {
            // 演示会话视为存活；integrity = sessionId，location 与 getChatLocation 一致
            return Ok([{
                chatFileName: chatId,
                avatarUrl: null,
                groupId: null,
                integrity: sessionId,
            }, ...extraAliveChats]);
        },

        onAiMessageSettled(fn) {
            if (typeof fn !== 'function') {
                return () => {};
            }
            aiSettledListeners.add(fn);
            return () => {
                aiSettledListeners.delete(fn);
            };
        },

        loadSettings() {
            return structuredClone(settings);
        },

        saveSettings(next) {
            if (next && typeof next === 'object') {
                settings = /** @type {any} */ (structuredClone(next));
            }
        },

        mountSettingsPanel(element) {
            if (!(element instanceof Element)) {
                return;
            }
            if (!settingsMount) {
                settingsMount = document.getElementById('pv-settings-mount');
            }
            if (settingsMount) {
                settingsMount.replaceChildren(element);
            } else {
                document.body.appendChild(element);
            }
        },

        /**
         * 模拟酒馆 Popup DOM（对齐 ref/SillyTavern popup_template + popup.css），
         * 便于演示页复现「宿主外层 + 插件内层」叠层问题；modal.js 再套 nd-popup 皮。
         * @param {{ title?: string, element?: Element, wide?: boolean, large?: boolean, allowVerticalScrolling?: boolean }} opts
         */
        async openModal(opts) {
            const title = opts?.title ? String(opts.title) : '';
            const element = opts?.element;
            const dlg = document.createElement('dialog');
            dlg.className = 'popup';
            if (opts?.wide) dlg.classList.add('wide_dialogue_popup');
            if (opts?.large) dlg.classList.add('large_dialogue_popup');
            if (opts?.allowVerticalScrolling) dlg.classList.add('vertical_scrolling_dialogue_popup');

            const body = document.createElement('div');
            body.className = 'popup-body';
            const content = document.createElement('div');
            content.className = 'popup-content';
            const controls = document.createElement('div');
            controls.className = 'popup-controls';
            body.append(content, controls);

            const stClose = document.createElement('div');
            stClose.className = 'popup-button-close';
            stClose.title = 'Close popup';
            stClose.textContent = '×';

            /** @type {Element|string} */
            let payload = element ?? '';
            if (element instanceof Element && title) {
                const wrap = document.createElement('div');
                wrap.className = 'nd-root';
                const h = document.createElement('h3');
                h.className = 'nd-modal-title';
                h.textContent = title;
                wrap.append(h, element);
                payload = wrap;
            } else if (element instanceof Element) {
                element.classList.add('nd-root');
                payload = element;
            }
            if (payload instanceof Element) {
                content.appendChild(payload);
            }

            dlg.append(body, stClose);
            document.body.appendChild(dlg);

            let settled = false;
            /** @type {() => void} */
            let settle = () => {};
            const closed = new Promise((resolve) => {
                settle = () => {
                    if (settled) return;
                    settled = true;
                    resolve(undefined);
                };
            });

            const finish = () => {
                if (typeof dlg.close === 'function') dlg.close();
                dlg.remove();
                settle();
            };
            stClose.addEventListener('click', finish);
            dlg.addEventListener('cancel', (ev) => {
                ev.preventDefault();
                finish();
            });
            dlg.addEventListener('close', settle);

            if (typeof dlg.showModal === 'function') {
                dlg.showModal();
            } else {
                dlg.setAttribute('open', '');
            }

            await closed;
        },

        registerSlashCommand(spec) {
            if (!spec || typeof spec !== 'object') {
                return;
            }
            const name = String(spec.name ?? '');
            const idx = slashCommands.findIndex((c) => c.name === name);
            if (idx >= 0) {
                slashCommands[idx] = spec;
            } else {
                slashCommands.push(spec);
            }
        },

        toast(level, message) {
            pushToast(level, message);
        },

        dispose() {
            domReadyListeners.clear();
            chatChangedListeners.clear();
            aiSettledListeners.clear();
            outboundTransforms.length = 0;
        },
    };

    const check = assertHostPort(host);
    if (!check.ok) {
        throw new Error(`createFakeHost: ${check.error?.message} (${(check.error?.context?.missing || []).join(',')})`);
    }

    return host;
}
