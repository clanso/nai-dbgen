/**
 * L0 装配 · activate / dispose（manifest hooks）。
 * 归属：W3-J 装配代理实现。
 *
 * activate：装配 → 装正则 → 挂抽屉 → 挂 slot 观察器 → 自动触发 → 对外入口 → 斜杠（最后，D56）
 * dispose：全部倒序拆干净（D28）。中途失败须回收已建资源，不抛到宿主。
 *
 * D56：斜杠回调不闭包死容器，一律读 runtime.container；未加载时提示「未成功加载」。
 * D54：楼层写 slot 按钮跟 generateSlots.isWriting 禁用。
 * D58：toast 拼上 AppError.hint。
 */

import { newId } from '../infra/id.js';
import { nowIso } from '../infra/clock.js';
import { createContainer } from './container.js';
import { probeCapabilities, capabilityWarningMessages } from './capabilities.js';
import { APP_EVENTS } from '../application/_helpers.js';
import { createSlotMountObserver } from '../adapters/host/slot-mount.observer.js';
import { GENERATE_INTERCEPTOR_GLOBAL_NAME } from '../adapters/host/generate-interceptor.js';
import { mountDrawer } from '../ui/drawer/drawer.js';
import { openPanelShell } from '../ui/panels/shell.js';
import { mountWorkbench } from '../ui/workbench/workbench.js';
import { mountSlotWidget } from '../ui/slot-widget/slot-widget.js';
import { openModal } from '../ui/common/modal.js';
import { createButton } from '../ui/common/controls.js';

/** @type {string} */
export const PLUGIN_VERSION = '0.1.0';

/** @type {string} */
export const PUBLIC_API_NAME = 'NaiDbGen';

/** 楼层「写 slot」按钮标记 */
const FLOOR_BTN_ATTR = 'data-nai-dbgen-floor-btn';

/** 楼层按钮 busy 轮询间隔（跟 isWriting，含自动写） */
const FLOOR_BUSY_POLL_MS = 200;

/**
 * @typedef {object} RuntimeState
 * @property {Awaited<ReturnType<typeof createContainer>>|null} container
 * @property {{ destroy: () => void }|null} drawerHandle
 * @property {{ start: () => void, stop: () => void, reconcile: () => void }|null} slotObserver
 * @property {Map<string, { destroy: () => void }>} slotWidgets
 * @property {(() => void)|null} unsubUnmatched
 * @property {(() => void)|null} unsubDomReady
 * @property {(() => void)|null} unsubChatChanged
 * @property {(() => void)|null} unsubSlotRenderedCache
 * @property {(() => void)|null} unsubSlotsWrittenCache
 * @property {{ destroy: () => void }|null} panelShell
 * @property {{ destroy: () => void }|null} workbenchModal
 * @property {ReturnType<typeof setInterval>|null} floorBusyTimer
 * @property {boolean} activating
 * @property {boolean} slashRegistered
 */

/** @type {RuntimeState} */
const runtime = {
    container: null,
    drawerHandle: null,
    slotObserver: null,
    slotWidgets: new Map(),
    unsubUnmatched: null,
    unsubDomReady: null,
    unsubChatChanged: null,
    unsubSlotRenderedCache: null,
    unsubSlotsWrittenCache: null,
    panelShell: null,
    workbenchModal: null,
    floorBusyTimer: null,
    activating: false,
    slashRegistered: false,
};

/** messageId::slotId → SlotRecord 同步缓存（控件 getRecord 是同步的） */
const recordCache = new Map();

/**
 * 面向用户的错误文案：message + hint（D58）。
 * @param {unknown} err
 * @returns {string}
 */
export function formatUserMessage(err) {
    if (err == null) {
        return '操作失败';
    }
    if (typeof err === 'string') {
        return err;
    }
    if (typeof err !== 'object') {
        return String(err);
    }
    const rec = /** @type {{ message?: unknown, hint?: unknown, traceId?: unknown, error?: unknown }} */ (err);
    // Result 形状：{ ok:false, error }
    if (rec.error && typeof rec.error === 'object') {
        return formatUserMessage(rec.error);
    }
    const message = typeof rec.message === 'string' && rec.message
        ? rec.message
        : '操作失败';
    const hint = typeof rec.hint === 'string' && rec.hint.trim()
        ? rec.hint.trim()
        : '';
    const tid = typeof rec.traceId === 'string' && rec.traceId
        ? `（${rec.traceId}）`
        : '';
    if (hint) {
        return `${message}。${hint}${tid}`;
    }
    return `${message}${tid}`;
}

