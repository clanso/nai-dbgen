/**
 * L0 装配 · 唯一 new/工厂调用点：组装 ports 实现并注入用例。
 * 归属：W3-J 装配代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {object} AppRepos
 * @property {import('../ports/repository.port.js').CharacterRepository} character
 * @property {import('../ports/repository.port.js').TagRepository} tag
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/artist.js').ArtistString>} artist
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/preset.js').Preset>} preset
 * @property {import('../ports/repository.port.js').SlotRepository} slot
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/api-config.js').LlmApiConfig>} llmConfig
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/api-config.js').NaiApiConfig>} naiConfig
 * @property {import('../ports/repository.port.js').ImageRepository} image
 */

/**
 * @typedef {object} AppContainer
 * @property {import('../ports/host.port.js').HostPort} host
 * @property {import('../ports/image-gen.port.js').ImageGenPort} imageGen
 * @property {import('../ports/llm.port.js').LlmPort} llm
 * @property {AppRepos} repos
 * @property {object} services
 * @property {object} useCases
 * @property {ReturnType<import('../infra/event-bus.js').createEventBus>} bus
 * @property {() => void} dispose
 */

/**
 * 创建并装配全部依赖。不得在模块顶层自动执行。
 * 须分别调用 createLlmConfigRepo 与 createNaiConfigRepo（裁决 D7），禁止单一 api-config 仓库。
 * @param {object} [opts]
 * @returns {Promise<AppContainer>}
 */
export function createContainer(opts) {
    throw new Error('not implemented: createContainer');
}
