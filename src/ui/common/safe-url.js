/**
 * L5 UI · 不可信 URL 门禁（裁决 D24 / D51）。
 *
 * 凡写 img.src（以及将来的 srcset / background-image / href）必须过 safeImageUrl。
 * 只允许 http: / https: / blob: / data:image/(png|jpeg|jpg|webp|gif)；
 * data:image/svg+xml 拒绝（可内嵌脚本；白名单按最危险用途划，见 D51）。
 */

/** @type {RegExp} */
const RASTER_DATA_IMAGE = /^image\/(png|jpe?g|webp|gif)(;|,|$)/i;

/**
 * @param {unknown} url
 * @returns {string|null} 可安全写入 img.src 的字符串；拒绝时 null
 */
export function safeImageUrl(url) {
    if (url == null) {
        return null;
    }
    const raw = String(url).trim();
    if (!raw) {
        return null;
    }

    /** @type {URL} */
    let parsed;
    try {
        // 协议相对 //host/... 与相对路径一律拒绝（导入包不可信）
        if (raw.startsWith('//') || !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)) {
            return null;
        }
        parsed = new URL(raw);
    } catch {
        return null;
    }

    const protocol = String(parsed.protocol || '').toLowerCase();
    if (protocol === 'http:' || protocol === 'https:' || protocol === 'blob:') {
        return raw;
    }
    if (protocol === 'data:') {
        // 用 trim 后原文判定 MIME，避免 URL 解析对 data 体的改写差异
        const afterScheme = raw.slice(raw.indexOf(':') + 1).trim().toLowerCase();
        if (RASTER_DATA_IMAGE.test(afterScheme)) {
            return raw;
        }
        return null;
    }
    return null;
}

/**
 * @param {string} [label]
 * @returns {string}
 */
export function coverInitial(label) {
    const s = String(label || '').trim();
    return s ? s.slice(0, 1).toUpperCase() : '?';
}

/**
 * 把封面画进容器：安全 URL → <img>；否则首字母占位。
 * @param {HTMLElement} coverEl
 * @param {unknown} url
 * @param {string} [label]
 * @returns {boolean} 是否实际挂上了 <img>
 */
export function paintSafeCover(coverEl, url, label) {
    coverEl.replaceChildren();
    const safe = safeImageUrl(url);
    if (safe) {
        const img = document.createElement('img');
        img.src = safe;
        img.alt = label == null ? '' : String(label);
        coverEl.appendChild(img);
        return true;
    }
    coverEl.textContent = coverInitial(label);
    return false;
}

/**
 * 从条目对象取封面字段（仍须再过 safeImageUrl / paintSafeCover）。
 * @param {object|null|undefined} item
 * @returns {unknown}
 */
export function pickCoverField(item) {
    if (!item || typeof item !== 'object') {
        return '';
    }
    const rec = /** @type {Record<string, unknown>} */ (item);
    if (rec.coverImage != null) return rec.coverImage;
    if (rec.coverUrl != null) return rec.coverUrl;
    if (rec.cover != null) return rec.cover;
    return '';
}
