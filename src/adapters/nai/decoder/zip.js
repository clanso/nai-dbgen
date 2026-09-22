/**
 * L2 适配器 · ZIP/deflate-raw 手工解码（浏览器原生 DecompressionStream，无第三方库）。
 * 归属：W1-C 网关代理实现。W0 仅冻结签名。
 *
 * 支持范围（对齐桌面 app/backend.js `extractZipEntries` / Gd）：
 * - method 0 stored：直接切片
 * - method 8 deflate：`DecompressionStream('deflate-raw')`
 * - 裸 PNG（无 ZIP 封装）：视为单张图
 * 其它压缩方式 → ContractError，不静默产出垃圾数据。
 */

import { Ok, Err } from '../../../infra/result.js';
import { contractError } from '../../../infra/errors.js';

const ZIP_EOCD = 0x06054b50;
const ZIP_CENTRAL = 0x02014b50;
const ZIP_LOCAL = 0x04034b50;
const PNG_MAGIC = 0x89504e47;

/**
 * @param {import('../transport/direct.js').TransportResponse} response
 * @returns {Promise<import('../../../infra/result.js').Ok<import('../../../ports/image-gen.port.js').GeneratedImage[]>|import('../../../infra/result.js').Err<import('../../../infra/errors.js').AppError>>}
 */
export async function decodeZip(response) {
    try {
        const bytes = await toUint8Array(response?.body);
        if (!bytes || bytes.length < 4) {
            return Err(contractError({
                code: 'NAI_ZIP_EMPTY',
                message: 'NovelAI 返回了空响应',
                hint: '请重试；若持续失败请检查中转是否正常',
            }));
        }

        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

        // 桌面 Gd：裸 PNG 直接当单图
        if (view.getUint32(0, false) === PNG_MAGIC) {
            return Ok([{
                blob: new Blob([bytes], { type: 'image/png' }),
                mimeType: 'image/png',
            }]);
        }

        const entries = await readZipEntries(bytes, view);
        const images = [];
        for (const entry of entries) {
            const mime = mimeFromName(entry.name);
            if (!mime) {
                continue;
            }
            images.push({
                blob: new Blob([entry.data], { type: mime }),
                mimeType: mime,
            });
        }
        if (images.length === 0) {
            return Err(contractError({
                code: 'NAI_ZIP_NO_IMAGES',
                message: '无法从 NovelAI 响应中提取图片',
                hint: 'ZIP 内未找到 png/webp/jpeg 文件',
                context: { entryNames: entries.map((e) => e.name) },
            }));
        }
        return Ok(images);
    } catch (cause) {
        if (cause && typeof cause === 'object' && /** @type {{ isAppError?: boolean }} */ (cause).name === 'AppError') {
            return Err(/** @type {import('../../../infra/errors.js').AppError} */ (cause));
        }
        // 我们在 readZipEntries 里直接 throw AppError-like via contractError objects
        if (cause && typeof cause === 'object' && 'category' in /** @type {object} */ (cause) && 'code' in /** @type {object} */ (cause)) {
            return Err(/** @type {import('../../../infra/errors.js').AppError} */ (cause));
        }
        return Err(contractError({
            code: 'NAI_ZIP_DECODE_FAILED',
            message: 'ZIP 解码失败',
            hint: '请确认对端返回的是 NovelAI 标准 ZIP，或改用 Accept: application/json',
            cause,
        }));
    }
}

/**
 * @param {Uint8Array} bytes
 * @param {DataView} view
 * @returns {Promise<Array<{ name: string, data: Uint8Array }>>}
 */
