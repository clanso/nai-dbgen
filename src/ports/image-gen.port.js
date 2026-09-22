/**
 * L2 契约 · ImageGenPort —— NAI 生图传输面（架构文档 §4.2）。
 * 无具体实现。归属：W0 冻结；实现归 W1-C `adapters/nai/nai.gateway.js`。
 */

import { Ok, Err } from '../infra/result.js';
import { hostError } from '../infra/errors.js';
import { requireArg } from '../infra/validate.js';

/**
 * @typedef {import('../domain/model/api-config.js').NaiApiConfig} NaiApiConfig
 * @typedef {import('../domain/model/nai-params.js').NaiRequest} NaiRequest
 */

/**
 * @typedef {object} GeneratedImage
 * @property {Blob} blob
 * @property {string} mimeType
 * @property {number} [seed]
 */

/**
 * @typedef {object} TransportProbeResult
 * @property {boolean} ok
 * @property {string} transport 探测到的可用传输名
 * @property {string} decoder 探测到的可用解码名
 * @property {string} [detail] 人话说明
 * @property {import('../infra/errors.js').AppError} [error]
 */

/**
 * @typedef {object} ImageGenPort
 *
 * @property {(req: NaiRequest, opts: { signal?: AbortSignal, config: NaiApiConfig }) => Promise<import('../infra/result.js').Ok<GeneratedImage[]>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} generate
 *   发送已由 domain/nai/payload-assembler 装配完成的完整请求体。
 *   失败：TransportError（CORS/网络）、UpstreamError（401/429/5xx）、ConfigError（缺 Key）。
 *   对应宿主能力基线 §8.1–8.3（不走 ST /api/novelai；直连或 /proxy）。
 *
 * @property {(config: NaiApiConfig) => Promise<TransportProbeResult>} probe
 *   连通性自检：探测传输通道与响应格式。架构文档 §6.7。
 */

/** @type {readonly string[]} */
const REQUIRED_METHODS = Object.freeze(['generate', 'probe']);

/**
 * @param {unknown} impl
 * @returns {{ ok: true, value: ImageGenPort } | { ok: false, error: import('../infra/errors.js').AppError }}
 */
export function assertImageGenPort(impl) {
    requireArg(impl != null, 'impl');
    /** @type {string[]} */
    const missing = [];
    for (const name of REQUIRED_METHODS) {
        if (typeof /** @type {Record<string, unknown>} */ (impl)[name] !== 'function') {
            missing.push(name);
        }
    }
    if (missing.length > 0) {
        return Err(hostError({
            code: 'IMAGE_GEN_PORT_INCOMPLETE',
            message: '生图端口实现不完整',
            hint: '请检查适配器装配',
            context: { missing },
        }));
    }
    return Ok(/** @type {ImageGenPort} */ (impl));
}

export { REQUIRED_METHODS as IMAGE_GEN_PORT_METHODS };
