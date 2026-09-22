/**
 * L2 适配器 · 容错解析 LLM JSON（剥 markdown 围栏、截取首个平衡 JSON 块）。
 * 归属：W1-C 网关代理实现。W0 仅冻结签名。
 */

/**
 * @param {string} text
 * @returns {{ ok: true, value: any } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function extractJson(text) {
    throw new Error('not implemented: extractJson');
}