async function readZipEntries(bytes, view) {
    let eocd = -1;
    for (let index = bytes.length - 22; index >= Math.max(0, bytes.length - 65557); index -= 1) {
        if (view.getUint32(index, true) === ZIP_EOCD) {
            eocd = index;
            break;
        }
    }
    if (eocd < 0) {
        throw contractError({
            code: 'NAI_ZIP_NO_EOCD',
            message: 'NovelAI 返回的 ZIP 缺少中央目录',
            hint: '响应可能不是 ZIP；可尝试将解码设为 json',
        });
    }

    const count = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    /** @type {Array<{ name: string, data: Uint8Array }>} */
    const files = [];

    for (let index = 0; index < count; index += 1) {
        if (offset + 46 > bytes.length || view.getUint32(offset, true) !== ZIP_CENTRAL) {
            throw contractError({
                code: 'NAI_ZIP_CENTRAL_CORRUPT',
                message: 'NovelAI ZIP 中央目录损坏',
            });
        }
        const method = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localOffset = view.getUint32(offset + 42, true);
        const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

        if (view.getUint32(localOffset, true) !== ZIP_LOCAL) {
            throw contractError({
                code: 'NAI_ZIP_LOCAL_CORRUPT',
                message: 'NovelAI ZIP 本地文件头损坏',
                context: { name },
            });
        }
        const localNameLength = view.getUint16(localOffset + 26, true);
        const localExtraLength = view.getUint16(localOffset + 28, true);
        const dataStart = localOffset + 30 + localNameLength + localExtraLength;
        const dataEnd = dataStart + compressedSize;
        if (dataEnd > bytes.length) {
            throw contractError({
                code: 'NAI_ZIP_INCOMPLETE',
                message: 'NovelAI ZIP 响应不完整',
                context: { name },
            });
        }
        const compressed = bytes.subarray(dataStart, dataEnd);
        const content = await inflateEntry(compressed, method, name);
        files.push({ name: name.replace(/\\/g, '/'), data: content });
        offset += 46 + nameLength + extraLength + commentLength;
    }
    return files;
}

/**
 * @param {Uint8Array} compressed
 * @param {number} method
 * @param {string} name
 * @returns {Promise<Uint8Array>}
 */
async function inflateEntry(compressed, method, name) {
    if (method === 0) {
        return compressed;
    }
    if (method === 8) {
        if (typeof DecompressionStream !== 'function') {
            throw contractError({
                code: 'NAI_ZIP_DEFLATE_UNSUPPORTED',
                message: '当前环境不支持 deflate ZIP',
                hint: '请改用 Accept: application/json，或升级到支持 DecompressionStream 的浏览器',
                context: { name, method },
            });
        }
        try {
            const stream = new Blob([compressed]).stream().pipeThrough(
                new DecompressionStream('deflate-raw'),
            );
            return new Uint8Array(await new Response(stream).arrayBuffer());
        } catch (cause) {
            throw contractError({
                code: 'NAI_ZIP_DEFLATE_FAILED',
                message: 'ZIP deflate 解压失败',
                hint: '请改用 Accept: application/json',
                cause,
                context: { name, method },
            });
        }
    }
    throw contractError({
        code: 'NAI_ZIP_METHOD_UNSUPPORTED',
        message: `ZIP 使用了暂不支持的压缩方式：${method}`,
        hint: '仅支持 stored(0) 与 deflate(8)；请改用 Accept: application/json',
        context: { name, method },
    });
}

/**
 * @param {string} name
 * @returns {string|null}
 */
function mimeFromName(name) {
    const lower = String(name).toLowerCase();
    if (lower.endsWith('.png')) {
        return 'image/png';
    }
    if (lower.endsWith('.webp')) {
        return 'image/webp';
    }
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) {
        return 'image/jpeg';
    }
    return null;
}

/**
 * @param {ArrayBuffer|Blob|string|Uint8Array|null|undefined} body
 * @returns {Promise<Uint8Array>}
 */
async function toUint8Array(body) {
    if (body == null) {
        return new Uint8Array(0);
    }
    // Node Buffer 是 Uint8Array 子类，但可能共享池化 ArrayBuffer；统一拷成独立视图
    if (typeof Buffer !== 'undefined' && Buffer.isBuffer(body)) {
        return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    }
    if (body instanceof Uint8Array) {
        if (body.byteOffset === 0 && body.byteLength === body.buffer.byteLength) {
            return body;
        }
        return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    }
    if (body instanceof ArrayBuffer) {
        return new Uint8Array(body);
    }
    if (typeof Blob !== 'undefined' && body instanceof Blob) {
        return new Uint8Array(await body.arrayBuffer());
    }
    if (typeof body === 'string') {
        return new TextEncoder().encode(body);
    }
    return new Uint8Array(0);
}
