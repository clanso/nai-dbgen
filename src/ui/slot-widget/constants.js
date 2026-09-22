/**
 * L5 UI · slot 类名常量（裁决 D40）。
 *
 * 本文件是 UI 侧副本，**不得**从 adapters 反向 import。
 * 必须与 `adapters/host/slot-mount.observer.js` 中同名常量保持一致；
 * 建议后续统一下沉到 `domain/slot/`（协调者终审前安排）。
 */

/** JS 补的未净化根类（架构 §8.3） */
export const SLOT_ROOT_CLASS = 'nd-slot';
/** 按钮 BEM 类 */
export const SLOT_BTN_CLASS = 'nd-slot__btn';
/** 图片容器 BEM 类 */
export const SLOT_IMG_CLASS = 'nd-slot__img';

/**
 * classList 精确 token 匹配（禁止 substring，避免 `nd-slot__btn` 误命中 `nd-slot__btn-x` 之类）。
 * @param {Element|{ className?: unknown }} el
 * @param {string} token
 * @returns {boolean}
 */
export function hasClassToken(el, token) {
    if (!el || token == null || token === '') {
        return false;
    }
    const cls = String(/** @type {{ className?: unknown }} */ (el).className || '');
    return cls.split(/\s+/).filter(Boolean).includes(String(token));
}

/**
 * 给骨架根节点补未加前缀的类名（与 adapters 侧 ensureSlotUnprefixedClasses 同语义）。
 * @param {Element} root
 * @returns {void}
 */
export function ensureSlotUnprefixedClasses(root) {
    if (!root || !root.classList) {
        return;
    }
    root.classList.add(SLOT_ROOT_CLASS);

    const kids = /** @type {{ childNodes?: ArrayLike<Element> }} */ (root).childNodes;
    if (!kids) {
        return;
    }
    for (let i = 0; i < kids.length; i += 1) {
        const el = kids[i];
        if (!el || typeof /** @type {{ tagName?: unknown }} */ (el).tagName !== 'string') {
            continue;
        }
        const tag = String(el.tagName).toUpperCase();
        if (tag === 'BUTTON' || hasClassToken(el, 'nai-slot-btn') || hasClassToken(el, 'custom-nai-slot-btn')) {
            el.classList.add(SLOT_BTN_CLASS);
        }
        if (
            hasClassToken(el, 'nai-slot-img')
            || hasClassToken(el, 'custom-nai-slot-img')
            || hasClassToken(el, SLOT_IMG_CLASS)
        ) {
            el.classList.add(SLOT_IMG_CLASS);
        }
    }
}
