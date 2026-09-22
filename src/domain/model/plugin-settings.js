/**
 * L3 领域模型 · 插件全局运行配置（裁决 D8）。
 * 键名一旦冻结即为全项目唯一真相；HostPort.loadSettings/saveSettings 与 settings.store 必须用本类型。
 * 归属：W0 契约冻结。defaultPluginSettings 不得调 Date.now / randomUUID。
 */

import {
    isIntInRange,
    isPlainObject,
    requireArg,
    validationErr,
    validationOk,
} from '../../infra/validate.js';
import {
    defaultNaiParams,
    migrateNaiParams,
    validateNaiParams,
} from './nai-params.js';

/** @type {number} */
export const PLUGIN_SETTINGS_SCHEMA_VERSION = 1;

/**
 * 角色关键字匹配的全局默认（可被单条 Character.matchOverrides 覆盖）。
 * @typedef {object} MatchDefaults
 * @property {boolean} caseSensitive
 *   是否区分大小写。默认 false，镜像酒馆 world_info_case_sensitive（基线 §6.4）。
 * @property {boolean} matchWholeWords
 *   是否全词匹配。默认 false，镜像酒馆 world_info_match_whole_words（基线 §6.4）。
 */

/**
 * 插件运行配置。全部键列于下方；任何代理不得自创键名（裁决 D8）。
 *
 * @typedef {object} PluginSettings
 * @property {number} schemaVersion
 * @property {string|null} activeArtistId
 *   当前激活的画师串 id（需求 4.2）。改选前一直用这一条；null = 尚未选择。
 * @property {string|null} activeNaiConfigId
 *   当前激活的 NAI API 配置 id（需求 4.10）。null = 尚未选择。
 * @property {string|null} recallLlmConfigId
 *   标签召回专用的 LLM 配置 id（需求 4.9）。与提示词生成互不覆盖。
 * @property {string|null} promptGenLlmConfigId
 *   提示词生成专用的 LLM 配置 id（需求 4.9）。与召回互不覆盖。
 * @property {string|null} activeImagegenPresetId
 *   当前生图预设 id（需求 4.4 kind=imagegen）。null = 尚未选择。
 * @property {string|null} activeRecallPresetId
 *   当前召回预设 id（需求 4.11 kind=recall）。null = 尚未选择。
 * @property {number} contextWindowSize
 *   「当前上下文」取最近几条 AI 回复楼（需求 4.6）。默认 5。
 * @property {boolean} autoWriteSlots
 *   自动写 slot：新 AI 楼落定后走步骤 4–5（需求 4.12）。默认 false。
 * @property {boolean} autoRenderSlots
 *   自动出图：slot 写好后对尚未生图编号走出图（需求 4.12）。默认 false。已生图的不自动再出。
 * @property {MatchDefaults} matchDefaults
 *   角色关键字匹配的全局默认。
 * @property {import('./nai-params.js').NaiParams} naiParams
 *   楼层 slot 出图的 4.13 固定参数集。工作台/外部调用可按次覆盖。
 */

/**
 * 返回一份全新的默认配置（纯数据，无副作用）。
 * @returns {PluginSettings}
 */
export function defaultPluginSettings() {
    return {
        schemaVersion: PLUGIN_SETTINGS_SCHEMA_VERSION,
        activeArtistId: null,
        activeNaiConfigId: null,
        recallLlmConfigId: null,
        promptGenLlmConfigId: null,
        activeImagegenPresetId: null,
        activeRecallPresetId: null,
        contextWindowSize: 5,
        autoWriteSlots: false,
        autoRenderSlots: false,
        matchDefaults: {
            caseSensitive: false,
            matchWholeWords: false,
        },
        naiParams: defaultNaiParams(),
    };
}

/**
 * @param {unknown} v
 * @returns {string|null}
 */
function nullOrString(v) {
    if (v == null || v === '') {
        return null;
    }
    return String(v);
}

/**
 * @param {unknown} raw
 * @returns {MatchDefaults}
 */
function normalizeMatchDefaults(raw) {
    if (!isPlainObject(raw)) {
        return {
            caseSensitive: false,
            matchWholeWords: false,
        };
    }
    return {
        caseSensitive: raw.caseSensitive === true,
        matchWholeWords: raw.matchWholeWords === true,
    };
}

/**
 * 归一化任意输入为 PluginSettings 形状（不做严格业务校验）。
 * @param {unknown} obj
 * @returns {PluginSettings}
 */
