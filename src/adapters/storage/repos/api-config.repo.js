/**
 * L2 适配器 · LLM API 配置仓库与 NAI API 配置仓库（裁决 D7）。
 * 需求 4.9 / 4.10 是两类互不相干的配置，拆成两个工厂，禁止共用一个再按 kind 过滤。
 * 归属：W1-D 存储代理实现。W0 仅冻结签名。
 */

/**
 * @param {{ db: object, bus?: object }} deps
 * @returns {import('../../../ports/repository.port.js').Repository<import('../../../domain/model/api-config.js').LlmApiConfig>}
 */
export function createLlmConfigRepo(deps) {
    throw new Error('not implemented: createLlmConfigRepo');
}

/**
 * @param {{ db: object, bus?: object }} deps
 * @returns {import('../../../ports/repository.port.js').Repository<import('../../../domain/model/api-config.js').NaiApiConfig>}
 */
export function createNaiConfigRepo(deps) {
    throw new Error('not implemented: createNaiConfigRepo');
}
