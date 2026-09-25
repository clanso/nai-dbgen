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

    // 酒馆用户文件：同源相对路径 /user/files/<name>（画师示例图等配置图）
    if (raw.startsWith('/user/files/')) {
        const rest = raw.slice('/user/files/'.length);
        const name = rest.split('?')[0].split('#')[0];
        if (/^nai-dbgen_[A-Za-z0-9_\-.]+$/.test(name)) {
            return raw;
        }
        return null;
    }

    /** @type {URL} */
    let parsed;
    try {
        // 协议相对 //host/... 与其它相对路径一律拒绝（导入包不可信）
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
 * 无示例图占位：大卡用「无示例图」文案；小缩略图用居中色块（避免裁掉字母）。
 * @param {'label'|'mark'} [variant='mark']
 * @returns {HTMLElement}
 */
function createCoverEmptyNode(variant = 'mark') {
    if (variant === 'label') {
        const empty = document.createElement('span');
        empty.className = 'nd-style-card__cover-empty';
        empty.textContent = '无示例图';
        return empty;
    }
    const mark = document.createElement('span');
    mark.className = 'nd-cover-empty-mark';
    mark.setAttribute('aria-hidden', 'true');
    return mark;
}

/**
 * 画无图/加载失败占位（与库页「无示例图」同一视觉语言；小尺寸用 mark）。
 * @param {HTMLElement} coverEl
 * @param {{ variant?: 'label'|'mark' }} [opts]
 * @returns {void}
 */
export function paintCoverEmpty(coverEl, opts) {
    const variant = opts?.variant === 'label' ? 'label' : 'mark';
    coverEl.replaceChildren();
    coverEl.classList.add('nd-cover--empty');
    coverEl.appendChild(createCoverEmptyNode(variant));
}

/**
 * 把封面画进容器：安全 URL → <img loading=lazy>；否则占位。
 * 加载失败（404 等）回到同一占位，不留裂图。
 * @param {HTMLElement} coverEl
 * @param {unknown} url
 * @param {string} [label]
 * @param {{ emptyVariant?: 'label'|'mark' }} [opts]
 * @returns {boolean} 是否实际挂上了 <img>
 */
export function paintSafeCover(coverEl, url, label, opts) {
    const emptyVariant = opts?.emptyVariant === 'label' ? 'label' : 'mark';
    coverEl.classList.remove('nd-cover--empty');
    coverEl.replaceChildren();
    const safe = safeImageUrl(url);
    if (safe) {
        const img = document.createElement('img');
        img.src = safe;
        img.alt = label == null ? '' : String(label);
        img.loading = 'eager';
        img.decoding = 'async';
        img.addEventListener('error', () => {
            paintCoverEmpty(coverEl, { variant: emptyVariant });
        });
        coverEl.appendChild(img);
        return true;
    }
    paintCoverEmpty(coverEl, { variant: emptyVariant });
    return false;
}
