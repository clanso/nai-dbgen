/**
 * L1 · 进程内发布订阅。供 L4→L5 通知（架构文档 §8.7）。
 * 不碰 document，不用 CustomEvent。
 */

import { createLogger } from './logger.js';

const log = createLogger('infra/event-bus');

/**
 * @typedef {(...args: any[]) => void} EventHandler
 */

/**
 * @returns {{
 *   on: (type: string, fn: EventHandler) => () => void,
 *   once: (type: string, fn: EventHandler) => () => void,
 *   off: (type: string, fn: EventHandler) => void,
 *   emit: (type: string, payload?: unknown) => void,
 *   clear: () => void,
 * }}
 */
export function createEventBus() {
    /** @type {Map<string, Set<EventHandler>>} */
    const listeners = new Map();

    /**
     * @param {string} type
     * @returns {Set<EventHandler>}
     */
    function bucket(type) {
        let set = listeners.get(type);
        if (!set) {
            set = new Set();
            listeners.set(type, set);
        }
        return set;
    }

    /**
     * @param {string} type
     * @param {EventHandler} fn
     * @returns {() => void}
     */
    function on(type, fn) {
        bucket(type).add(fn);
        return () => off(type, fn);
    }

    /**
     * @param {string} type
     * @param {EventHandler} fn
     * @returns {() => void}
     */
    function once(type, fn) {
        /** @type {EventHandler} */
        const wrapper = (payload) => {
            off(type, wrapper);
            fn(payload);
        };
        return on(type, wrapper);
    }

    /**
     * @param {string} type
     * @param {EventHandler} fn
     */
    function off(type, fn) {
        const set = listeners.get(type);
        if (!set) {
            return;
        }
        set.delete(fn);
        if (set.size === 0) {
            listeners.delete(type);
        }
    }

    /**
     * @param {string} type
     * @param {unknown} [payload]
     */
    function emit(type, payload) {
        const set = listeners.get(type);
        if (!set || set.size === 0) {
            return;
        }
        // 复制快照，避免订阅者在回调里 off/on 影响本轮遍历
        const snapshot = [...set];
        for (const fn of snapshot) {
            try {
                fn(payload);
            } catch (err) {
                log.error('subscriber threw', type, err);
            }
        }
    }

    function clear() {
        listeners.clear();
    }

    return { on, once, off, emit, clear };
}