/**
 * @returns {() => any}
 */
function resolveGetContext() {
    return () => {
        const st = globalThis.SillyTavern;
        if (!st || typeof st.getContext !== 'function') {
            throw new Error('找不到 SillyTavern.getContext');
        }
        return st.getContext();
    };
}

/**
 * @param {import('../ports/host.port.js').HostPort|null|undefined} host
 * @param {'info'|'success'|'warning'|'error'} level
 * @param {string} message
 */
function safeToast(host, level, message) {
    const text = String(message ?? '');
    if (!text) {
        return;
    }
    try {
        if (host && typeof host.toast === 'function') {
            host.toast(level, text);
            return;
        }
    } catch {
        // fall through
    }
    try {
        const toastr = globalThis.toastr;
        if (!toastr) {
            return;
        }
        if (level === 'error') toastr.error(text);
        else if (level === 'warning') toastr.warning(text);
        else if (level === 'success') toastr.success(text);
        else toastr.info(text);
    } catch {
        // ignore
    }
}

/**
 * @param {number} messageId
 * @param {number} slotId
 * @returns {string}
 */
function recordKey(messageId, slotId) {
    return `${messageId}::${slotId}`;
}

/**
 * @returns {Awaited<ReturnType<typeof createContainer>>|null}
 */
function liveContainer() {
    return runtime.container;
}

/**
 * @param {Awaited<ReturnType<typeof createContainer>>} container
 * @returns {void}
 */
function exposePublicApi(container) {
    const api = {
        version: PLUGIN_VERSION,
        getVersion() {
            return PLUGIN_VERSION;
        },
        /**
         * 4.14 对外生图。replaceCharacterKeywords 必填，绝不推断（验收 #13/#14）。
         * @param {import('../application/image-gen.service.js').ImageGenRequest} req
         */
        async generate(req) {
            const c = liveContainer();
            if (!c) {
                throw new Error('数据库生图插件未成功加载');
            }
            if (!req || typeof req !== 'object') {
                throw new Error('invalid argument: req');
            }
            if (typeof req.replaceCharacterKeywords !== 'boolean') {
                throw new Error('invalid argument: replaceCharacterKeywords');
            }
            return c.services.imageGen.generate(req);
        },
        async getActiveArtist() {
            const c = liveContainer();
            if (!c) {
                throw new Error('数据库生图插件未成功加载');
            }
            return c.services.imageGen.getActiveArtist();
        },
        async listNaiConfigs() {
            const c = liveContainer();
            if (!c) {
                return [];
            }
            const r = await c.repos.naiConfig.list();
            return r?.ok ? r.value : [];
        },
        openWorkbench() {
            const c = liveContainer();
            if (!c) {
                safeToast(null, 'warning', '数据库生图插件未成功加载');
                return Promise.resolve();
            }
            return openWorkbenchUi(c);
        },
        openManagement() {
            const c = liveContainer();
            if (!c) {
                safeToast(null, 'warning', '数据库生图插件未成功加载');
                return Promise.resolve();
            }
            return openManagementUi(c);
        },
    };
    globalThis[PUBLIC_API_NAME] = api;
    try {
        if (typeof window !== 'undefined') {
            window[PUBLIC_API_NAME] = api;
        }
    } catch {
        // Node / 无 window
    }
}

/**
 * @returns {void}
 */
function clearPublicApi() {
    try {
        if (globalThis[PUBLIC_API_NAME]) {
            delete globalThis[PUBLIC_API_NAME];
        }
    } catch {
        // ignore
    }
    try {
        if (typeof window !== 'undefined' && window[PUBLIC_API_NAME]) {
            delete window[PUBLIC_API_NAME];
        }
    } catch {
        // ignore
    }
}

/**
 * @param {Awaited<ReturnType<typeof createContainer>>} container
 * @returns {object}
 */
function panelDeps(container) {
    return {
        host: container.host,
        repos: container.repos,
        services: container.services,
        bus: container.bus,
        loadSettings: container.loadSettings,
        saveSettings: (s) => container.settingsStore.save(s),
        newId,
        nowIso,
    };
}

/**
 * @param {Awaited<ReturnType<typeof createContainer>>} container
 * @returns {Promise<void>}
 */
