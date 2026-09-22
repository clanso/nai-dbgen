/**
 * L2 适配器 · MutationObserver 幂等对账挂载 slot 控件（架构 §6.1）。
 * 归属：W1-B 宿主代理实现。W0 仅冻结签名。
 */

/** 挂载幂等标记（架构 §6.1） */
export const SLOT_MOUNTED_ATTR = 'data-nai-mounted';

/** 定位锚点：靠 data-slot，不靠 class（DOMPurify 会给 class 加 custom- 前缀） */
export const SLOT_SELECTOR = '[data-slot]';

/** JS 补的未净化类名（架构 §8.3） */
export const SLOT_ROOT_CLASS = 'nd-slot';
export const SLOT_BTN_CLASS = 'nd-slot__btn';
export const SLOT_IMG_CLASS = 'nd-slot__img';

/** 默认对账去抖（流式 innerHTML 高频覆写，R-09） */
export const DEFAULT_RECONCILE_DEBOUNCE_MS = 80;

/**
 * 从最近的 .mes[mesid] 解析楼层号。
 * @param {Element} el
 * @returns {number} 找不到时 -1
 */
export function resolveMessageIdFromElement(el) {
    if (!el || typeof el.closest !== 'function') {
        return -1;
    }
    const mes = el.closest('.mes[mesid]');
    if (!mes) {
        return -1;
    }
    const raw = mes.getAttribute('mesid');
    const id = Number(raw);
    return Number.isInteger(id) ? id : -1;
}

/**
 * 解析 data-slot 为 slotId。
 * @param {Element} el
 * @returns {number} 无效时 -1
 */
export function resolveSlotIdFromElement(el) {
    if (!el || typeof el.getAttribute !== 'function') {
        return -1;
    }
    const raw = el.getAttribute('data-slot');
    const id = Number(raw);
    return Number.isInteger(id) && id >= 1 ? id : -1;
}

/**
 * 给骨架根节点补未加前缀的类名；给已知子节点补 BEM 类。
 * @param {Element} root
 * @returns {void}
 */
export function ensureSlotUnprefixedClasses(root) {
    if (!root || !root.classList) {
        return;
    }
    root.classList.add(SLOT_ROOT_CLASS);
    const btn = root.querySelector('button, .nai-slot-btn, .custom-nai-slot-btn');
    if (btn && btn.classList) {
        btn.classList.add(SLOT_BTN_CLASS);
    }
    const img = root.querySelector('.nai-slot-img, .custom-nai-slot-img, [class*="nai-slot-img"]');
    if (img && img.classList) {
        img.classList.add(SLOT_IMG_CLASS);
    }
}

/**
 * 探测酒馆是否正在流式输出（任一流式处理器未结束即视为流式中）。
 * 流式中禁止挂载（R-09）；由 onAiMessageSettled 后再 reconcile。
 * @returns {boolean}
 */
export function isHostStreamingActive() {
    try {
        const st = globalThis.SillyTavern;
        const ctx = typeof st?.getContext === 'function' ? st.getContext() : null;
        const sp = ctx?.streamingProcessor;
        if (!sp) {
            return false;
        }
        if (sp.isFinished === true || sp.isStopped === true) {
            return false;
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * 是否像可挂载的 slot 节点（Node 测试环境可能没有 Element 全局）。
 * @param {unknown} node
 * @returns {boolean}
 */
function isSlotLikeNode(node) {
    if (node == null || typeof node !== 'object') {
        return false;
    }
    if (typeof Element !== 'undefined' && node instanceof Element) {
        return true;
    }
    return typeof /** @type {{ getAttribute?: unknown }} */ (node).getAttribute === 'function';
}

/**
 * 收集根下尚未挂载的 slot 元素。
 * @param {Element} root
 * @returns {Element[]}
 */
export function collectUnmountedSlots(root) {
    if (!root || typeof root.querySelectorAll !== 'function') {
        return [];
    }
    const nodes = root.querySelectorAll(SLOT_SELECTOR);
    /** @type {Element[]} */
    const out = [];
    for (const node of nodes) {
        if (!isSlotLikeNode(node)) {
            continue;
        }
        const el = /** @type {Element} */ (node);
        if (el.getAttribute(SLOT_MOUNTED_ATTR) === '1') {
            continue;
        }
        out.push(el);
    }
    return out;
}

/**
 * @typedef {object} SlotMountDeps
 * @property {(messageEl: Element, messageId: number, slotId: number) => void} mountSlot
 * @property {() => Element|null} getChatRoot 通常 #chat
 */

/**
 * @param {SlotMountDeps} deps
 * @returns {{ start: () => void, stop: () => void, reconcile: () => void }}
 */
export function createSlotMountObserver(deps) {
    if (!deps || typeof deps.mountSlot !== 'function') {
        throw new Error('invalid argument: deps.mountSlot');
    }
    if (typeof deps.getChatRoot !== 'function') {
        throw new Error('invalid argument: deps.getChatRoot');
    }

    /** @type {MutationObserver|null} */
    let observer = null;
    /** @type {ReturnType<typeof setTimeout>|null} */
    let debounceTimer = null;
    let started = false;
    const debounceMs = DEFAULT_RECONCILE_DEBOUNCE_MS;

    /**
     * 立即对账一次（流式中跳过）。
     * @returns {void}
     */
    function reconcile() {
        if (isHostStreamingActive()) {
            return;
        }
        const chatRoot = deps.getChatRoot();
        if (!chatRoot) {
            return;
        }
        const slots = collectUnmountedSlots(chatRoot);
        for (const slotEl of slots) {
            const slotId = resolveSlotIdFromElement(slotEl);
            if (slotId < 1) {
                continue;
            }
            const messageId = resolveMessageIdFromElement(slotEl);
            if (messageId < 0) {
                continue;
            }
            // 再次检查：对账过程中可能被流式冲掉
            if (slotEl.getAttribute(SLOT_MOUNTED_ATTR) === '1') {
                continue;
            }
            ensureSlotUnprefixedClasses(slotEl);
            slotEl.setAttribute(SLOT_MOUNTED_ATTR, '1');
            try {
                const messageEl = slotEl.closest('.mes') || slotEl;
                deps.mountSlot(messageEl, messageId, slotId);
            } catch {
                // 挂载失败则清除标记，允许下次对账重试
                slotEl.removeAttribute(SLOT_MOUNTED_ATTR);
            }
        }
    }

    /**
     * @returns {void}
     */
    function scheduleReconcile() {
        if (debounceTimer != null) {
            clearTimeout(debounceTimer);
        }
        debounceTimer = setTimeout(() => {
            debounceTimer = null;
            reconcile();
        }, debounceMs);
    }

    /**
     * @returns {void}
     */
    function start() {
        if (started) {
            return;
        }
        started = true;
        const chatRoot = deps.getChatRoot();
        if (chatRoot && typeof MutationObserver === 'function') {
            observer = new MutationObserver(() => {
                scheduleReconcile();
            });
            observer.observe(chatRoot, { childList: true, subtree: true });
        }
        reconcile();
    }

    /**
     * @returns {void}
     */
    function stop() {
        started = false;
        if (debounceTimer != null) {
            clearTimeout(debounceTimer);
            debounceTimer = null;
        }
        if (observer) {
            observer.disconnect();
            observer = null;
        }
    }

    return { start, stop, reconcile };
}
