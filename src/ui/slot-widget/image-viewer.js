/**
 * L5 UI · slot 图片查看器（宿主 Popup / openModal）。
 * 归属：W2-G。
 *
 * 凡写 img.src 必须过 safeImageUrl（D24）。
 */

import { safeImageUrl } from '../common/safe-url.js';
import { openModal } from '../common/modal.js';
import { t } from '../i18n/zh-CN.js';

/**
 * 构建查看器内容根（带 #nai-dbgen-root，令牌生效）。
 * @param {string} safeUrl 已过白名单
 * @param {string} [alt]
 * @returns {HTMLElement}
 */
export function buildImageViewerElement(safeUrl, alt) {
    const root = document.createElement('div');
    root.id = 'nai-dbgen-root';
    root.className = 'nd-slot-viewer';

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
export async function openSlotImageViewer(deps, opts) {
    const safe = safeImageUrl(opts?.url);
    if (!safe) {
        return null;
    }
    const title = opts?.title != null ? String(opts.title) : t('common.preview');
    const element = buildImageViewerElement(safe, opts?.alt);
    return openModal(
        { host: deps?.host },
        {
            title,
            element,
            wide: true,
            large: true,
            allowVerticalScrolling: true,
        },
    );
}
