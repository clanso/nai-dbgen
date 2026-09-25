/**
 * L2 适配器 · 酒馆用户文件（/api/files + /user/files）。
 * 冻结接口：B 路按此编码，签名不得改。
 *
 * 读 JSON / base64：GET /user/files/<name>（cache: 'no-store' + ?t= 防缓存）
 * 展示图 urlOf：稳定 ?v=<version>（换图后变；同版本地址相同，便于浏览器缓存）
 * 写：POST /api/files/upload { name, data: base64 }
 * 删：POST /api/files/delete { path: '/user/files/<name>' }（不存在也算成功）
 * 验：POST /api/files/verify { urls: ['/user/files/<name>', …] }
 *
 * getRequestHeaders 须由调用方从 SillyTavern.getContext().getRequestHeaders 注入，
 * 本模块不碰全局。
 */

import { Ok, Err } from '../../infra/result.js';
import { hostError, configError } from '../../infra/errors.js';

/** @type {string} */
export const SERVER_FILE_PREFIX = 'nai-dbgen_';

/** @type {RegExp} */
const NAME_RE = /^[A-Za-z0-9_\-.]+$/;

/**
 * @param {unknown} name
 * @returns {boolean}
 */
export function isValidServerFileName(name) {
    if (typeof name !== 'string' || !name) {
        return false;
    }
    return NAME_RE.test(name) && name.startsWith(SERVER_FILE_PREFIX);
}

/**
 * UTF-8 字符串 → base64（支持中文；禁止裸 btoa）。
 * @param {string} text
 * @returns {string}
 */
export function utf8ToBase64(text) {
    const bytes = new TextEncoder().encode(String(text));
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        const slice = bytes.subarray(i, i + chunk);
        binary += String.fromCharCode(...slice);
    }
    return btoa(binary);
}

/**
 * base64 → UTF-8 字符串。
 * @param {string} b64
 * @returns {string}
 */
export function base64ToUtf8(b64) {
    const binary = atob(String(b64));
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
}

/**
 * @param {string} name
 * @returns {string} 酒馆 delete/verify 用的 path（与 upload 返回的 clientRelativePath 一致）
 */
export function serverFilePath(name) {
    return `/user/files/${name}`;
}

/**
 * @param {unknown} name
 * @returns {import('../../infra/errors.js').AppError}
 */
function invalidNameError(name) {
    return configError({
        code: 'SERVER_FILE_NAME_INVALID',
        message: '服务器文件名非法',
        hint: `文件名须以 ${SERVER_FILE_PREFIX} 开头，且仅含字母数字 _ - .`,
        context: { name: String(name ?? '') },
    });
}

/**
 * @param {object} deps
 * @param {typeof fetch} deps.fetch
 * @param {() => Record<string, string>} deps.getRequestHeaders
 * @returns {{
 *   readJson: (name: string) => Promise<import('../../infra/result.js').Ok<any|null>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>,
 *   writeJson: (name: string, value: any) => Promise<import('../../infra/result.js').Ok<void>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>,
 *   writeBase64: (name: string, base64: string) => Promise<import('../../infra/result.js').Ok<void>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>,
 *   readBase64: (name: string) => Promise<import('../../infra/result.js').Ok<string|null>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>,
 *   urlOf: (name: string, version?: string|number|null) => string,
 *   remove: (name: string) => Promise<import('../../infra/result.js').Ok<void>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>,
 *   exists: (names: string[]) => Promise<import('../../infra/result.js').Ok<Record<string, boolean>>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>,
 * }}
 */
