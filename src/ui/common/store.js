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
    /** @type {T} */
    let state = initial;
    /** @type {Set<(state: T) => void>} */
    const listeners = new Set();

    return {
        get() {
            return state;
        },
        set(next) {
            const value = typeof next === 'function'
                ? /** @type {(prev: T) => T} */ (next)(state)
                : next;
            if (Object.is(value, state)) {
                return;
            }
            state = value;
            for (const fn of [...listeners]) {
                try {
                    fn(state);
                } catch {
                    // 订阅者异常不得拖垮 store
                }
            }
        },
        subscribe(fn) {
            if (typeof fn !== 'function') {
                return () => {};
            }
            listeners.add(fn);
            let active = true;
            return () => {
                if (!active) {
                    return;
                }
                active = false;
                listeners.delete(fn);
            };
        },
    };
}