async function openManagementUi(container) {
    try {
        runtime.panelShell?.destroy();
    } catch {
        // ignore
    }
    runtime.panelShell = await openPanelShell(panelDeps(container));
}

/**
 * @param {Awaited<ReturnType<typeof createContainer>>} container
 * @returns {Promise<void>}
 */
async function openWorkbenchUi(container) {
    try {
        runtime.workbenchModal?.destroy();
    } catch {
        // ignore
    }
    if (typeof document === 'undefined') {
        return;
    }
    const root = document.createElement('div');
    root.className = 'nd-root';
    const handle = mountWorkbench(root, {
        host: container.host,
        workbenchService: container.services.workbench,
        tagRepo: container.repos.tag,
        loadSettings: container.loadSettings,
        imageRepo: container.repos.image,
    });
    const modal = await openModal(
        { host: container.host },
        {
            title: '生成工作台',
            element: root,
            wide: true,
            large: true,
            allowVerticalScrolling: true,
        },
    );
    runtime.workbenchModal = {
        destroy() {
            try {
                handle.destroy();
            } catch {
                // ignore
            }
            try {
                modal.destroy();
            } catch {
                // ignore
            }
        },
    };
}

/**
 * D56：回调活查 runtime.container，绝不闭包已 dispose 的容器。
 * @param {import('../ports/host.port.js').HostPort} host
 * @returns {void}
 */
function registerSlashCommands(host) {
    host.registerSlashCommand({
        name: 'naigen',
        aliases: ['nai-dbgen'],
        helpString: '对指定楼（或最近一条 AI 楼）执行数据库生图写 slot。用法：/naigen [messageId]',
        callback: async (_args, value) => {
            const container = liveContainer();
            if (!container) {
                safeToast(null, 'warning', '数据库生图插件未成功加载');
                return '';
            }
            const h = container.host;
            const raw = typeof value === 'string' ? value.trim() : '';
            let messageId = Number(raw);
            if (!Number.isInteger(messageId) || messageId < 0) {
                const recent = h.getRecentAiMessages(1);
                if (!recent?.length) {
                    safeToast(h, 'warning', '没有可用的 AI 楼');
                    return '';
                }
                messageId = recent[0].messageId;
            }
            if (container.useCases.generateSlots.isWriting(messageId)) {
                safeToast(h, 'info', `第 ${messageId} 楼正在写 slot，请稍候…`);
            } else {
                safeToast(h, 'info', `正在为第 ${messageId} 楼写 slot…`);
            }
            const result = await container.useCases.generateSlots.execute(messageId);
            if (!result.ok) {
                safeToast(h, 'error', formatUserMessage(result));
                return '';
            }
            const unmatched = Array.isArray(result.value.unmatchedKeys)
                ? result.value.unmatchedKeys
                : [];
            if (unmatched.length) {
                safeToast(h, 'warning', `召回未命中：${unmatched.join(', ')}`);
            }
            safeToast(h, 'success', `已写入 ${result.value.records.length} 个 slot`);
            return '';
        },
    });

    host.registerSlashCommand({
        name: 'naiwb',
        aliases: ['nai-workbench'],
        helpString: '打开数据库生图 · 生成工作台',
        callback: async () => {
            const container = liveContainer();
            if (!container) {
                safeToast(null, 'warning', '数据库生图插件未成功加载');
                return '';
            }
            await openWorkbenchUi(container);
            return '';
        },
    });

    runtime.slashRegistered = true;
}

/**
 * D54：楼层按钮进行中视觉 + 禁用。
 * @param {Element} btn
 * @param {boolean} busy
 */
function setFloorBtnBusy(btn, busy) {
    if (!btn) {
        return;
    }
    try {
        btn.setAttribute('aria-busy', busy ? 'true' : 'false');
        btn.setAttribute('aria-disabled', busy ? 'true' : 'false');
        if (btn.classList) {
            if (busy) btn.classList.add('is-busy');
            else btn.classList.remove('is-busy');
        }
        btn.title = busy ? '正在写 slot…' : '数据库生图（写 slot）';
        if (btn.style) {
            btn.style.opacity = busy ? '0.45' : '';
            btn.style.pointerEvents = busy ? 'none' : '';
            btn.style.cursor = busy ? 'wait' : '';
        }
    } catch {
        // ignore
    }
}

