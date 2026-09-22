/**
 * L2 适配器 · HostPort 的 SillyTavern 实现（版本敏感代码唯一容身处）。
 * 归属：W1-B 宿主代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {object} SillyTavernHostDeps
 * @property {() => any} getContext 通常 () => SillyTavern.getContext()
 * @property {ReturnType<import('../../infra/event-bus.js').createEventBus>} [bus]
 */

/**
 * @param {SillyTavernHostDeps} deps
 * @returns {import('../../ports/host.port.js').HostPort}
 */
export function createSillyTavernHost(deps) {
    throw new Error('not implemented: createSillyTavernHost');
}
