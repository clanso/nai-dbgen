/**
 * L4 应用层 · 世界书当前视角解析（切片 + 副作用隔离）。
 * 归属：W2-F 用例代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {object} WorldInfoResolverDeps
 * @property {import('../ports/host.port.js').HostPort} host
 */

/**
 * @typedef {object} WorldInfoResolveResult
 * @property {string} text worldInfoString
 * @property {'host'|'empty'|'degraded'} source
 */

/**
 * @param {WorldInfoResolverDeps} deps
 * @returns {{ resolve: (messageId: number, contextWindow?: import('../ports/host.port.js').HostMessage[]) => Promise<import('../infra/result.js').Ok<WorldInfoResolveResult>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>> }}
 */
export function createWorldInfoResolver(deps) {
    throw new Error('not implemented: createWorldInfoResolver');
}