/**
 * @param {Element} btn
 * @param {number} messageId
 * @param {Awaited<ReturnType<typeof createContainer>>} container
 */
function syncFloorBtnBusy(btn, messageId, container) {
    const writing = typeof container.useCases.generateSlots.isWriting === 'function'
        && container.useCases.generateSlots.isWriting(messageId);
    setFloorBtnBusy(btn, writing);
}

/**
 * 轮询可见楼层按钮的 isWriting（覆盖自动写路径）。
 * @param {Awaited<ReturnType<typeof createContainer>>} container
 */
function startFloorBusyWatch(container) {
    stopFloorBusyWatch();
    runtime.floorBusyTimer = setInterval(() => {
        const c = liveContainer();
        if (!c || c !== container) {
            stopFloorBusyWatch();
            return;
        }
        if (typeof document === 'undefined') {
            return;
        }
        try {
            document.querySelectorAll(`[${FLOOR_BTN_ATTR}]`).forEach((btn) => {
                const mes = typeof btn.closest === 'function'
                    ? btn.closest('.mes[mesid]')
                    : null;
                if (!mes) {
                    return;
                }
                const mid = Number(mes.getAttribute('mesid'));
                if (Number.isInteger(mid)) {
                    syncFloorBtnBusy(btn, mid, c);
                }
            });
        } catch {
            // ignore
        }
    }, FLOOR_BUSY_POLL_MS);
}

function stopFloorBusyWatch() {
    if (runtime.floorBusyTimer != null) {
        clearInterval(runtime.floorBusyTimer);
        runtime.floorBusyTimer = null;
    }
}

/**
 * @param {Element} messageEl
 * @param {number} messageId
 * @param {Awaited<ReturnType<typeof createContainer>>} container
 */
export function ensureFloorGenerateButton(messageEl, messageId, container) {
    if (!messageEl || typeof messageEl.querySelector !== 'function') {
        return;
    }
    if (messageEl.querySelector(`[${FLOOR_BTN_ATTR}]`)) {
        const existing = messageEl.querySelector(`[${FLOOR_BTN_ATTR}]`);
        if (existing) {
            syncFloorBtnBusy(existing, messageId, container);
        }
        return;
    }
    const msg = container.host.getMessage(messageId);
    if (!msg || msg.isUser || msg.isSystem) {
        return;
    }

    const hostEl = messageEl.querySelector('.extraMesButtons')
        || messageEl.querySelector('.mes_buttons')
        || messageEl;

    const btn = document.createElement('div');
    btn.setAttribute(FLOOR_BTN_ATTR, '1');
    btn.className = 'mes_button fa-solid fa-palette';
    btn.title = '数据库生图（写 slot）';
    btn.setAttribute('role', 'button');
    btn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const c = liveContainer();
        if (!c) {
            safeToast(null, 'warning', '数据库生图插件未成功加载');
            return;
        }
        const host = c.host;
        // D54：进行中再点不发起第二次（execute 会共享 Promise；UI 也拒）
        if (c.useCases.generateSlots.isWriting(messageId)) {
            setFloorBtnBusy(btn, true);
            // 仍 await 同一 Promise，避免用户以为没点上
            const result = await c.useCases.generateSlots.execute(messageId);
            syncFloorBtnBusy(btn, messageId, c);
            if (!result.ok) {
                safeToast(host, 'error', formatUserMessage(result));
            }
            return;
        }
        setFloorBtnBusy(btn, true);
        safeToast(host, 'info', `正在为第 ${messageId} 楼写 slot…`);
        try {
            const result = await c.useCases.generateSlots.execute(messageId);
            if (!result.ok) {
                safeToast(host, 'error', formatUserMessage(result));
                return;
            }
            const unmatched = Array.isArray(result.value.unmatchedKeys)
                ? result.value.unmatchedKeys
                : [];
            if (unmatched.length) {
                safeToast(host, 'warning', `召回未命中：${unmatched.join(', ')}`);
            }
            safeToast(host, 'success', `已写入 ${result.value.records.length} 个 slot`);
        } finally {
            syncFloorBtnBusy(btn, messageId, c);
        }
    });
    hostEl.appendChild(btn);
    syncFloorBtnBusy(btn, messageId, container);
}

/**
 * 预热 recordCache 后再挂控件，避免 remount 闪「未生图」。
 * @param {Awaited<ReturnType<typeof createContainer>>} container
 * @param {Element} messageEl
 * @param {number} messageId
 * @param {number} slotId
 */
