/**
 * L2 适配器 · getWorldInfoPrompt 隔离调用 + 作者注释快照/回滚（基线 §6.2）。
 * 归属：W1-B 宿主代理实现。W0 仅冻结签名。
 *
 * 底层签名保持 (scanInput, maxContext, globalScanData)。
 * HostPort.resolveWorldInfo 收到的 HostMessage[] 在 sillytavern.host 内
 * 按酒馆 world_info_include_names 决定是否带发言人名，再转成 scanInput 字符串数组
 * （裁决 D6：该判断属宿主知识，不上浮到 application）。
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
