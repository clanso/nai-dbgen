/**
 * L2 适配器 · extension_settings['nai-dbgen'] 小配置读写（基线 §9，裁决 D8 / D15）。
 * 形状固定为 PluginSettings；键名不得自创。
 * 归属：W1-D 存储代理实现。W0 仅冻结签名。
 *
 * 裁决 D15：deps 只吃 `host`；load/save 一律经 HostPort，禁止直接碰 extension_settings。
 * 本 store 只做 merge / 单键 get/set；schema 不符或校验失败按缺省处理。
 */

import {
    defaultPluginSettings,
    mergePluginSettings,
    normalizePluginSettings,
    validatePluginSettings,
} from '../../domain/model/plugin-settings.js';

/**
 * @typedef {import('../../domain/model/plugin-settings.js').PluginSettings} PluginSettings
 */

/**
 * @param {import('../../ports/repository.port.js').SettingsStoreDeps} deps
 * @returns {import('../../ports/repository.port.js').SettingsStore}
 */
export function createSettingsStore(deps) {
    const host = deps?.host;
    if (!host || typeof host.loadSettings !== 'function' || typeof host.saveSettings !== 'function') {
        throw new Error('createSettingsStore requires deps.host with loadSettings/saveSettings');
    }

    const store = {
        /**
         * @returns {PluginSettings}
         */
        load() {
            try {
                const raw = host.loadSettings();
                if (!raw || typeof raw !== 'object') {
                    return defaultPluginSettings();
                }
                const validated = validatePluginSettings(raw);
                return validated.ok ? validated.value : defaultPluginSettings();
            } catch {
                return defaultPluginSettings();
            }
        },

        /**
         * @param {PluginSettings} settings
         */
        save(settings) {
            const merged = mergePluginSettings(defaultPluginSettings(), settings);
            const validated = validatePluginSettings(merged);
            host.saveSettings(validated.ok ? validated.value : normalizePluginSettings(merged));
        },

        /**
         * @param {string} key
         * @param {any} [fallback]
         * @returns {any}
         */
        get(key, fallback) {
            const current = store.load();
            if (Object.prototype.hasOwnProperty.call(current, key)) {
                return /** @type {any} */ (current)[key];
            }
            if (arguments.length >= 2) {
                return fallback;
            }
            return /** @type {any} */ (defaultPluginSettings())[key];
        },

        /**
         * @param {string} key
         * @param {any} value
         */
        set(key, value) {
            const current = store.load();
            const next = mergePluginSettings(
                current,
                /** @type {Partial<PluginSettings>} */ ({ [key]: value }),
            );
            store.save(next);
        },
    };

    return store;
}