async function mountOneSlot(container, messageEl, messageId, slotId) {
    const slotRoot = (typeof messageEl.querySelector === 'function'
        ? messageEl.querySelector(`[data-slot="${slotId}"]`)
        : null) || messageEl;

    const key = `${container.host.getCurrentChatId() ?? ''}::${messageId}::${slotId}`;
    const prev = runtime.slotWidgets.get(key);
    if (prev) {
        try {
            prev.destroy();
        } catch {
            // ignore
        }
        runtime.slotWidgets.delete(key);
    }

    // 预热：先读权威记录再挂载（终审：cache 空时短暂像未生图）
    try {
        const r = await container.repos.slot.get(messageId, slotId);
        if (r?.ok && r.value) {
            recordCache.set(recordKey(messageId, slotId), r.value);
        }
    } catch {
        // 读失败不阻断挂载；控件保持 idle/空
    }

    // 激活期间被 dispose
    if (liveContainer() !== container) {
        return;
    }

    const handle = mountSlotWidget(slotRoot, messageId, {
        host: container.host,
        bus: container.bus,
        getChatId: () => container.host.getCurrentChatId(),
        isRendering: (mid, sid) => container.useCases.renderSlot.isRendering(mid, sid),
        hasPendingWrite: (mid, sid) => container.useCases.renderSlot.hasPendingWrite(mid, sid),
        onGenerateClick: (mid, sid, opts) => container.useCases.renderSlot.execute(mid, sid, {
            signal: opts?.signal,
            force: opts?.force === true,
        }),
        getRecord: (mid, sid) => recordCache.get(recordKey(mid, sid)) ?? null,
        getImageUrl: async (imageRef) => {
            const r = await container.repos.image.getUrl(imageRef);
            return r?.ok ? (r.value ?? null) : null;
        },
    });

    runtime.slotWidgets.set(key, handle);
}

/**
 * 预热某楼全部 slot 记录（切聊天 / 楼层就绪时）。
 * @param {Awaited<ReturnType<typeof createContainer>>} container
 * @param {number} messageId
 */
async function warmupMessageRecords(container, messageId) {
    try {
        const r = await container.repos.slot.getByMessage(messageId);
        if (!r?.ok || !Array.isArray(r.value)) {
            return;
        }
        for (const rec of r.value) {
            if (rec && rec.slotId != null) {
                recordCache.set(recordKey(messageId, rec.slotId), rec);
            }
        }
    } catch {
        // ignore
    }
}

/**
 * 插件激活：能力探测、装正则、挂 UI、启动观察器与自动开关。
 * 任何一步抛错都会捕住、中文 toast、回收已建资源，不抛到宿主。
 * @param {object} [opts] 测试注入
 * @param {() => any} [opts.getContext]
 * @param {typeof createContainer} [opts.createContainer]
 * @param {object} [opts.containerOpts]
 * @returns {Promise<void>}
 */
