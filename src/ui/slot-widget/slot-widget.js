/**
 * L5 UI · 楼层内 slot 控件：补类名、填按钮文案、塞图片、事件绑定。
 * 归属：W2-G 控件代理实现。W0 仅冻结签名。
 * 每个挂载函数须返回 { destroy }。
 *
 * 裁决：
 * - D35：本地视觉表只管外观；busy 优先问 isRendering / hasPendingWrite
 * - D36：视觉键带 chatId；切聊天清其它条目
 * - D40：类名常量来自 ./constants.js，不反向 import adapters
 * - D43：onGenerateClick 必须返回 Promise<Result>；非 Result 不清视觉表
 *
 * XSS：禁用 innerHTML；img.src 一律 safeImageUrl。
 * blob URL：由 getImageUrl 提供方（ImageRepository / W3）负责 create/revoke；本控件不自建 ObjectURL。
 */

import { APP_EVENTS } from '../../application/_helpers.js';
import { safeImageUrl } from '../common/safe-url.js';
import {
    ensureSlotUnprefixedClasses,
    hasClassToken,
    SLOT_BTN_CLASS,
    SLOT_IMG_CLASS,
    SLOT_ROOT_CLASS,
} from './constants.js';
import {
    classifyGenerateSettlement,
    deriveSlotUiView,
    latestImageEntry,
    recordHasImage,
    slotErrorTraceId,
} from './slot-states.js';
import {
    attachSlotInflightPromise,
    beginSlotInflight,
    clearSlotInflightOtherChats,
    peekSlotInflight,
    resolveSlotInflightAbort,
    resolveSlotInflightError,
    resolveSlotInflightOk,
    resolveVisualRuntime,
    watchSlotInflight,
} from './slot-mount.js';
import { openSlotImageViewer } from './image-viewer.js';

/**
 * @typedef {object} SlotWidgetDeps
 * @property {(
 *   messageId: number,
 *   slotId: number,
 *   opts?: { signal?: AbortSignal, force?: boolean }
 * ) => Promise<{ ok: boolean, error?: unknown, value?: unknown }>} onGenerateClick
 *   D43：必须返回 Promise<Result>
 * @property {(messageId: number, slotId: number) => import('../../domain/model/slot.js').SlotRecord|null} getRecord
 * @property {(imageRef: string) => Promise<string|null>} getImageUrl
 * @property {() => (string|null)} [getChatId]
 * @property {(messageId: number, slotId: number) => boolean} [isRendering]
 *   D35：应用层闸门查询
 * @property {(messageId: number, slotId: number) => boolean} [hasPendingWrite]
 *   D35 / D42
 * @property {{ on: (type: string, fn: (payload: unknown) => void) => (() => void) }} [bus]
 * @property {import('../../ports/host.port.js').HostPort} [host]
 */

/**
 * @param {Element} root
 * @param {(el: Element) => boolean} pred
 * @returns {Element|null}
 */
function findDescendant(root, pred) {
    if (!root) {
        return null;
    }
    /** @type {Element[]} */
    const stack = [];
    const kids0 = /** @type {{ childNodes?: ArrayLike<Element> }} */ (root).childNodes;
    if (kids0) {
        for (let i = kids0.length - 1; i >= 0; i -= 1) {
            const child = kids0[i];
            if (child && typeof /** @type {{ tagName?: unknown }} */ (child).tagName === 'string') {
                stack.push(/** @type {Element} */ (child));
            }
        }
    }
    while (stack.length) {
        const cur = /** @type {Element} */ (stack.pop());
        if (pred(cur)) {
            return cur;
        }
        const kids = /** @type {{ childNodes?: ArrayLike<Element> }} */ (cur).childNodes;
        if (kids) {
            for (let i = kids.length - 1; i >= 0; i -= 1) {
                const child = kids[i];
                if (child && typeof /** @type {{ tagName?: unknown }} */ (child).tagName === 'string') {
                    stack.push(/** @type {Element} */ (child));
                }
            }
        }
    }
    return null;
}

/**
 * @param {Element} rootEl
 * @returns {{ btn: HTMLButtonElement, imgBox: HTMLElement, statusEl: HTMLElement, errEl: HTMLElement }}
 */
