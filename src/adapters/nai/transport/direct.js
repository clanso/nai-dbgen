/**
 * L2 适配器 · NAI 浏览器直连传输（基线 §8.3）。
 * 归属：W1-C 网关代理实现。W0 仅冻结签名。
 */

import { Ok, Err } from '../../../infra/result.js';
import { transportError } from '../../../infra/errors.js';

/**
 * @typedef {object} TransportResponse
 * @property {number} status
 * @property {Headers|Record<string,string>} headers
 * @property {ArrayBuffer|Blob|string} body
 */

/**
 * @param {object} [deps]
 * @returns {{
 *   name: string,
 *   send: (url: string, init: RequestInit) => Promise<import('../../../infra/result.js').Ok<TransportResponse>|import('../../../infra/result.js').Err<import('../../../infra/errors.js').AppError>>,
 * }}
 */
export function createDirectTransport(deps = {}) {
    const fetchImpl = deps.fetch ?? globalThis.fetch.bind(globalThis);

    return {
        name: 'direct',

        /**
         * @param {string} url
         * @param {RequestInit} init
         */
        async send(url, init = {}) {
            if (typeof fetchImpl !== 'function') {
                return Err(transportError({
                    code: 'NAI_FETCH_UNAVAILABLE',
                    message: '当前环境无法发起网络请求',
                    hint: '请在酒馆页面内使用本插件',
                    retryable: false,
                }));
            }
            try {
                const response = await fetchImpl(url, {
                    ...init,
                    mode: init.mode ?? 'cors',
                    credentials: init.credentials ?? 'omit',
                });
                const body = await response.arrayBuffer();
                return Ok({
                    status: response.status,
                    headers: response.headers,
                    body,
                });
            } catch (cause) {
                if (isAbortError(cause) || init.signal?.aborted) {
                    return Err(transportError({
                        code: 'NAI_ABORTED',
                        message: '生图请求已取消',
                        hint: null,
                        retryable: false,
                        cause,
                    }));
                }
                // R-01：官方 NAI CORS 未实测；浏览器 Failed to fetch 通常是 CORS/网络，无法在此区分
                return Err(transportError({
                    code: 'NAI_DIRECT_FAILED',
                    message: '浏览器直连 NAI 失败（可能是 CORS 或网络不通）',
                    hint: '若对端无 CORS 头，请改用 st-cors-proxy：在 SillyTavern 的 config.yaml 将 enableCorsProxy 设为 true（或启动参数 --corsProxy），然后把本配置的传输改为「酒馆 CORS 代理」',
                    retryable: true,
                    cause,
                    context: {
                        transport: 'direct',
                        risk: 'R-01',
                    },
                }));
            }
        },
    };
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isAbortError(err) {
    if (err == null || typeof err !== 'object') {
        return false;
    }
    const e = /** @type {{ name?: string, code?: string }} */ (err);
    return e.name === 'AbortError' || e.code === 'ABORT_ERR';
}
