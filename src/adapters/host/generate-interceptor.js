/**
 * L2 适配器 · generate_interceptor 出站剥 slot 兜底（manifest NaiDbGen_StripSlots）。
 * 归属：W1-B 宿主代理实现。W0 仅冻结签名。
 */

/**
 * 挂到 globalThis.NaiDbGen_StripSlots；幂等剥离 coreChat[].mes 中的 slot。
 * @param {object} [deps]
 * @returns {(chat: object[], contextSize: number, abort: Function, type: string) => Promise<void>}
 */
export function createGenerateInterceptor(deps) {
    throw new Error('not implemented: createGenerateInterceptor');
}

/**
 * 供 manifest 引用的全局入口名对应的注册函数。
 * @param {(chat: object[], contextSize: number, abort: Function, type: string) => Promise<void>} fn
 * @returns {void}
 */
export function registerGenerateInterceptorGlobal(fn) {
    throw new Error('not implemented: registerGenerateInterceptorGlobal');
}
