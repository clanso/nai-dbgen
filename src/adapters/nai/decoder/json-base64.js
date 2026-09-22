/**
 * L2 适配器 · Accept: application/json → base64 图片数组解码。
 * 归属：W1-C 网关代理实现。W0 仅冻结签名。
 */

import { Ok, Err } from '../../../infra/result.js';
import { contractError } from '../../../infra/errors.js';

/**
 * @param {import('../transport/direct.js').TransportResponse} response
 * @returns {Promise<import('../../../infra/result.js').Ok<import('../../../ports/image-gen.port.js').GeneratedImage[]>|import('../../../infra/result.js').Err<import('../../../infra/errors.js').AppError>>}
 */
export async function decodeJsonBase64(response) {
    try {
        const text = await bodyToText(response?.body);
        if (!text || !String(text).trim()) {
            return Err(contractError({
                code: 'NAI_JSON_EMPTY',
                message: 'NovelAI JSON 响应为空',
                hint: '可尝试将解码改为 zip',
            }));
        }

        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (cause) {
            return Err(contractError({
                code: 'NAI_JSON_PARSE',
                message: 'NovelAI JSON 响应无法解析',
                hint: '对端可能返回了 ZIP；请将解码设为 zip 或 auto',
                cause,
                context: { preview: String(text).slice(0, 200) },
            }));
        }

        const items = normalizeImageItems(parsed);
        if (items.length === 0) {
            return Err(contractError({
                code: 'NAI_JSON_NO_IMAGES',
                message: 'JSON 响应中没有图片',
                hint: '期望 { images:[{ image, seed? }] } 或 base64 字符串数组',
                context: { preview: String(text).slice(0, 200) },
            }));
        }

        /** @type {import('../../../ports/image-gen.port.js').GeneratedImage[]} */
        const images = [];
        for (const item of items) {
            const raw = stripDataUrl(item.base64);
            let bytes;
            try {
                bytes = base64ToBytes(raw);
            } catch (cause) {
                return Err(contractError({
                    code: 'NAI_JSON_BASE64',
                    message: '图片 base64 解码失败',
                    cause,
                }));
            }
            const mimeType = sniffMime(bytes) || 'image/png';
            /** @type {import('../../../ports/image-gen.port.js').GeneratedImage} */
            const out = {
                blob: new Blob([bytes], { type: mimeType }),
                mimeType,
            };
            if (item.seed != null && Number.isFinite(Number(item.seed))) {
                out.seed = Number(item.seed);
            }
            images.push(out);
        }
        return Ok(images);
    } catch (cause) {
        return Err(contractError({
            code: 'NAI_JSON_DECODE_FAILED',
            message: 'JSON/base64 解码失败',
            cause,
        }));
    }
}

/**
 * @param {unknown} parsed
 * @returns {Array<{ base64: string, seed?: number }>}
 */
function normalizeImageItems(parsed) {
    /** @type {Array<{ base64: string, seed?: number }>} */
    const items = [];

    if (Array.isArray(parsed)) {
        for (const entry of parsed) {
            if (typeof entry === 'string') {
                items.push({ base64: entry });
            } else if (entry && typeof entry === 'object') {
                const o = /** @type {Record<string, unknown>} */ (entry);
                const b64 = o.image ?? o.base64 ?? o.data;
                if (typeof b64 === 'string') {
                    items.push({
                        base64: b64,
                        seed: typeof o.seed === 'number' ? o.seed : undefined,
                    });
                }
            }
        }
        return items;
    }

    if (parsed && typeof parsed === 'object') {
        const root = /** @type {Record<string, unknown>} */ (parsed);
        const list = root.images ?? root.data ?? root.output;
        if (Array.isArray(list)) {
            return normalizeImageItems(list);
        }
        if (typeof root.image === 'string') {
            items.push({
                base64: root.image,
                seed: typeof root.seed === 'number' ? root.seed : undefined,
            });
        }
    }
    return items;
}

/**
 * @param {string} value
 * @returns {string}
 */
function stripDataUrl(value) {
    const s = String(value);
    const comma = s.indexOf(',');
    if (s.startsWith('data:') && comma >= 0) {
        return s.slice(comma + 1);
    }
    return s;
}

/**
 * @param {string} base64
 * @returns {Uint8Array}
 */
function base64ToBytes(base64) {
    const cleaned = String(base64).replace(/\s+/g, '');
    if (typeof atob === 'function') {
        const bin = atob(cleaned);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) {
            out[i] = bin.charCodeAt(i);
        }
        return out;
    }
    // Node 测试环境
    if (typeof Buffer !== 'undefined') {
        return new Uint8Array(Buffer.from(cleaned, 'base64'));
    }
    throw new Error('no base64 decoder');
}

/**
 * @param {Uint8Array} bytes
 * @returns {string|null}
 */
function sniffMime(bytes) {
    if (bytes.length >= 8
        && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
        return 'image/png';
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image/jpeg';
    }
    if (bytes.length >= 12
        && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
        && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
        return 'image/webp';
    }
    return null;
}

/**
 * @param {ArrayBuffer|Blob|string|Uint8Array|null|undefined} body
 * @returns {Promise<string>}
 */
async function bodyToText(body) {
    if (body == null) {
        return '';
    }
    if (typeof body === 'string') {
        return body;
    }
    if (body instanceof Uint8Array) {
        return new TextDecoder().decode(body);
    }
    if (body instanceof ArrayBuffer) {
        return new TextDecoder().decode(body);
    }
    if (typeof Blob !== 'undefined' && body instanceof Blob) {
        return body.text();
    }
    return '';
}