export async function activate(opts = {}) {
    if (runtime.activating) {
        return;
    }
    if (runtime.container) {
        await dispose();
    }

    runtime.activating = true;
    /** @type {Array<() => void|Promise<void>>} */
    const rollback = [];

    try {
        const getContext = typeof opts.getContext === 'function'
            ? opts.getContext
            : resolveGetContext();
        const create = typeof opts.createContainer === 'function'
            ? opts.createContainer
            : createContainer;

        const container = await create({ getContext, ...(opts.containerOpts || {}) });
        runtime.container = container;
        rollback.push(() => {
            try {
                container.dispose();
            } catch {
                // ignore
            }
            runtime.container = null;
        });

        const report = await probeCapabilities(container.host, {
            getContext,
            assume: { indexedDB: true },
        });
        for (const msg of capabilityWarningMessages(report)) {
            safeToast(container.host, 'warning', msg);
        }
        if (!report.ok) {
            const fatal = report.items.find((it) => (
                !it.available && ['getContext', 'indexedDB', 'hostPort'].includes(it.id)
            ));
            throw new Error(fatal?.detail || '宿主关键能力缺失，插件无法启动');
        }

        const regexResult = await container.host.ensureSlotRegexInstalled();
        if (regexResult && regexResult.ok === false) {
            safeToast(container.host, 'warning', formatUserMessage(regexResult));
        }

        if (typeof document !== 'undefined') {
            const drawerRoot = document.createElement('div');
            drawerRoot.className = 'nd-root';
            const drawerHandle = mountDrawer(drawerRoot, {
                loadSettings: container.loadSettings,
                saveSettings: (s) => container.settingsStore.save(s),
                openManagementShell: () => {
                    const c = liveContainer();
                    if (!c) {
                        safeToast(null, 'warning', '数据库生图插件未成功加载');
                        return;
                    }
                    void openManagementUi(c);
                },
                repos: container.repos,
            });
            const wbBtn = createButton({
                label: '打开工作台',
                variant: 'ghost',
                onClick: () => {
                    const c = liveContainer();
                    if (!c) {
                        safeToast(null, 'warning', '数据库生图插件未成功加载');
                        return;
                    }
                    void openWorkbenchUi(c);
                },
            });
            drawerRoot.appendChild(wbBtn);
            container.host.mountSettingsPanel(drawerRoot);
            runtime.drawerHandle = {
                destroy() {
                    try {
                        drawerHandle.destroy();
                    } catch {
                        // ignore
                    }
                    try {
                        wbBtn.remove();
                    } catch {
                        // ignore
                    }
                },
            };
            rollback.push(() => {
                try {
                    runtime.drawerHandle?.destroy();
                } catch {
                    // ignore
                }
                runtime.drawerHandle = null;
            });
        }

        const slotObserver = createSlotMountObserver({
            getChatRoot: () => (typeof document !== 'undefined'
                ? document.getElementById('chat')
                : null),
            mountSlot: (_messageEl, messageId, slotId) => {
                const mes = typeof document !== 'undefined'
                    ? document.querySelector(`.mes[mesid="${messageId}"]`)
                    : null;
                if (mes) {
                    void mountOneSlot(container, mes, messageId, slotId);
                }
            },
        });
        slotObserver.start();
        runtime.slotObserver = slotObserver;
        rollback.push(() => {
            try {
                slotObserver.stop();
            } catch {
                // ignore
            }
            runtime.slotObserver = null;
        });

        runtime.unsubDomReady = container.host.onMessageDomReady((messageEl, messageId) => {
            const c = liveContainer();
            if (!c) {
                return;
            }
            void warmupMessageRecords(c, messageId).then(() => {
                ensureFloorGenerateButton(messageEl, messageId, c);
                try {
                    runtime.slotObserver?.reconcile();
                } catch {
                    // ignore
                }
            });
        });
        rollback.push(() => {
            try {
                runtime.unsubDomReady?.();
            } catch {
                // ignore
            }
            runtime.unsubDomReady = null;
        });

        runtime.unsubChatChanged = container.host.onChatChanged(() => {
            for (const h of runtime.slotWidgets.values()) {
                try {
                    h.destroy();
                } catch {
                    // ignore
                }
            }
            runtime.slotWidgets.clear();
            recordCache.clear();
            try {
                runtime.slotObserver?.reconcile();
            } catch {
                // ignore
            }
        });
        rollback.push(() => {
            try {
                runtime.unsubChatChanged?.();
            } catch {
                // ignore
            }
            runtime.unsubChatChanged = null;
        });

        runtime.unsubSlotRenderedCache = container.bus.on(APP_EVENTS.SLOT_RENDERED, (payload) => {
            if (payload?.record && payload.messageId != null && payload.slotId != null) {
                recordCache.set(recordKey(payload.messageId, payload.slotId), payload.record);
            }
        });
        rollback.push(() => {
            try {
                runtime.unsubSlotRenderedCache?.();
            } catch {
                // ignore
            }
            runtime.unsubSlotRenderedCache = null;
        });

        runtime.unsubSlotsWrittenCache = container.bus.on(APP_EVENTS.SLOTS_WRITTEN, (payload) => {
            if (!payload || !Array.isArray(payload.records)) {
                return;
            }
            for (const rec of payload.records) {
                if (rec && rec.messageId != null && rec.slotId != null) {
                    recordCache.set(recordKey(rec.messageId, rec.slotId), rec);
                }
            }
        });
        rollback.push(() => {
            try {
                runtime.unsubSlotsWrittenCache?.();
            } catch {
                // ignore
            }
            runtime.unsubSlotsWrittenCache = null;
        });

        runtime.unsubUnmatched = container.bus.on(APP_EVENTS.TAG_RECALL_UNMATCHED, (payload) => {
            const keys = Array.isArray(payload?.unmatchedKeys) ? payload.unmatchedKeys : [];
            if (!keys.length) {
                return;
            }
            safeToast(container.host, 'warning', `标签召回未命中：${keys.join(', ')}`);
        });
        rollback.push(() => {
            try {
                runtime.unsubUnmatched?.();
            } catch {
                // ignore
            }
            runtime.unsubUnmatched = null;
        });

        // 可能失败的启动步骤放在斜杠注册之前（D56）
        container.services.autoTrigger.start();
        rollback.push(() => {
            try {
                container.services.autoTrigger.stop();
            } catch {
                // ignore
            }
        });

        startFloorBusyWatch(container);
        rollback.push(() => stopFloorBusyWatch());

        exposePublicApi(container);
        rollback.push(() => clearPublicApi());

        if (typeof globalThis[GENERATE_INTERCEPTOR_GLOBAL_NAME] !== 'function') {
            safeToast(container.host, 'warning', '出站剥 slot 拦截器未挂上，请检查 manifest.generate_interceptor');
        }

        // D56：斜杠放在所有可能失败步骤之后；回调仍活查 container 防 dispose 僵尸
        registerSlashCommands(container.host);

        rollback.length = 0;
    } catch (err) {
        const message = formatUserMessage(err);
        const host = runtime.container?.host;
        safeToast(host, 'error', `数据库生图插件启动失败：${message}`);

        for (let i = rollback.length - 1; i >= 0; i -= 1) {
            try {
                await rollback[i]();
            } catch {
                // ignore
            }
        }
        rollback.length = 0;
        await disposeInternal();
    } finally {
        runtime.activating = false;
    }
}

