/**
 * L3 领域层 · 世界书注入块格式化。
 * 归属：W1-A 领域代理实现。W0 仅冻结签名。
 */

/**
 * 将 resolveWorldInfo 得到的文本格式化为「世界书」变量值。
 * 本版直接返回原文（可 trim）；保留函数以便日后加包装。
 * @param {string} worldInfoString worldInfoBefore+worldInfoAfter，中间无分隔符
 * @returns {string}
 */
export function formatWorldInfoBlock(worldInfoString) {
    if (worldInfoString == null) {
        return '';
    }
    return String(worldInfoString).trim();
}