export function normalizePluginSettings(obj) {
    const base = defaultPluginSettings();
    if (!isPlainObject(obj)) {
        return base;
    }
    const naiRaw = isPlainObject(obj.naiParams) ? obj.naiParams : {};
    const naiResult = validateNaiParams({ ...defaultNaiParams(), ...naiRaw });
    return {
        schemaVersion: Number(obj.schemaVersion) || PLUGIN_SETTINGS_SCHEMA_VERSION,
        activeArtistId: nullOrString(obj.activeArtistId),
        activeNaiConfigId: nullOrString(obj.activeNaiConfigId),
        recallLlmConfigId: nullOrString(obj.recallLlmConfigId),
        promptGenLlmConfigId: nullOrString(obj.promptGenLlmConfigId),
        activeImagegenPresetId: nullOrString(obj.activeImagegenPresetId),
        activeRecallPresetId: nullOrString(obj.activeRecallPresetId),
        contextWindowSize: isIntInRange(obj.contextWindowSize, 1, 100)
            ? Number(obj.contextWindowSize)
            : base.contextWindowSize,
        autoWriteSlots: obj.autoWriteSlots === true,
        autoRenderSlots: obj.autoRenderSlots === true,
        matchDefaults: normalizeMatchDefaults(obj.matchDefaults),
        naiParams: naiResult.ok ? naiResult.value : defaultNaiParams(),
    };
}

/**
 * @param {unknown} obj
 * @returns {{ ok: true, value: PluginSettings } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function validatePluginSettings(obj) {
    if (!isPlainObject(obj)) {
        return validationErr('SETTINGS_SHAPE', '插件配置格式无效');
    }
    if (obj.contextWindowSize != null && !isIntInRange(obj.contextWindowSize, 1, 100)) {
        return validationErr('SETTINGS_CONTEXT_N', '上下文楼数必须是 1–100 的整数');
    }
    if (obj.naiParams != null) {
        const nai = validateNaiParams(obj.naiParams);
        if (!nai.ok) {
            return nai;
        }
    }
    if (obj.matchDefaults != null && !isPlainObject(obj.matchDefaults)) {
        return validationErr('SETTINGS_MATCH', '关键字匹配默认值格式无效');
    }
    return validationOk(normalizePluginSettings(obj));
}

/**
 * @param {object} obj
 * @param {number} fromVersion
 * @returns {{ ok: true, value: PluginSettings } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function migratePluginSettings(obj, fromVersion) {
    requireArg(isPlainObject(obj), 'obj');
    if (fromVersion > PLUGIN_SETTINGS_SCHEMA_VERSION) {
        return validationErr(
            'SETTINGS_MIGRATE',
            `无法从 schema v${fromVersion} 迁移插件配置`,
        );
    }
    /** @type {Record<string, unknown>} */
    const next = { ...obj, schemaVersion: PLUGIN_SETTINGS_SCHEMA_VERSION };
    if (isPlainObject(obj.naiParams)) {
        const migrated = migrateNaiParams(obj.naiParams, Number(obj.naiParams.schemaVersion) || 1);
        if (migrated.ok) {
            next.naiParams = migrated.value;
        }
    }
    // 兼容可能的旧键别名（若早期草稿用过）
    if (next.activeImagePresetId != null && next.activeImagegenPresetId == null) {
        next.activeImagegenPresetId = next.activeImagePresetId;
        delete next.activeImagePresetId;
    }
    if (next.autoGenerateSlots != null && next.autoWriteSlots == null) {
        next.autoWriteSlots = next.autoGenerateSlots === true;
        delete next.autoGenerateSlots;
    }
    return validatePluginSettings(next);
}

/**
 * 深合并 patch 到当前设置（仅认识的键会被写入）。
 * @param {PluginSettings} current
 * @param {Partial<PluginSettings>} patch
 * @returns {PluginSettings}
 */
export function mergePluginSettings(current, patch) {
    requireArg(isPlainObject(current), 'current');
    if (!isPlainObject(patch)) {
        return normalizePluginSettings(current);
    }
    /** @type {Record<string, unknown>} */
    const merged = { ...current, ...patch };
    if (isPlainObject(patch.matchDefaults)) {
        merged.matchDefaults = {
            ...current.matchDefaults,
            ...patch.matchDefaults,
        };
    }
    if (isPlainObject(patch.naiParams)) {
        merged.naiParams = {
            ...current.naiParams,
            ...patch.naiParams,
        };
    }
    return normalizePluginSettings(merged);
}
