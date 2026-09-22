/**
 * L2 适配器 · 写入/校验/补装两条酒馆正则（基线 §4）。
 * 归属：W1-B 宿主代理实现。W0 仅冻结签名。
 */

import { Ok, Err } from '../../infra/result.js';
import { hostError, configError } from '../../infra/errors.js';
import {
    SLOT_TOKEN_PATTERN_SOURCE,
    slotWidgetReplaceTemplate,
} from '../../domain/slot/slot-token.js';

/** @type {string} */
export const REGEX_SCRIPT_NAME_WIDGET = 'nai-dbgen:slot-to-widget';
/** @type {string} */
export const REGEX_SCRIPT_NAME_STRIP = 'nai-dbgen:slot-strip';
/** @type {string} */
export const REGEX_SCRIPT_ID_WIDGET = 'nai-dbgen-0001-slot-to-widget';
/** @type {string} */
export const REGEX_SCRIPT_ID_STRIP = 'nai-dbgen-0002-slot-strip';

/** ST regex_placement.AI_OUTPUT（engine.js:287） */
export const REGEX_PLACEMENT_AI_OUTPUT = 2;

/**
 * 把 pattern source 编成酒馆 findRegex 字面量（`/…/flags`）。
 * 必须转义源串中的 `/`，否则 `</IMG>` 会截断 regexFromString 的分隔符解析
 * （utils.js regexFromString）。
 * @param {string} source
 * @param {string} [flags='gi']
 * @returns {string}
 */
