/**
 * L2 适配器 · 写入/校验/补装两条酒馆正则（基线 §4）。
 * 归属：W1-B 宿主代理实现。W0 仅冻结签名。
 */

/**
 * @param {object} deps
 * @param {() => any} deps.getContext
 * @returns {{
 *   ensureInstalled: () => Promise<import('../../infra/result.js').Ok<void>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>,
 *   verify: () => { ok: boolean, missing: string[] },
 * }}
 */
export function createRegexScriptInstaller(deps) {
    throw new Error('not implemented: createRegexScriptInstaller');
}