export function createServerFiles({ fetch: fetchFn, getRequestHeaders }) {
    if (typeof fetchFn !== 'function') {
        throw new Error('createServerFiles requires fetch');
    }
    if (typeof getRequestHeaders !== 'function') {
        throw new Error('createServerFiles requires getRequestHeaders');
    }

    /** @type {Map<string, Promise<unknown>>} 同名写入串行 */
    const writeChains = new Map();

    /**
     * @template T
     * @param {string} name
     * @param {() => Promise<T>} task
     * @returns {Promise<T>}
     */
    function enqueueWrite(name, task) {
        const prev = writeChains.get(name) || Promise.resolve();
        const next = prev.then(task, task);
        writeChains.set(name, next.then(() => undefined, () => undefined));
        return next;
    }

    /**
     * 图片展示地址。传 version（如画师串 updatedAt）则带稳定 ?v=；不传则无查询串。
     * JSON 读请用 readJson（自带 ?t= + no-store），不要用本函数防缓存。
     * @param {string} name
     * @param {string|number|null|undefined} [version]
     * @returns {string}
     */
    function urlOf(name, version) {
        const path = serverFilePath(name);
        if (version != null && String(version) !== '') {
            return `${path}?v=${encodeURIComponent(String(version))}`;
        }
        return path;
    }

    /**
     * @param {string} name
     * @param {string} base64
     */
    async function uploadBase64(name, base64) {
        let res;
        try {
            res = await fetchFn('/api/files/upload', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({ name, data: base64 }),
            });
        } catch (err) {
            return Err(hostError({
                code: 'SERVER_FILE_UPLOAD_NETWORK',
                message: '上传服务器文件失败（网络）',
                hint: '请检查与酒馆服务器的连接后重试',
                cause: err,
                retryable: true,
                context: { name },
            }));
        }
        if (!res.ok) {
            let detail = '';
            try {
                detail = await res.text();
            } catch {
                // ignore
            }
            return Err(hostError({
                code: 'SERVER_FILE_UPLOAD_FAILED',
                message: `上传服务器文件失败（HTTP ${res.status}）`,
                hint: detail || '请刷新后重试',
                retryable: res.status >= 500,
                context: { name, status: res.status },
            }));
        }
        return Ok(undefined);
    }

    return {
        /**
         * 读 JSON。404 → Ok(null)；其他失败 / JSON 解析失败 → Err（绝不当成空）。
         * @param {string} name
         */
        async readJson(name) {
            if (!isValidServerFileName(name)) {
                return Err(invalidNameError(name));
            }
            const url = `${serverFilePath(name)}?t=${Date.now()}`;
            let res;
            try {
                res = await fetchFn(url, {
                    method: 'GET',
                    cache: 'no-store',
                    headers: getRequestHeaders(),
                });
            } catch (err) {
                return Err(hostError({
                    code: 'SERVER_FILE_READ_NETWORK',
                    message: '读取服务器文件失败（网络）',
                    hint: '请检查与酒馆服务器的连接后重试',
                    cause: err,
                    retryable: true,
                    context: { name },
                }));
            }
            if (res.status === 404) {
                return Ok(null);
            }
            if (!res.ok) {
                return Err(hostError({
                    code: 'SERVER_FILE_READ_FAILED',
                    message: `读取服务器文件失败（HTTP ${res.status}）`,
                    hint: '请勿用空数据覆盖；刷新后重试或从备份恢复',
                    retryable: res.status >= 500,
                    context: { name, status: res.status },
                }));
            }
            let text;
            try {
                text = await res.text();
            } catch (err) {
                return Err(hostError({
                    code: 'SERVER_FILE_READ_BODY',
                    message: '读取服务器文件正文失败',
                    hint: '请刷新后重试',
                    cause: err,
                    retryable: true,
                    context: { name },
                }));
            }
            try {
                return Ok(JSON.parse(text));
            } catch (err) {
                return Err(hostError({
                    code: 'SERVER_FILE_JSON_INVALID',
                    message: '服务器文件不是合法 JSON',
                    hint: '请勿用空数据覆盖；检查该文件或从备份恢复',
                    cause: err,
                    retryable: false,
                    context: { name },
                }));
            }
        },

        /**
         * 整文件覆盖上传 JSON。
         * @param {string} name
         * @param {any} value
         */
        async writeJson(name, value) {
            if (!isValidServerFileName(name)) {
                return Err(invalidNameError(name));
            }
            return enqueueWrite(name, async () => {
                let b64;
                try {
                    b64 = utf8ToBase64(JSON.stringify(value));
                } catch (err) {
                    return Err(hostError({
                        code: 'SERVER_FILE_JSON_ENCODE',
                        message: '序列化 JSON 失败',
                        cause: err,
                        context: { name },
                    }));
                }
                return uploadBase64(name, b64);
            });
        },

        /**
         * 上传二进制（图片等，data 已是 base64）。
         * @param {string} name
         * @param {string} base64
         */
        async writeBase64(name, base64) {
            if (!isValidServerFileName(name)) {
                return Err(invalidNameError(name));
            }
            if (typeof base64 !== 'string') {
                return Err(configError({
                    code: 'SERVER_FILE_BASE64_REQUIRED',
                    message: 'writeBase64 需要 base64 字符串',
                    context: { name },
                }));
            }
            return enqueueWrite(name, () => uploadBase64(name, base64));
        },

        /**
         * 读二进制为 base64（无 data: 前缀）。404 → Ok(null)；其他失败 → Err。
         * @param {string} name
         */
        async readBase64(name) {
            if (!isValidServerFileName(name)) {
                return Err(invalidNameError(name));
            }
            const url = `${serverFilePath(name)}?t=${Date.now()}`;
            let res;
            try {
                res = await fetchFn(url, {
                    method: 'GET',
                    cache: 'no-store',
                    headers: getRequestHeaders(),
                });
            } catch (err) {
                return Err(hostError({
                    code: 'SERVER_FILE_READ_NETWORK',
                    message: '读取服务器文件失败（网络）',
                    hint: '请检查与酒馆服务器的连接后重试',
                    cause: err,
                    retryable: true,
                    context: { name },
                }));
            }
            if (res.status === 404) {
                return Ok(null);
            }
            if (!res.ok) {
                return Err(hostError({
                    code: 'SERVER_FILE_READ_FAILED',
                    message: `读取服务器文件失败（HTTP ${res.status}）`,
                    hint: '请勿用空数据覆盖；刷新后重试或从备份恢复',
                    retryable: res.status >= 500,
                    context: { name, status: res.status },
                }));
            }
            try {
                const buf = await res.arrayBuffer();
                const bytes = new Uint8Array(buf);
                let binary = '';
                const chunk = 0x8000;
                for (let i = 0; i < bytes.length; i += chunk) {
                    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
                }
                return Ok(btoa(binary));
            } catch (err) {
                return Err(hostError({
                    code: 'SERVER_FILE_READ_BODY',
                    message: '读取服务器文件正文失败',
                    hint: '请刷新后重试',
                    cause: err,
                    retryable: true,
                    context: { name },
                }));
            }
        },

        urlOf,

        /**
         * 删除文件；本来不存在（404）也算成功。
         * @param {string} name
         */
        async remove(name) {
            if (!isValidServerFileName(name)) {
                return Err(invalidNameError(name));
            }
            return enqueueWrite(name, async () => {
                let res;
                try {
                    res = await fetchFn('/api/files/delete', {
                        method: 'POST',
                        headers: getRequestHeaders(),
                        body: JSON.stringify({ path: serverFilePath(name) }),
                    });
                } catch (err) {
                    return Err(hostError({
                        code: 'SERVER_FILE_DELETE_NETWORK',
                        message: '删除服务器文件失败（网络）',
                        hint: '请检查连接后重试',
                        cause: err,
                        retryable: true,
                        context: { name },
                    }));
                }
                if (res.status === 404 || res.ok) {
                    return Ok(undefined);
                }
                return Err(hostError({
                    code: 'SERVER_FILE_DELETE_FAILED',
                    message: `删除服务器文件失败（HTTP ${res.status}）`,
                    hint: '请刷新后重试',
                    retryable: res.status >= 500,
                    context: { name, status: res.status },
                }));
            });
        },

        /**
         * 批量存在性检查（酒馆 /api/files/verify）。
         * @param {string[]} names
         */
        async exists(names) {
            if (!Array.isArray(names)) {
                return Err(configError({
                    code: 'SERVER_FILE_EXISTS_ARGS',
                    message: 'exists 需要文件名数组',
                }));
            }
            /** @type {Record<string, boolean>} */
            const out = {};
            /** @type {string[]} */
            const urls = [];
            /** @type {string[]} */
            const validNames = [];
            for (const name of names) {
                if (!isValidServerFileName(name)) {
                    return Err(invalidNameError(name));
                }
                validNames.push(name);
                urls.push(serverFilePath(name));
            }
            if (urls.length === 0) {
                return Ok(out);
            }
            let res;
            try {
                res = await fetchFn('/api/files/verify', {
                    method: 'POST',
                    headers: getRequestHeaders(),
                    body: JSON.stringify({ urls }),
                });
            } catch (err) {
                return Err(hostError({
                    code: 'SERVER_FILE_VERIFY_NETWORK',
                    message: '校验服务器文件失败（网络）',
                    cause: err,
                    retryable: true,
                }));
            }
            if (!res.ok) {
                return Err(hostError({
                    code: 'SERVER_FILE_VERIFY_FAILED',
                    message: `校验服务器文件失败（HTTP ${res.status}）`,
                    retryable: res.status >= 500,
                    context: { status: res.status },
                }));
            }
            /** @type {Record<string, boolean>} */
            let verified = {};
            try {
                verified = await res.json();
            } catch (err) {
                return Err(hostError({
                    code: 'SERVER_FILE_VERIFY_BODY',
                    message: '校验接口返回无法解析',
                    cause: err,
                }));
            }
            for (const name of validNames) {
                const path = serverFilePath(name);
                out[name] = verified[path] === true;
            }
            return Ok(out);
        },
    };
}
