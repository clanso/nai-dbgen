/**
 * L2 适配器 · extension_settings['nai-dbgen'] 小配置读写（基线 §9，裁决 D8）。
 * 形状固定为 PluginSettings；键名不得自创。
 * 归属：W1-D 存储代理实现。W0 仅冻结签名。
 *
 * 注：冻结 deps 为 getContext（与 HostPort.loadSettings/saveSettings 同源字段）。
 * Host 适配器当前自行实现了一份；本 store 供装配层复用，键名严格走 D8 表。
 */

import {
    PLUGIN_SETTINGS_SCHEMA_VERSION,
    defaultPluginSettings,
    mergePluginSettings,
    migratePluginSettings,
    normalizePluginSettings,
    validatePluginSettings,
} from '../../domain/model/plugin-settings.js';

/**
 * @typedef {import('../../domain/model/plugin-settings.js').PluginSettings} PluginSettings
 */

/** 与 Host 适配器 PLUGIN_NS 一致 */
export const SETTINGS_NS = 'nai-dbgen';

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
    const getContext = deps?.getContext;
    if (typeof getContext !== 'function') {
        throw new Error('createSettingsStore requires deps.getContext');
    }

    /**
     * @returns {Record<string, unknown>|null}
     */
    function extensionBucket() {
        try {
            const ctx = getContext();
            const settings = ctx?.extensionSettings;
            if (!settings || typeof settings !== 'object') {
                return null;
            }
            return settings;
        } catch {
            return null;
        }
    }

    /**
     * @returns {void}
     */
    function debounceSave() {
        try {
            const ctx = getContext();
            if (typeof ctx?.saveSettingsDebounced === 'function') {
                ctx.saveSettingsDebounced();
            }
        } catch {
            // ignore
        }
    }

    const store = {
        /**
         * @returns {PluginSettings}
         */
        load() {
            try {
                const bucket = extensionBucket();
                const raw = bucket?.[SETTINGS_NS];
                if (!raw || typeof raw !== 'object') {
                    return defaultPluginSettings();
                }
                const fromVersion = Number(raw.schemaVersion) || PLUGIN_SETTINGS_SCHEMA_VERSION;
                if (fromVersion !== PLUGIN_SETTINGS_SCHEMA_VERSION) {
                    const migrated = migratePluginSettings(raw, fromVersion);
                    if (migrated.ok) {
                        return migrated.value;
                    }
                }
                const validated = validatePluginSettings(raw);
                return validated.ok ? validated.value : normalizePluginSettings(raw);
            } catch {
                return defaultPluginSettings();
            }
        },

        /**
         * @param {PluginSettings} settings
         */
        save(settings) {
            const bucket = extensionBucket();
            if (!bucket) {
                return;
            }
            // mergePluginSettings 丢弃未知键
            const merged = mergePluginSettings(defaultPluginSettings(), settings);
            const validated = validatePluginSettings(merged);
            bucket[SETTINGS_NS] = validated.ok ? validated.value : normalizePluginSettings(merged);
            debounceSave();
        },

        /**
         * @template {keyof PluginSettings} K
         * @param {K} key
         * @param {PluginSettings[K]} [fallback]
         * @returns {PluginSettings[K]}
         */
        get(key, fallback) {
            const current = store.load();
            if (Object.prototype.hasOwnProperty.call(current, key)) {
                return current[key];
            }
            if (arguments.length >= 2) {
                return /** @type {PluginSettings[K]} */ (fallback);
            }
            return defaultPluginSettings()[key];
        },

        /**
         * @template {keyof PluginSettings} K
         * @param {K} key
         * @param {PluginSettings[K]} value
         */
        set(key, value) {
            const current = store.load();
            const next = mergePluginSettings(current, /** @type {Partial<PluginSettings>} */ ({ [key]: value }));
            store.save(next);
        },
    };

    return store;
}
