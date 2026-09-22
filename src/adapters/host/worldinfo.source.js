/**
 * L2 适配器 · getWorldInfoPrompt 隔离调用 + 作者注释快照/回滚（基线 §6.2）。
 * 归属：W1-B 宿主代理实现。W0 仅冻结签名。
 */

/**
 * @param {object} deps
 * @param {() => any} deps.getContext
 * @returns {{
 *   resolve: (scanInput: string[], maxContext: number, globalScanData: object) => Promise<import('../../infra/result.js').Ok<string>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>,
 * }}
 */
export function createWorldInfoSource(deps) {
    throw new Error('not implemented: createWorldInfoSource');
}
