/**
 * L2 适配器 · extension_settings['nai-dbgen'] 小配置读写（基线 §9）。
 * 归属：W1-D 存储代理实现。W0 仅冻结签名。
 */

/**
 * @param {object} deps
 * @param {() => any} deps.getContext
 * @returns {{
 *   load: () => object,
 *   save: (patch: object) => void,
 *   get: (key: string, fallback?: any) => any,
 *   set: (key: string, value: any) => void,
 * }}
 */
export function createSettingsStore(deps) {
    throw new Error('not implemented: createSettingsStore');
}
