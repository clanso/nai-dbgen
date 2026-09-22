/**
 * L2 契约 · LlmPort —— 大模型调用面（架构文档 §4.3）。
 * 无具体实现。归属：W0 冻结；实现归 W1-C `adapters/llm/llm.gateway.js`。
 */

import { Ok, Err } from '../infra/result.js';
import { hostError } from '../infra/errors.js';
import { requireArg } from '../infra/validate.js';

/**
 * @typedef {import('../domain/model/api-config.js').LlmApiConfig} LlmApiConfig
 */

/**
 * @typedef {object} ChatMessage
 * @property {'system'|'user'|'assistant'} role
 * @property {string} content
 */

/**
 * @typedef {object} LlmCompleteRequest
 * @property {ChatMessage[]} messages
 * @property {LlmApiConfig} config
 * @property {object} [jsonSchema] 结构化输出 schema；中转不支持时由适配器容错解析
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {object} LlmCompleteResult
 * @property {string} text 原始文本
 * @property {any} [json] 若成功解析出 JSON
 */

/**
 * @typedef {import('./image-gen.port.js').TransportProbeResult} TransportProbeResult
 */

/**
 * @typedef {object} LlmPort
 *
 * @property {(req: LlmCompleteRequest) => Promise<import('../infra/result.js').Ok<LlmCompleteResult>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} complete
 *   一次补全调用。失败：TransportError、UpstreamError、ContractError（JSON 不符）、ConfigError。
 *   对应宿主能力基线 §8.4（默认 st-backend：ChatCompletionService + reverse_proxy）。
 *
 * @property {(config: LlmApiConfig) => Promise<TransportProbeResult>} probe
 */

/** @type {readonly string[]} */
const REQUIRED_METHODS = Object.freeze(['complete', 'probe']);

/**
 * @param {unknown} impl
 * @returns {{ ok: true, value: LlmPort } | { ok: false, error: import('../infra/errors.js').AppError }}
 */
export function assertLlmPort(impl) {
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
            code: 'LLM_PORT_INCOMPLETE',
            message: 'LLM 端口实现不完整',
            hint: '请检查适配器装配',
            context: { missing },
        }));
    }
    return Ok(/** @type {LlmPort} */ (impl));
}

export { REQUIRED_METHODS as LLM_PORT_METHODS };
