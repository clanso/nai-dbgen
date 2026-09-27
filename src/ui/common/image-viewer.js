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
    const sources = Array.isArray(opts?.images) && opts.images.length
        ? opts.images
        : [{ url: opts?.url, alt: opts?.alt }];
    const resolved = await Promise.all(sources.map(async (item, sourceIndex) => {
        try {
            const url = item.url ?? await opts?.getImageUrl?.(item.imageRef);
            const safe = safeImageUrl(url);
            return safe ? { ...item, url: safe, sourceIndex } : null;
        } catch {
            return null;
        }
    }));
    const images = resolved.filter(Boolean);
    if (!images.length) return null;
    let index = images.findIndex((item) => item.sourceIndex === opts?.initialIndex);
    if (index < 0) index = images.length - 1;
    const overlay = document.createElement('dialog');
    overlay.className = 'nd-image-only';
    overlay.setAttribute('aria-label', opts?.title || '图片历史');
    const toolbar = document.createElement('div');
    toolbar.className = 'nd-image-only__toolbar';
    const strip = document.createElement('div');
    strip.className = 'nd-image-only__history';
    const count = document.createElement('span');
    count.setAttribute('aria-live', 'polite');
    const error = document.createElement('span');
    error.className = 'nd-image-only__error';
    error.textContent = '图片缓存已清理或不可用';
    error.hidden = true;
    const img = document.createElement('img');
    img.className = 'nd-image-only__img';
    img.addEventListener('error', () => { error.hidden = false; });
    img.addEventListener('load', () => { error.hidden = true; });
    function button(symbol, label, click) {
        const node = document.createElement('button');
        node.type = 'button';
        node.className = 'nd-image-only__button';
        node.textContent = symbol;
        node.title = label;
        node.setAttribute('aria-label', label);
        node.addEventListener('click', click);
        return node;
    }
    const previous = button('‹', '上一张', () => select(index - 1));
    const next = button('›', '下一张', () => select(index + 1));
    const closeButton = button('×', '关闭图片历史', () => close());
    const thumbs = images.map((item, i) => {
        const thumb = button('', `历史图片 ${i + 1}`, () => select(i));
        thumb.className = 'nd-image-only__thumbnail';
        const preview = document.createElement('img');
        preview.src = item.url;
        preview.alt = '';
        preview.loading = 'lazy';
        thumb.appendChild(preview);
        strip.appendChild(thumb);
        return thumb;
    });
    function select(value) {
        index = Math.max(0, Math.min(images.length - 1, value));
        img.src = images[index].url;
        img.alt = String(images[index].alt || opts?.alt || `图片 ${index + 1}`);
        error.hidden = true;
        count.textContent = `${index + 1} / ${images.length}`;
        previous.disabled = index === 0;
        next.disabled = index === images.length - 1;
        thumbs.forEach((thumb, i) => {
            thumb.classList.toggle('is-active', i === index);
            thumb.setAttribute('aria-current', i === index ? 'true' : 'false');
        });
        thumbs[index].scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }
    toolbar.append(previous, count, next, closeButton);
    overlay.append(toolbar, strip, img, error);
    select(index);

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
        if (!['Escape', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Escape') close();
        else select(index + (event.key === 'ArrowLeft' ? -1 : 1));
    }
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close();
    });
    overlay.addEventListener('close', close);
    document.addEventListener('keydown', onKey, true);
    const parent = document.body || document.documentElement;
    parent.appendChild(overlay);
    if (typeof overlay.showModal === 'function') {
        overlay.showModal();
    }
    return { destroy: close };
}
