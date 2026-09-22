/**
 * L1 · 时钟。供 application/adapters 注入时间戳；domain 自身不得调用 Date.now()。
 * 架构目录树 §3 未单列本文件，由 W0 契约补充（开发协作规范：domain 纯净要求）。
 */

/**
 * @returns {number} 当前 epoch 毫秒
 */
export function now() {
    return Date.now();
}

/**
 * @returns {string} ISO-8601 时间戳
 */
export function nowIso() {
    return new Date(now()).toISOString();
}
