/**
 * L3 领域层 · 标签库注入块格式化。
 * 归属：W1-A 领域代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {import('../model/tag.js').TagEntry} TagEntry
 */

/**
 * 将召回命中的条目格式化为「标签库」变量值（写入 value，不写 key）。
 * @param {TagEntry[]} entries
 * @returns {string}
 */
export function formatTagBlock(entries) {
    throw new Error('not implemented: formatTagBlock');
}