function ensureChrome(rootEl) {
    ensureSlotUnprefixedClasses(rootEl);
    rootEl.classList.add(SLOT_ROOT_CLASS);

    let btn = /** @type {HTMLButtonElement|null} */ (findDescendant(rootEl, (el) => {
        const tag = String(el.tagName || '').toUpperCase();
        if (tag === 'BUTTON') {
            return true;
        }
        return hasClassToken(el, SLOT_BTN_CLASS) || hasClassToken(el, 'nai-slot-btn');
    }));
    if (!btn) {
        btn = /** @type {HTMLButtonElement} */ (document.createElement('button'));
        rootEl.appendChild(btn);
    }
    btn.classList.add(SLOT_BTN_CLASS);
    if (typeof btn.setAttribute === 'function') {
        btn.setAttribute('type', 'button');
    } else {
        /** @type {{ type?: string }} */ (btn).type = 'button';
    }

    let imgBox = /** @type {HTMLElement|null} */ (findDescendant(rootEl, (el) => (
        hasClassToken(el, SLOT_IMG_CLASS)
        || hasClassToken(el, 'nai-slot-img')
        || hasClassToken(el, 'custom-nai-slot-img')
    )));
    if (!imgBox) {
        imgBox = document.createElement('div');
        rootEl.appendChild(imgBox);
    }
    imgBox.classList.add(SLOT_IMG_CLASS);

    let statusEl = /** @type {HTMLElement|null} */ (findDescendant(rootEl, (el) => (
        hasClassToken(el, 'nd-slot__status')
    )));
    if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.className = 'nd-slot__status';
        statusEl.setAttribute('aria-live', 'polite');
        rootEl.appendChild(statusEl);
    }

    let errEl = /** @type {HTMLElement|null} */ (findDescendant(rootEl, (el) => (
        hasClassToken(el, 'nd-slot__error')
    )));
    if (!errEl) {
        errEl = document.createElement('div');
        errEl.className = 'nd-slot__error';
        errEl.setAttribute('role', 'alert');
        errEl.hidden = true;
        rootEl.appendChild(errEl);
    }

    return { btn, imgBox, statusEl, errEl };
}

/**
 * @param {HTMLElement} imgBox
 * @param {string|null} url
 * @param {(event: Event) => void} onThumbClick
 * @returns {HTMLImageElement|null}
 */
function paintImage(imgBox, url, onThumbClick) {
    imgBox.replaceChildren();
    const safe = safeImageUrl(url);
    if (!safe) {
        return null;
    }
    const img = document.createElement('img');
    img.className = 'nd-slot__thumb';
    img.src = safe;
    img.alt = '';
    img.addEventListener('click', onThumbClick);
    imgBox.appendChild(img);
    return img;
}

/**
 * 在已存在的 div[data-slot] 根上挂载（幂等：已 data-nai-mounted 则跳过或刷新）。
 * @param {Element} rootEl div[data-slot]
 * @param {number} messageId
 * @param {SlotWidgetDeps} deps
 * @returns {{ destroy: () => void, refresh: () => void }}
 */
