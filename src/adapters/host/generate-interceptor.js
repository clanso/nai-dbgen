/**
 * L2 适配器 · generate_interceptor 出站剥 slot 兜底（manifest NaiDbGen_StripSlots）。
 * 归属：W1-B 宿主代理实现。W0 仅冻结签名。
 */

import { stripSlotTokens } from '../../domain/slot/slot-token.js';

/** manifest.generate_interceptor 全局函数名 */
export const GENERATE_INTERCEPTOR_GLOBAL_NAME = 'NaiDbGen_StripSlots';

/**
 * 挂到 globalThis.NaiDbGen_StripSlots；幂等剥离 coreChat[].mes 中的 slot。
 * @param {object} [deps]
 * @param {() => Array<(mes: string, msgMeta: object) => string>} [deps.getTransforms]
 * @returns {(chat: object[], contextSize: number, abort: Function, type: string) => Promise<void>}
 */
export function createGenerateInterceptor(deps) {
    const getTransforms = typeof deps?.getTransforms === 'function'
        ? deps.getTransforms
        : () => [];

    /**
     * @param {object[]} chat
     * @param {number} _contextSize
     * @param {Function} _abort
     * @param {string} _type
     * @returns {Promise<void>}
     */
    return async function NaiDbGen_StripSlots(chat, _contextSize, _abort, _type) {
        if (!Array.isArray(chat)) {
            return;
        }
        const transforms = getTransforms();
        for (const msg of chat) {
            if (!msg || typeof msg.mes !== 'string') {
                continue;
            }
            let mes = stripSlotTokens(msg.mes);
            if (Array.isArray(transforms)) {
                for (const fn of transforms) {
                    if (typeof fn === 'function') {
                        try {
                            mes = fn(mes, msg);
                        } catch {
                            // 单个变换失败不阻断整条出站链
                        }
                    }
                }
            }
            msg.mes = typeof mes === 'string' ? mes : String(mes ?? '');
        }
    };
}

/**
 * 供 manifest 引用的全局入口名对应的注册函数。
 * @param {(chat: object[], contextSize: number, abort: Function, type: string) => Promise<void>} fn
 * @returns {void}
 */
export function registerGenerateInterceptorGlobal(fn) {
    if (typeof fn !== 'function') {
        throw new Error('invalid argument: fn');
    }
    globalThis[GENERATE_INTERCEPTOR_GLOBAL_NAME] = fn;
}

/**
 * 卸载全局拦截器（幂等）。
 * @returns {void}
 */
export function unregisterGenerateInterceptorGlobal() {
    try {
        if (typeof globalThis[GENERATE_INTERCEPTOR_GLOBAL_NAME] === 'function') {
            delete globalThis[GENERATE_INTERCEPTOR_GLOBAL_NAME];
        }
    } catch {
        // ignore
    }
}
