/**
 * L1 · ID 生成。供 application/adapters 注入给 domain 工厂；domain 自身不得调用。
 */

/**
 * 生成带可选前缀的唯一 id。优先 crypto.randomUUID，不可用时退化。
 * @param {string} [prefix]
 * @returns {string}
 */
export function newId(prefix) {
    const uuid = safeRandomUuid();
    if (prefix) {
        return `${prefix}_${uuid}`;
    }
    return uuid;
}

/**
 * @returns {string}
 */
function safeRandomUuid() {
    try {
        if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
            return globalThis.crypto.randomUUID();
        }
    } catch {
        // fall through
    }
    return fallbackId();
}

/**
 * 非加密退化：时间戳 + 随机段，仅保证进程内唯一性够用。
 * @returns {string}
 */
function fallbackId() {
    const t = Date.now().toString(36);
    const r = Math.random().toString(36).slice(2, 10);
    return `${t}-${r}`;
}
