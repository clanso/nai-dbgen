/**
 * L2 适配器 · 画师串卡片图缩放（浏览器 canvas → webp）。
 * application / repo 经注入函数调用，不直接碰 DOM。
 */

import { ARTIST_CARD_IMAGE } from '../../domain/model/artist.js';
import { yieldMain } from '../../infra/yield-main.js';

/**
 * @param {number} width
 * @param {number} height
 * @returns {{ canvas: HTMLCanvasElement|OffscreenCanvas, ctx: CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D }}
 */
function createCanvas(width, height) {
    /** @type {HTMLCanvasElement|OffscreenCanvas} */
    let canvas;
    /** @type {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D|null} */
    let ctx;
    if (typeof OffscreenCanvas !== 'undefined') {
        canvas = new OffscreenCanvas(width, height);
        ctx = canvas.getContext('2d');
    } else if (typeof document !== 'undefined') {
        const el = document.createElement('canvas');
        el.width = width;
        el.height = height;
        canvas = el;
        ctx = el.getContext('2d');
    } else {
        throw new Error('无可用 canvas');
    }
    if (!ctx) {
        throw new Error('无法创建 canvas 上下文');
    }
    return { canvas, ctx };
}

/**
 * @param {HTMLCanvasElement|OffscreenCanvas} canvas
 * @param {number} quality
 * @returns {Promise<Blob>}
 */
async function canvasToWebp(canvas, quality) {
    if (typeof /** @type {OffscreenCanvas} */ (canvas).convertToBlob === 'function') {
        return /** @type {OffscreenCanvas} */ (canvas).convertToBlob({
            type: 'image/webp',
            quality,
        });
    }
    return new Promise((resolve, reject) => {
        /** @type {HTMLCanvasElement} */ (canvas).toBlob(
            (b) => {
                if (b) resolve(b);
                else reject(new Error('toBlob 失败'));
            },
            'image/webp',
            quality,
        );
    });
}

/**
 * 卡片图：宽固定、高按原图比例、webp。
 * 优先 createImageBitmap 内置缩放，避免先解码全尺寸再二次缩放。
 * @param {Blob} blob
 * @param {{ width?: number, quality?: number }} [opts]
 * @returns {Promise<Blob>}
 */
export async function scaleImageToCard(blob, opts = {}) {
    if (typeof Blob === 'undefined' || !(blob instanceof Blob)) {
        throw new Error('scaleImageToCard: blob required');
    }
    const targetWidth = Number(opts.width) > 0 ? Number(opts.width) : ARTIST_CARD_IMAGE.width;
    const quality = typeof opts.quality === 'number' ? opts.quality : ARTIST_CARD_IMAGE.quality;
    const width = Math.round(targetWidth);

    /** @type {ImageBitmap} */
    let bitmap;
    try {
        bitmap = await createImageBitmap(blob, {
            resizeWidth: width,
            resizeQuality: 'high',
        });
    } catch {
        bitmap = await createImageBitmap(blob);
    }
    try {
        const srcW = Math.max(1, bitmap.width);
        const srcH = Math.max(1, bitmap.height);
        const outW = srcW === width ? srcW : width;
        const outH = srcW === width
            ? srcH
            : Math.max(1, Math.round((srcH / srcW) * outW));
        const { canvas, ctx } = createCanvas(outW, outH);
        ctx.drawImage(bitmap, 0, 0, outW, outH);
        return canvasToWebp(canvas, quality);
    } finally {
        if (typeof bitmap.close === 'function') {
            bitmap.close();
        }
    }
}

/**
 * base64 → Uint8Array（无 timer 穿插；大图下 setTimeout 逐片会把导入拖到数分钟～数十分钟）。
 * Node 优先 Buffer（原生解码，约比 atob 快一个数量级）；浏览器走 atob 块拷贝。
 * @param {string} b64
 * @returns {Uint8Array}
 */
function base64ToBytes(b64) {
    if (typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
        const buf = Buffer.from(b64, 'base64');
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    const copyChunk = 0x8000;
    for (let i = 0; i < binary.length; i += copyChunk) {
        const end = Math.min(i + copyChunk, binary.length);
        for (let j = i; j < end; j += 1) {
            bytes[j] = binary.charCodeAt(j);
        }
    }
    return bytes;
}

/**
 * data URL → Blob（导入时从原图生成卡片图）。
 * - Node：优先 Buffer 解码（fetch(data:) 对 MB 级串可慢一个数量级）
 * - 浏览器：优先 fetch(data:)；失败则一次 atob 拷贝
 * 禁止在逐字节循环里 await setTimeout——内存压力下 timer 被饿死，
 * 单张 ~2MB 图可耗时数百秒，94 条合计可达数分钟～十分钟级。
 * @param {string} dataUrl
 * @returns {Promise<Blob>}
 */
export async function dataUrlToBlob(dataUrl) {
    const raw = String(dataUrl ?? '');
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(raw);
    if (!m) {
        throw new Error('dataUrlToBlob: 非法 data URL');
    }
    const mime = m[1];
    const isNode = typeof process !== 'undefined'
        && process.versions
        && typeof process.versions.node === 'string';

    // Node 原生 Buffer 远快于 fetch(data:)；浏览器无此分支
    if (isNode && typeof Buffer !== 'undefined' && typeof Buffer.from === 'function') {
        const bytes = base64ToBytes(m[2]);
        return new Blob([bytes], { type: mime });
    }

    if (typeof fetch === 'function') {
        try {
            const res = await fetch(raw);
            if (res && typeof res.blob === 'function') {
                const blob = await res.blob();
                if (blob && typeof blob.size === 'number' && blob.size > 0) {
                    return blob.type ? blob : new Blob([blob], { type: mime });
                }
            }
        } catch {
            // 无 data: 支持时回退
        }
    }

    const bytes = base64ToBytes(m[2]);
    // 浏览器重同步工作后让出一次，便于进度文案绘制；不要按字节/按 32KB 反复让出
    if (typeof document !== 'undefined') {
        await yieldMain();
    }
    return new Blob([bytes], { type: mime });
}
