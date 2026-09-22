/**
 * L2 适配器 · IndexedDB 封装 + schema 迁移。
 * 归属：W1-D 存储代理实现。W0 仅冻结签名。
 */

/**
 * @param {object} [opts]
 * @param {string} [opts.dbName='nai-dbgen']
 * @param {number} [opts.version]
 * @returns {Promise<{
 *   get: (store: string, key: string) => Promise<any>,
 *   put: (store: string, value: any, key?: string) => Promise<void>,
 *   delete: (store: string, key: string) => Promise<void>,
 *   getAll: (store: string) => Promise<any[]>,
 *   close: () => void,
 * }>}
 */
export function openIdb(opts) {
    throw new Error('not implemented: openIdb');
}
