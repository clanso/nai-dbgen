/**
 * L5 UI · 订阅式 store（架构 §8.7）。
 * 归属：W1-E 组件代理实现。W0 仅冻结签名。
 */

/**
 * @template T
 * @param {T} initial
 * @returns {{
 *   get: () => T,
 *   set: (next: T|((prev: T) => T)) => void,
 *   subscribe: (fn: (state: T) => void) => () => void,
 * }}
 */
export function createStore(initial) {
    throw new Error('not implemented: createStore');
}
