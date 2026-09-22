/**
 * L2 适配器 · 桥接宿主宏 substituteParams；并注册 {{naislot::n}} 等插件宏。
 * 归属：W1-B 宿主代理实现。W0 仅冻结签名。
 */

/**
 * @param {object} deps
 * @param {() => any} deps.getContext
 * @param {(slotId: number) => string} [deps.renderSlotMacroHtml] 同步返回骨架/状态 HTML
 * @returns {{
 *   runHostMacros: (template: string) => string,
 *   registerMacros: () => void,
 *   unregisterMacros: () => void,
 * }}
 */
export function createStMacroBridge(deps) {
    throw new Error('not implemented: createStMacroBridge');
}