/**
 * @returns {Promise<void>}
 */
async function disposeInternal() {
    stopFloorBusyWatch();

    try {
        runtime.workbenchModal?.destroy();
    } catch {
        // ignore
    }
    runtime.workbenchModal = null;

    try {
        runtime.panelShell?.destroy();
    } catch {
        // ignore
    }
    runtime.panelShell = null;

    try {
        runtime.unsubUnmatched?.();
    } catch {
        // ignore
    }
    runtime.unsubUnmatched = null;

    try {
        runtime.unsubSlotRenderedCache?.();
    } catch {
        // ignore
    }
    runtime.unsubSlotRenderedCache = null;

    try {
        runtime.unsubSlotsWrittenCache?.();
    } catch {
        // ignore
    }
    runtime.unsubSlotsWrittenCache = null;

    try {
        runtime.unsubDomReady?.();
    } catch {
        // ignore
    }
    runtime.unsubDomReady = null;

    try {
        runtime.unsubChatChanged?.();
    } catch {
        // ignore
    }
    runtime.unsubChatChanged = null;

    try {
        runtime.container?.services?.autoTrigger?.stop();
    } catch {
        // ignore
    }

    try {
        runtime.slotObserver?.stop();
    } catch {
        // ignore
    }
    runtime.slotObserver = null;

    for (const h of runtime.slotWidgets.values()) {
        try {
            h.destroy();
        } catch {
            // ignore
        }
    }
    runtime.slotWidgets.clear();
    recordCache.clear();

    try {
        runtime.drawerHandle?.destroy();
    } catch {
        // ignore
    }
    runtime.drawerHandle = null;

    clearPublicApi();

    try {
        runtime.container?.dispose();
    } catch {
        // ignore
    }
    runtime.container = null;
    // slashRegistered 保持：宿主无卸载；回调活查 container===null →「未成功加载」

    try {
        if (typeof document !== 'undefined') {
            document.querySelectorAll(`[${FLOOR_BTN_ATTR}]`).forEach((el) => {
                try {
                    el.remove();
                } catch {
                    // ignore
                }
            });
        }
    } catch {
        // ignore
    }
}

/**
 * 插件停用：销毁 UI、取消订阅、释放 blob URL。须可重复调用。
 * @returns {Promise<void>}
 */
export async function dispose() {
    await disposeInternal();
}

/**
 * 测试用：读取当前运行时快照。
 * @returns {Readonly<RuntimeState>}
 */
export function _runtimeForTest() {
    return runtime;
}

/**
 * 测试用：读 recordCache。
 * @returns {Map<string, import('../domain/model/slot.js').SlotRecord>}
 */
export function _recordCacheForTest() {
    return recordCache;
}
