/**
 * 测试用内存假 serverFiles（接口对齐 A 路 createServerFiles）。
 */

import { Ok, Err } from '../../infra/result.js';
import { hostError } from '../../infra/errors.js';

const NAME_RE = /^[A-Za-z0-9_\-.]+$/;

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isValidServerFileName(name) {
    return typeof name === 'string'
        && name.startsWith('nai-dbgen_')
        && NAME_RE.test(name);
}

/**
 * @param {object} [opts]
 * @param {Record<string, any>} [opts.seed]
 * @returns {ReturnType<typeof createMemoryServerFiles>}
 */
export function createMemoryServerFiles(opts = {}) {
    /** @type {Map<string, any>} */
    const jsonFiles = new Map();
    /** @type {Map<string, string>} */
    const base64Files = new Map();

    if (opts.seed && typeof opts.seed === 'object') {
        for (const [k, v] of Object.entries(opts.seed)) {
            jsonFiles.set(k, v);
        }
    }

    return {
        async readJson(name) {
            if (!isValidServerFileName(name)) {
                return Err(hostError({
                    code: 'SERVER_FILE_NAME',
                    message: '非法服务器文件名',
                    context: { name },
                }));
            }
            if (!jsonFiles.has(name)) {
                return Ok(null);
            }
            return Ok(structuredClone(jsonFiles.get(name)));
        },

        async writeJson(name, value) {
            if (!isValidServerFileName(name)) {
                return Err(hostError({
                    code: 'SERVER_FILE_NAME',
                    message: '非法服务器文件名',
                    context: { name },
                }));
            }
            jsonFiles.set(name, structuredClone(value));
            return Ok(undefined);
        },

        async writeBase64(name, b64) {
            if (!isValidServerFileName(name)) {
                return Err(hostError({
                    code: 'SERVER_FILE_NAME',
                    message: '非法服务器文件名',
                    context: { name },
                }));
            }
            base64Files.set(name, String(b64 ?? ''));
            return Ok(undefined);
        },

        async readBase64(name) {
            if (!isValidServerFileName(name)) {
                return Err(hostError({
                    code: 'SERVER_FILE_NAME',
                    message: '非法服务器文件名',
                    context: { name },
                }));
            }
            if (!base64Files.has(name)) {
                return Ok(null);
            }
            return Ok(base64Files.get(name) ?? null);
        },

        /**
         * 内存版：有 base64 内容时直接给 data URL，供预览沙箱 img.src（无 /user/files 真服务）。
         * version 仅在无文件回退路径上附加，与真实 urlOf 语义对齐。
         * @param {string} name
         * @param {string|number|null|undefined} [version]
         * @returns {string}
         */
        urlOf(name, version) {
            const key = String(name ?? '');
            if (base64Files.has(key)) {
                const lower = key.toLowerCase();
                const mime = lower.endsWith('.webp')
                    ? 'image/webp'
                    : (lower.endsWith('.jpg') || lower.endsWith('.jpeg')
                        ? 'image/jpeg'
                        : 'image/png');
                return `data:${mime};base64,${base64Files.get(key)}`;
            }
            const path = `/user/files/${key}`;
            if (version != null && String(version) !== '') {
                return `${path}?v=${encodeURIComponent(String(version))}`;
            }
            return path;
        },

        async remove(name) {
            if (!isValidServerFileName(name)) {
                return Err(hostError({
                    code: 'SERVER_FILE_NAME',
                    message: '非法服务器文件名',
                    context: { name },
                }));
            }
            jsonFiles.delete(name);
            base64Files.delete(name);
            return Ok(undefined);
        },

        async exists(names) {
            if (!Array.isArray(names)) {
                return Err(hostError({
                    code: 'SERVER_FILE_EXISTS_ARG',
                    message: 'exists 需要文件名数组',
                }));
            }
            /** @type {Record<string, boolean>} */
            const out = {};
            for (const n of names) {
                const key = String(n);
                out[key] = jsonFiles.has(key) || base64Files.has(key);
            }
            return Ok(out);
        },

        /** @returns {Map<string, any>} */
        _jsonFiles() {
            return jsonFiles;
        },

        /** @returns {Map<string, string>} */
        _base64Files() {
            return base64Files;
        },
    };
}
