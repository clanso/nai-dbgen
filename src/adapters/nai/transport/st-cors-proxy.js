/**
 * L2 适配器 · 经 ST /proxy/:url 转发（基线 §8.2，需 enableCorsProxy）。
 * 归属：W1-C 网关代理实现。W0 仅冻结签名。
 */

import { Ok, Err } from '../../../infra/result.js';
import { transportError } from '../../../infra/errors.js';

/** 代理关闭时 ST 返回的固定文案（server-main.js:261） */
const PROXY_DISABLED_SNIPPET = 'CORS proxy is disabled';

/**
 * @param {object} [deps]
 * @returns {{
 *   name: string,
 *   send: (url: string, init: RequestInit) => Promise<import('../../../infra/result.js').Ok<import('./direct.js').TransportResponse>|import('../../../infra/result.js').Err<import('../../../infra/errors.js').AppError>>,
 * }}
 */
export function createStCorsProxyTransport(deps = {}) {
    const fetchImpl = deps.fetch ?? globalThis.fetch.bind(globalThis);
    const proxyPrefix = deps.proxyPrefix ?? '/proxy/';

    return {
        name: 'st-cors-proxy',

        /**
         * 不打上游，只确认 `/proxy` 中间件是否启用。
         * @returns {Promise<import('../../../infra/result.js').Ok<true>|import('../../../infra/result.js').Err<import('../../../infra/errors.js').AppError>>}
         */
        async probeEnabled() {
            if (typeof fetchImpl !== 'function') {
                return Err(corsProxyUnavailableError(null));
            }
            // 用不存在的主机：代理开启时会 500/网络错误；关闭时固定 404 + 提示文案
            const probeUrl = `${proxyPrefix}https://nai-dbgen-cors-probe.invalid/`;
            try {
                const response = await fetchImpl(probeUrl, {
                    method: 'GET',
                    credentials: 'same-origin',
                    cache: 'no-store',
                });
                const text = await response.text();
                if (response.status === 404 && text.includes(PROXY_DISABLED_SNIPPET)) {
                    return Err(corsProxyDisabledError());
                }
                return Ok(true);
            } catch (cause) {
                // same-origin 请求本身失败极少见；视为代理通道不可用
                return Err(corsProxyUnavailableError(cause));
            }
        },

        /**
         * @param {string} url
         * @param {RequestInit} init
         */
        async send(url, init = {}) {
            if (typeof fetchImpl !== 'function') {
                return Err(corsProxyUnavailableError(null));
            }
            const target = toProxyUrl(proxyPrefix, url);
            try {
                const response = await fetchImpl(target, {
                    ...init,
                    // 走同源 /proxy，保留 ST 会话 cookie；Authorization 由中间件原样转发
                    credentials: init.credentials ?? 'same-origin',
                    mode: init.mode ?? 'same-origin',
                });
                const body = await response.arrayBuffer();

                if (response.status === 404) {
                    const text = new TextDecoder().decode(body.slice(0, 500));
                    if (text.includes(PROXY_DISABLED_SNIPPET)) {
                        return Err(corsProxyDisabledError());
                    }
                }

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
                return Err(transportError({
                    code: 'NAI_PROXY_FAILED',
                    message: '经酒馆 /proxy 转发失败',
                    hint: '请确认 SillyTavern 已开启 enableCorsProxy，且本机可访问目标地址',
                    retryable: true,
                    cause,
                    context: { transport: 'st-cors-proxy' },
                }));
            }
        },
    };
}

/**
 * @param {string} prefix
 * @param {string} url
 * @returns {string}
 */
function toProxyUrl(prefix, url) {
    const base = prefix.endsWith('/') ? prefix : `${prefix}/`;
    // ST 路由 `/proxy/:url(*)` 直接吃完整绝对 URL；勿再 encode 整段（会破坏 :url(*)）
    return `${base}${url}`;
}

/**
 * @returns {import('../../../infra/errors.js').AppError}
 */
function corsProxyDisabledError() {
    return transportError({
        code: 'NAI_CORS_PROXY_DISABLED',
        message: '酒馆 CORS 代理未开启',
        hint: '请编辑 SillyTavern 安装目录下的 config.yaml，将 enableCorsProxy 设为 true 后重启；或用启动参数 --corsProxy。默认配置见 default/config.yaml 的 enableCorsProxy（默认 false）',
        retryable: false,
        context: {
            transport: 'st-cors-proxy',
            configKey: 'enableCorsProxy',
            risk: 'R-02',
        },
    });
}

/**
 * @param {unknown} cause
 * @returns {import('../../../infra/errors.js').AppError}
 */
function corsProxyUnavailableError(cause) {
    return transportError({
        code: 'NAI_CORS_PROXY_UNAVAILABLE',
        message: '无法探测酒馆 CORS 代理',
        hint: '请确认在酒馆页面内运行，且 config.yaml 中 enableCorsProxy: true',
        retryable: true,
        cause,
        context: { transport: 'st-cors-proxy' },
    });
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
