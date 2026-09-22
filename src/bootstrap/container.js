/**
 * L0 装配 · 唯一 new/工厂调用点：组装 ports 实现并注入用例。
 * 归属：W3-J 装配代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {object} AppContainer
 * @property {import('../ports/host.port.js').HostPort} host
 * @property {import('../ports/image-gen.port.js').ImageGenPort} imageGen
 * @property {import('../ports/llm.port.js').LlmPort} llm
 * @property {object} repos
 * @property {object} services
 * @property {object} useCases
 * @property {ReturnType<import('../infra/event-bus.js').createEventBus>} bus
 * @property {() => void} dispose
 */

/**
 * 创建并装配全部依赖。不得在模块顶层自动执行。
 * @param {object} [opts]
 * @returns {Promise<AppContainer>}
 */
export function createContainer(opts) {
    throw new Error('not implemented: createContainer');
}
