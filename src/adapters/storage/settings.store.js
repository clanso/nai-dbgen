/**
 * L2 适配器 · extension_settings['nai-dbgen'] 小配置读写（基线 §9，裁决 D8）。
 * 形状固定为 PluginSettings；键名不得自创。
 * 归属：W1-D 存储代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {import('../../domain/model/plugin-settings.js').PluginSettings} PluginSettings
 */

/**
 * @param {object} deps
 * @param {() => any} deps.getContext
 * @returns {{
 *   load: () => PluginSettings,
 *   save: (settings: PluginSettings) => void,
 *   get: <K extends keyof PluginSettings>(key: K, fallback?: PluginSettings[K]) => PluginSettings[K],
 *   set: <K extends keyof PluginSettings>(key: K, value: PluginSettings[K]) => void,
 * }}
 */
export function createSettingsStore(deps) {
    throw new Error('not implemented: createSettingsStore');
}
