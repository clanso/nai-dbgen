/**
 * L4 应用层 · 世界书当前视角解析（切片 + 副作用隔离）。
 * 归属：W2-F 用例代理实现。W0 仅冻结签名。
 *
 * 裁决 D6：必须把 ContextCollector 产出的同一窗口交给 HostPort.resolveWorldInfo；
 * 不得只传楼号让宿主自建扫描窗。是否带发言人名由宿主适配器读取
 * world_info_include_names，本层不传该开关。
 */

import { Ok } from '../infra/result.js';
import { createLogger } from '../infra/logger.js';
import { formatWorldInfoBlock } from '../domain/blocks/worldinfo.block.js';

const log = createLogger('application/worldinfo-resolver');

/**
 * @typedef {object} WorldInfoResolverDeps
 * @property {import('../ports/host.port.js').HostPort} host
 */

/**
 * @typedef {object} WorldInfoResolveInput
 * @property {import('../ports/host.port.js').HostMessage[]} contextWindow
 *   与角色匹配、标签召回共用的同一窗口（已剥 slot）
 * @property {number} [messageId] 仅日志 / trace，不参与扫描窗构造
 */

/**
 * @typedef {object} WorldInfoResolveResult
 * @property {string} text worldInfoString
 * @property {'host'|'empty'|'degraded'} source
 */

/**
 * @param {WorldInfoResolverDeps} deps
 * @returns {{ resolve: (input: WorldInfoResolveInput) => Promise<import('../infra/result.js').Ok<WorldInfoResolveResult>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>> }}
 */
export function createWorldInfoResolver(deps) {
    return {
        /**
         * @param {WorldInfoResolveInput} input
         */
        async resolve(input) {
            const window = Array.isArray(input?.contextWindow) ? input.contextWindow : [];
            const hostResult = await deps.host.resolveWorldInfo({
                contextWindow: window,
                messageId: input?.messageId,
            });
            if (!hostResult.ok) {
                // 降级为空：四块同源原则下世界书失败不应拖死整条链路
                log.warn('resolveWorldInfo failed; degrading to empty', {
                    messageId: input?.messageId,
                    code: hostResult.error?.code,
                });
                return Ok({ text: '', source: 'degraded' });
            }
            const text = formatWorldInfoBlock(hostResult.value ?? '');
            return Ok({
                text,
                source: text ? 'host' : 'empty',
            });
        },
    };
}
