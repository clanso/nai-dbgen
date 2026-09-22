/**
 * L2 适配器 · TagLibrary / TagEntry 仓库。
 * 归属：W1-D 存储代理实现。W0 仅冻结签名。
 */

/**
 * @param {{ db: object, bus?: object, messageExtra?: object }} deps
 * @returns {import('../../../ports/repository.port.js').Repository<any>|import('../../../ports/repository.port.js').SlotRepository}
 */
export function createTagRepo(deps) {
    throw new Error('not implemented: createTagRepo');
}