export function mountSlotWidget(rootEl, messageId, deps) {
    if (!rootEl || typeof deps?.onGenerateClick !== 'function') {
        throw new Error('invalid argument: mountSlotWidget');
    }
    if (typeof deps.getRecord !== 'function' || typeof deps.getImageUrl !== 'function') {
        throw new Error('invalid argument: mountSlotWidget deps');
    }

    const slotIdRaw = rootEl.getAttribute?.('data-slot');
    const slotId = Number(slotIdRaw);
    if (!Number.isInteger(slotId) || slotId < 1) {
        throw new Error('invalid argument: data-slot');
    }

    const { btn, imgBox, statusEl, errEl } = ensureChrome(rootEl);

    let destroyed = false;
    /** @type {string|null} */
    let currentImageUrl = null;
    /** @type {(() => void)|null} */
    let unwatchInflight = null;
    /** @type {(() => void)|null} */
    let unsubBus = null;
    /** @type {(() => void)|null} */
    let unsubChat = null;
    /** @type {number} */
    let paintGeneration = 0;

    /**
     * @returns {string|null}
     */
    function resolveChatId() {
        if (typeof deps.getChatId === 'function') {
            const id = deps.getChatId();
            return id == null || id === '' ? null : String(id);
        }
        if (deps.host && typeof deps.host.getCurrentChatId === 'function') {
            const id = deps.host.getCurrentChatId();
            return id == null || id === '' ? null : String(id);
        }
        return null;
    }

    /**
     * @returns {boolean}
     */
    function appIsRendering() {
        return typeof deps.isRendering === 'function'
            ? Boolean(deps.isRendering(messageId, slotId))
            : false;
    }

    /**
     * @returns {boolean}
     */
    function appHasPendingWrite() {
        return typeof deps.hasPendingWrite === 'function'
            ? Boolean(deps.hasPendingWrite(messageId, slotId))
            : false;
    }

    /**
     * @param {string} stateClass
     */
    function applyStateClasses(stateClass) {
        rootEl.classList.remove(
            'nd-slot--idle',
            'nd-slot--generating',
            'nd-slot--done',
            'nd-slot--error',
        );
        rootEl.classList.add(stateClass);
    }

    /**
     * @param {Event} [event]
     */
    function onThumbClick(event) {
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        if (destroyed || !currentImageUrl) {
            return;
        }
        void openSlotImageViewer(
            { host: deps.host },
            { url: currentImageUrl, title: `Slot #${slotId}` },
        );
    }

    /**
     * @returns {Promise<void>}
     */
    async function paintFromStore() {
        if (destroyed) {
            return;
        }
        const gen = ++paintGeneration;
        const chatId = resolveChatId();
        const record = deps.getRecord(messageId, slotId);
        const runtime = resolveVisualRuntime({
            chatId,
            messageId,
            slotId,
            appRendering: appIsRendering(),
            appPendingWrite: appHasPendingWrite(),
        });
        const view = deriveSlotUiView(record, runtime);

        applyStateClasses(view.stateClass);
        btn.textContent = view.buttonLabel;
        btn.disabled = view.busy;
        if (typeof btn.setAttribute === 'function') {
            btn.setAttribute('aria-busy', view.busy ? 'true' : 'false');
        }

        statusEl.textContent = view.busy
            ? (appHasPendingWrite() && !appIsRendering() ? '写入中…' : '生图中…')
            : '';

        if (view.showError) {
            errEl.hidden = false;
            errEl.replaceChildren();
            const msg = document.createElement('div');
            msg.className = 'nd-slot__error-msg';
            msg.textContent = view.errorMessage;
            errEl.appendChild(msg);
            if (view.traceId) {
                const tid = document.createElement('div');
                tid.className = 'nd-slot__error-trace';
                tid.textContent = `traceId: ${view.traceId}`;
                errEl.appendChild(tid);
            }
        } else {
            errEl.hidden = true;
            errEl.replaceChildren();
        }

        const entry = latestImageEntry(record);
        if (!entry) {
            if (view.state !== 'generating') {
                paintImage(imgBox, null, onThumbClick);
                currentImageUrl = null;
            }
            return;
        }

        try {
            const url = await deps.getImageUrl(entry.imageRef);
            if (destroyed || gen !== paintGeneration) {
                return;
            }
            currentImageUrl = url;
            paintImage(imgBox, url, onThumbClick);
        } catch {
            if (!destroyed && gen === paintGeneration) {
                paintImage(imgBox, null, onThumbClick);
                currentImageUrl = null;
            }
        }
    }

    function bindInflightWatch() {
        if (unwatchInflight) {
            unwatchInflight();
            unwatchInflight = null;
        }
        const chatId = resolveChatId();
        const entry = peekSlotInflight(chatId, messageId, slotId);
        if (!entry) {
            return;
        }
        unwatchInflight = watchSlotInflight(chatId, messageId, slotId, () => {
            if (!destroyed) {
                void paintFromStore();
            }
        });
    }

    /**
     * @returns {Promise<void>}
     */
    async function runGenerate() {
        if (destroyed) {
            return;
        }
        const chatId = resolveChatId();

        // 视觉：若本地已在 generating，只刷新；仍允许再次 onGenerateClick
        // （D35：应用层共享 Promise，不会双份扣费）
        const { entry, created } = beginSlotInflight(chatId, messageId, slotId);
        bindInflightWatch();
        await paintFromStore();

        // 本地已有进行中视觉且应用层也 busy → 不必再调（减少噪音）；否则仍调闸门
        if (!created && (appIsRendering() || appHasPendingWrite())) {
            return;
        }

        const record = deps.getRecord(messageId, slotId);
        const force = recordHasImage(record);
        const signal = entry.controller ? entry.controller.signal : undefined;

        const work = Promise.resolve().then(() => (
            deps.onGenerateClick(messageId, slotId, { signal, force })
        ));
        attachSlotInflightPromise(chatId, messageId, slotId, work);

        let settled;
        try {
            settled = await work;
        } catch (err) {
            settled = err;
        }

        // 切聊天后本键可能已清；用发起时的 chatId 结算
        const kind = classifyGenerateSettlement(settled);
        if (kind.kind === 'ok' || kind.kind === 'already') {
            // already = SLOT_ALREADY_RENDERED：闸门正常，不弹红
            resolveSlotInflightOk(chatId, messageId, slotId);
        } else if (kind.kind === 'abort') {
            resolveSlotInflightAbort(chatId, messageId, slotId);
        } else if (kind.kind === 'invalid') {
            // D43：非 Result → 不清表，保持 generating，避免再点再发
            return;
        } else {
            const err = kind.error;
            const traceId = slotErrorTraceId(err, null);
            resolveSlotInflightError(chatId, messageId, slotId, err, traceId || null);
        }

        if (!destroyed) {
            await paintFromStore();
        }
    }

    /**
     * @param {Event} [event]
     */
    function onBtnClick(event) {
        if (event && typeof event.preventDefault === 'function') {
            event.preventDefault();
        }
        if (event && typeof event.stopPropagation === 'function') {
            event.stopPropagation();
        }
        if (destroyed || btn.disabled) {
            return;
        }
        void runGenerate();
    }

    btn.addEventListener('click', onBtnClick);

    if (deps.bus && typeof deps.bus.on === 'function') {
        unsubBus = deps.bus.on(APP_EVENTS.SLOT_RENDERED, (payload) => {
            if (destroyed || !payload || typeof payload !== 'object') {
                return;
            }
            const p = /** @type {{ messageId?: unknown, slotId?: unknown, chatId?: unknown }} */ (payload);
            if (Number(p.messageId) !== Number(messageId) || Number(p.slotId) !== Number(slotId)) {
                return;
            }
            const chatId = resolveChatId();
            if (p.chatId != null && chatId != null && String(p.chatId) !== String(chatId)) {
                return;
            }
            resolveSlotInflightOk(chatId, messageId, slotId);
            void paintFromStore();
        });
    }

    if (deps.host && typeof deps.host.onChatChanged === 'function') {
        unsubChat = deps.host.onChatChanged((nextChatId) => {
            clearSlotInflightOtherChats(nextChatId);
            if (!destroyed) {
                void paintFromStore();
            }
        });
    }

    // 挂载时先按当前 chat 清掉其它聊天残留（D36）
    clearSlotInflightOtherChats(resolveChatId());

    if (peekSlotInflight(resolveChatId(), messageId, slotId) || appIsRendering() || appHasPendingWrite()) {
        bindInflightWatch();
    }

    void paintFromStore();

    return {
        refresh() {
            if (destroyed) {
                return;
            }
            void paintFromStore();
        },
        destroy() {
            if (destroyed) {
                return;
            }
            destroyed = true;
            btn.removeEventListener('click', onBtnClick);
            if (unsubBus) {
                unsubBus();
                unsubBus = null;
            }
            if (unsubChat) {
                unsubChat();
                unsubChat = null;
            }
            if (unwatchInflight) {
                unwatchInflight();
                unwatchInflight = null;
            }
            currentImageUrl = null;
            // 不清应用层闸门；不清本 chat 视觉 generating（remount 可附着）
        },
    };
}
