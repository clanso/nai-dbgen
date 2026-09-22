/**
 * L5 UI · 楼层内 slot 控件：补类名、填按钮文案、塞图片、事件绑定。
 * 归属：W2-G 控件代理实现。W0 仅冻结签名。
 * 每个挂载函数须返回 { destroy }。
 *
 * 消毒：骨架过 DOMPurify（class→custom-*）；本模块用 createElement 建子节点，类名无前缀。
 * XSS：禁用 innerHTML；img.src 一律 safeImageUrl。
 */

import { APP_EVENTS } from '../../application/_helpers.js';
import {
    ensureSlotUnprefixedClasses,
    SLOT_BTN_CLASS,
    SLOT_IMG_CLASS,
    SLOT_ROOT_CLASS,
} from '../../adapters/host/slot-mount.observer.js';
import { safeImageUrl } from '../common/safe-url.js';
import {
    classifyGenerateSettlement,
    deriveSlotUiView,
    latestImageEntry,
    slotErrorTraceId,
} from './slot-states.js';
import {
    attachSlotInflightPromise,
    beginSlotInflight,
    peekSlotInflight,
    resolveSlotInflightAbort,
    resolveSlotInflightError,
    resolveSlotInflightOk,
    slotRuntimeSnapshot,
    watchSlotInflight,
} from './slot-mount.js';
import { openSlotImageViewer } from './image-viewer.js';

/**
 * @typedef {object} SlotWidgetDeps
 * @property {(messageId: number, slotId: number, opts?: { signal?: AbortSignal }) => (void|Promise<unknown>|{ ok: boolean, error?: unknown, value?: unknown })} onGenerateClick
 * @property {(messageId: number, slotId: number) => import('../../domain/model/slot.js').SlotRecord|null} getRecord
 * @property {(imageRef: string) => Promise<string|null>} getImageUrl
 * @property {{ on: (type: string, fn: (payload: unknown) => void) => (() => void) }} [bus]
 * @property {import('../../ports/host.port.js').HostPort} [host]
 */

/**
 * 深度优先找后代（兼容假 DOM：无可靠 querySelector）。
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
 * @param {string} className
 * @returns {boolean}
 */
function classIncludes(el, token) {
    const cls = String(/** @type {{ className?: unknown }} */ (el).className || '');
    return cls.split(/\s+/).includes(token) || cls.includes(token);
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
        return classIncludes(el, SLOT_BTN_CLASS) || classIncludes(el, 'nai-slot-btn');
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
        classIncludes(el, SLOT_IMG_CLASS)
        || classIncludes(el, 'nai-slot-img')
        || classIncludes(el, 'custom-nai-slot-img')
    )));
    if (!imgBox) {
        imgBox = document.createElement('div');
        rootEl.appendChild(imgBox);
    }
    imgBox.classList.add(SLOT_IMG_CLASS);

    let statusEl = /** @type {HTMLElement|null} */ (findDescendant(rootEl, (el) => (
        classIncludes(el, 'nd-slot__status')
    )));
    if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.className = 'nd-slot__status';
        statusEl.setAttribute('aria-live', 'polite');
        rootEl.appendChild(statusEl);
    }

    let errEl = /** @type {HTMLElement|null} */ (findDescendant(rootEl, (el) => (
        classIncludes(el, 'nd-slot__error')
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
 * 撤销本控件自己 createObjectURL 出来的地址（不得动 getImageUrl 返回的外源 blob）。
 * @param {string[]} ownedObjectUrls
 */
function revokeOwnedObjectUrls(ownedObjectUrls) {
    while (ownedObjectUrls.length) {
        const old = ownedObjectUrls.pop();
        if (old && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
            try {
                URL.revokeObjectURL(old);
            } catch {
                // ignore
            }
        }
    }
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
    /** @type {string[]} */
    const ownedObjectUrls = [];
    /** @type {string|null} */
    let currentImageUrl = null;
    /** @type {(() => void)|null} */
    let unwatchInflight = null;
    /** @type {(() => void)|null} */
    let unsubBus = null;
    /** @type {number} */
    let paintGeneration = 0;

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
        const record = deps.getRecord(messageId, slotId);
        const runtime = slotRuntimeSnapshot(messageId, slotId);
        const view = deriveSlotUiView(record, runtime);

        applyStateClasses(view.stateClass);
        btn.textContent = view.buttonLabel;
        btn.disabled = view.busy;
        if (typeof btn.setAttribute === 'function') {
            btn.setAttribute('aria-busy', view.busy ? 'true' : 'false');
        }

        statusEl.textContent = view.busy ? '生图中…' : '';

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
        const entry = peekSlotInflight(messageId, slotId);
        if (!entry) {
            return;
        }
        unwatchInflight = watchSlotInflight(messageId, slotId, () => {
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
        const existing = peekSlotInflight(messageId, slotId);
        if (existing && existing.status === 'generating') {
            bindInflightWatch();
            await paintFromStore();
            return;
        }

        const { entry, created } = beginSlotInflight(messageId, slotId);
        bindInflightWatch();
        await paintFromStore();

        if (!created) {
            return;
        }

        const signal = entry.controller ? entry.controller.signal : undefined;
        const work = Promise.resolve().then(() => (
            deps.onGenerateClick(messageId, slotId, { signal })
        ));
        attachSlotInflightPromise(messageId, slotId, work);

        let settled;
        try {
            settled = await work;
        } catch (err) {
            settled = err;
        }

        const kind = classifyGenerateSettlement(settled);
        if (kind.kind === 'ok') {
            resolveSlotInflightOk(messageId, slotId);
        } else if (kind.kind === 'abort') {
            resolveSlotInflightAbort(messageId, slotId);
        } else {
            const err = kind.error;
            const traceId = slotErrorTraceId(err, null);
            resolveSlotInflightError(messageId, slotId, err, traceId || null);
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
            const p = /** @type {{ messageId?: unknown, slotId?: unknown }} */ (payload);
            if (Number(p.messageId) !== Number(messageId) || Number(p.slotId) !== Number(slotId)) {
                return;
            }
            resolveSlotInflightOk(messageId, slotId);
            void paintFromStore();
        });
    }

    if (peekSlotInflight(messageId, slotId)) {
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
            if (unwatchInflight) {
                unwatchInflight();
                unwatchInflight = null;
            }
            revokeOwnedObjectUrls(ownedObjectUrls);
            currentImageUrl = null;
            // 不 abort、不清 inflight：宿主重渲染不得取消计费中请求
        },
    };
}