export function toFindRegexLiteral(source, flags = 'gi') {
    const escaped = String(source).replace(/\//g, '\\/');
    return `/${escaped}/${flags}`;
}

/**
 * 期望的两条正则脚本（与 assets/regex/*.json、domain/slot/slot-token 同源）。
 * @returns {{ widget: object, strip: object }}
 */
export function buildExpectedRegexScripts() {
    const findRegex = toFindRegexLiteral(SLOT_TOKEN_PATTERN_SOURCE, 'gi');
    return {
        widget: {
            id: REGEX_SCRIPT_ID_WIDGET,
            scriptName: REGEX_SCRIPT_NAME_WIDGET,
            findRegex,
            replaceString: slotWidgetReplaceTemplate(),
            trimStrings: [],
            placement: [REGEX_PLACEMENT_AI_OUTPUT],
            disabled: false,
            markdownOnly: true,
            promptOnly: false,
            runOnEdit: true,
            substituteRegex: 0,
            minDepth: null,
            maxDepth: null,
        },
        strip: {
            id: REGEX_SCRIPT_ID_STRIP,
            scriptName: REGEX_SCRIPT_NAME_STRIP,
            findRegex,
            replaceString: '',
            trimStrings: [],
            placement: [REGEX_PLACEMENT_AI_OUTPUT],
            disabled: false,
            markdownOnly: false,
            promptOnly: true,
            runOnEdit: false,
            substituteRegex: 0,
            minDepth: null,
            maxDepth: null,
        },
    };
}

/**
 * 判断已安装脚本是否与期望一致（忽略用户不可见差异外的关键字段）。
 * @param {object|null|undefined} actual
 * @param {object} expected
 * @returns {boolean}
 */
export function regexScriptMatchesExpected(actual, expected) {
    if (!actual || typeof actual !== 'object') {
        return false;
    }
    if (actual.disabled === true) {
        return false;
    }
    if (String(actual.findRegex) !== String(expected.findRegex)) {
        return false;
    }
    if (String(actual.replaceString) !== String(expected.replaceString)) {
        return false;
    }
    if (!!actual.markdownOnly !== !!expected.markdownOnly) {
        return false;
    }
    if (!!actual.promptOnly !== !!expected.promptOnly) {
        return false;
    }
    const placement = Array.isArray(actual.placement) ? actual.placement.map(Number) : [];
    const need = Array.isArray(expected.placement) ? expected.placement.map(Number) : [];
    if (!need.every((p) => placement.includes(p))) {
        return false;
    }
    return true;
}

/**
 * 在脚本列表中按稳定 id 或 scriptName 查找本插件脚本。
 * @param {object[]} scripts
 * @param {object} expected
 * @returns {number} 下标；未找到 -1
 */
export function findOwnedRegexScriptIndex(scripts, expected) {
    if (!Array.isArray(scripts)) {
        return -1;
    }
    const byId = scripts.findIndex((s) => s && s.id === expected.id);
    if (byId >= 0) {
        return byId;
    }
    return scripts.findIndex((s) => s && s.scriptName === expected.scriptName);
}

/**
 * 幂等合并：有则就地修补，无则追加。不产生重复条目。
 * @param {object[]} scripts 可变的 extension_settings.regex
 * @param {object} expected
 * @returns {'inserted'|'updated'|'unchanged'}
 */
export function upsertOwnedRegexScript(scripts, expected) {
    const idx = findOwnedRegexScriptIndex(scripts, expected);
    if (idx < 0) {
        scripts.push({ ...expected });
        return 'inserted';
    }
    const current = scripts[idx];
    if (regexScriptMatchesExpected(current, expected) && current.id === expected.id
        && current.scriptName === expected.scriptName) {
        return 'unchanged';
    }
    scripts[idx] = {
        ...current,
        ...expected,
        id: expected.id,
        scriptName: expected.scriptName,
    };
    return 'updated';
}

/**
 * @param {any} ctx
 * @returns {boolean}
 */
function isRegexExtensionDisabled(ctx) {
    const disabled = ctx?.extensionSettings?.disabledExtensions;
    return Array.isArray(disabled) && disabled.includes('regex');
}

/**
 * @param {any} ctx
 * @returns {object[]}
 */
function getGlobalRegexArray(ctx) {
    const settings = ctx?.extensionSettings;
    if (!settings) {
        return [];
    }
    if (!Array.isArray(settings.regex)) {
        settings.regex = [];
    }
    return settings.regex;
}

/**
 * @param {object} deps
 * @param {() => any} deps.getContext
 * @returns {{
 *   ensureInstalled: () => Promise<import('../../infra/result.js').Ok<void>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>,
 *   verify: () => { ok: boolean, missing: string[] },
 * }}
 */
export function createRegexScriptInstaller(deps) {
    const getContext = deps?.getContext;
    if (typeof getContext !== 'function') {
        throw new Error('invalid argument: deps.getContext');
    }

    const expected = buildExpectedRegexScripts();

    /**
     * @returns {{ ok: boolean, missing: string[] }}
     */
    function verify() {
        /** @type {string[]} */
        const missing = [];
        try {
            const ctx = getContext();
            if (!ctx || !ctx.extensionSettings) {
                return { ok: false, missing: ['extensionSettings', REGEX_SCRIPT_NAME_WIDGET, REGEX_SCRIPT_NAME_STRIP] };
            }
            if (isRegexExtensionDisabled(ctx)) {
                return { ok: false, missing: ['regex-extension', REGEX_SCRIPT_NAME_WIDGET, REGEX_SCRIPT_NAME_STRIP] };
            }
            const scripts = getGlobalRegexArray(ctx);
            const widgetIdx = findOwnedRegexScriptIndex(scripts, expected.widget);
            const stripIdx = findOwnedRegexScriptIndex(scripts, expected.strip);
            if (widgetIdx < 0 || !regexScriptMatchesExpected(scripts[widgetIdx], expected.widget)) {
                missing.push(REGEX_SCRIPT_NAME_WIDGET);
            }
            if (stripIdx < 0 || !regexScriptMatchesExpected(scripts[stripIdx], expected.strip)) {
                missing.push(REGEX_SCRIPT_NAME_STRIP);
            }
            return { ok: missing.length === 0, missing };
        } catch (cause) {
            return {
                ok: false,
                missing: ['verify-failed', REGEX_SCRIPT_NAME_WIDGET, REGEX_SCRIPT_NAME_STRIP],
            };
        }
    }

    /**
     * @returns {Promise<import('../../infra/result.js').Ok<void>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>}
     */
    async function ensureInstalled() {
        try {
            const ctx = getContext();
            if (!ctx || !ctx.extensionSettings) {
                return Err(hostError({
                    code: 'REGEX_MISSING',
                    message: '无法访问酒馆扩展设置，正则脚本未能安装',
                    hint: '请确认插件在酒馆扩展环境中运行',
                }));
            }
            if (isRegexExtensionDisabled(ctx)) {
                return Err(configError({
                    code: 'REGEX_EXTENSION_DISABLED',
                    message: '酒馆正则扩展已被禁用，无法安装 slot 脚本',
                    hint: '请在扩展列表中启用 Regex，或改用面板内出图',
                }));
            }

            const scripts = getGlobalRegexArray(ctx);
            upsertOwnedRegexScript(scripts, expected.widget);
            upsertOwnedRegexScript(scripts, expected.strip);

            if (typeof ctx.saveSettingsDebounced === 'function') {
                ctx.saveSettingsDebounced();
            }

            const after = verify();
            if (!after.ok) {
                return Err(hostError({
                    code: 'REGEX_MISSING',
                    message: '正则脚本校验失败，部分脚本缺失或被改坏',
                    hint: '请勿禁用/删改名为 nai-dbgen: 开头的正则脚本',
                    context: { missing: after.missing },
                }));
            }

            // 脚本已就位，但 encode_tags 会把骨架变成可见文本 → 上层告警并降级
            if (ctx.powerUserSettings?.encode_tags === true) {
                return Err(configError({
                    code: 'ENCODE_TAGS_ENABLED',
                    message: '已开启 encode_tags，正则吐出的 HTML 会变成可见文本',
                    hint: '请关闭 Power User → encode_tags，或降级为面板内出图',
                    context: { encode_tags: true },
                }));
            }
            return Ok(undefined);
        } catch (cause) {
            return Err(hostError({
                code: 'REGEX_MISSING',
                message: '安装正则脚本时发生异常',
                hint: '请检查正则扩展是否可用',
                cause,
            }));
        }
    }

    return { ensureInstalled, verify };
}
