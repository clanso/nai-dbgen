/**
 * L5 UI · 图片查看器（宿主 Popup / openModal）。
 * 归属：W1-E 公共组件（原 slot-widget，供面板/控件共用）。
 *
 * 凡写 img.src 必须过 safeImageUrl（D24）。
 */

import { safeImageUrl } from './safe-url.js';

/**
 * 构建查看器内容根（带 .nd-root，令牌生效；D52 不用 id）。
 * @param {string} safeUrl 已过白名单
 * @param {string} [alt]
 * @returns {HTMLElement}
 */
export function buildImageViewerElement(safeUrl, alt) {
    const root = document.createElement('div');
    root.className = 'nd-root nd-slot-viewer';

    const img = document.createElement('img');
    img.className = 'nd-slot-viewer__img';
    img.src = safeUrl;
    img.alt = alt == null ? '' : String(alt);
    root.appendChild(img);
    return root;
}

/**
 * 打开大图。URL 未过白名单则返回 null（不弹窗）。
 * @param {object} deps
 * @param {import('../../ports/host.port.js').HostPort} [deps.host]
 * @param {object} opts
 * @param {unknown} opts.url
 * @param {string} [opts.title]
 * @param {string} [opts.alt]
 * @returns {Promise<{ destroy: () => void }|null>}
 */
export async function openSlotImageViewer(_deps, opts) {
    const safe = safeImageUrl(opts?.url);
    if (!safe) {
        return null;
    }
    const overlay = document.createElement('dialog');
    overlay.className = 'nd-image-only';
    const img = document.createElement('img');
    img.className = 'nd-image-only__img';
    img.src = safe;
    img.alt = opts?.alt == null ? '' : String(opts.alt);
    overlay.appendChild(img);

    let closed = false;
    function close() {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKey, true);
        try {
            if (overlay.open && typeof overlay.close === 'function') overlay.close();
        } catch { /* ignore */ }
        overlay.remove();
    }
    /** @param {KeyboardEvent} event */
    function onKey(event) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close();
    }
    overlay.addEventListener('click', close);
    overlay.addEventListener('close', close);
    document.addEventListener('keydown', onKey, true);
    const parent = document.body || document.documentElement;
    parent.appendChild(overlay);
    if (typeof overlay.showModal === 'function') {
        overlay.showModal();
    }
    return { destroy: close };
}
