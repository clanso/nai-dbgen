/**
 * L3 领域层 · 特征参考注入块格式化（需求 4.3 / 4.4）。
 */

/**
 * @typedef {import('../model/tag.js').TagEntry} TagEntry
 */

/**
 * 将关键字命中的特征条目格式化为「特征参考」变量值（key: value）。
 * @param {TagEntry[]} entries
 * @returns {string}
 */
export function formatFeatureBlock(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
        return '';
    }
    /** @type {string[]} */
    const lines = [];
    for (const entry of entries) {
        if (!entry) {
            continue;
        }
        const key = String(entry.key ?? '');
        const value = String(entry.value ?? '');
        if (!key && !value) {
            continue;
        }
        lines.push(`${key}: ${value}`);
    }
    return lines.join('\n');
}
