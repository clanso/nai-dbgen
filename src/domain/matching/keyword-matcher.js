/**
 * L3 领域层 · 关键字匹配器。
 * 镜像酒馆 matchKeys 语义（宿主能力基线 §6.4）；纯函数，无 IO。
 * 归属：W1-A 领域代理实现。W0 仅冻结签名。
 *
 * 易错点（实现时必须命中）：`\W` 而非 `\b`、多词键绕过全词、
 * 空键前置过滤、正则键覆盖大小写/全词开关。
 *
 * 中文全词：酒馆用 `(?:^|\W)(… )(?:$|\W)`，`\W` = `[^A-Za-z0-9_]`（无 u flag）。
 * CJK 自身属于 `\W`，故「张」在「张三」里会因两侧/`中间`都是非词字符而**仍可命中**——
 * 与 `\b` 不同，这是宿主真实行为（world-info.js matchKeys），本实现原样复刻。
 */

/**
 * 单条关键字是否命中 haystack。
 * @param {string} haystack 扫描文本（通常为当前上下文）
 * @param {string} needle 单条关键字；`/regex/flags` 时按正则
 * @param {{ caseSensitive?: boolean, matchWholeWords?: boolean }|null} entryOverrides 单条覆盖；null 用全局
 * @param {{ caseSensitive: boolean, matchWholeWords: boolean }} globalDefaults 全局默认（镜像 world_info_*）
 * @returns {boolean}
 */
export function matchKeyword(haystack, needle, entryOverrides, globalDefaults) {
    if (typeof haystack !== 'string' || typeof needle !== 'string') {
        return false;
    }
    // 空键 includes('') 恒真 —— 必须前置过滤（基线 §6.4 易错点 3）
    if (needle.length === 0) {
        return false;
    }
    const defaults = globalDefaults ?? { caseSensitive: false, matchWholeWords: false };
    const overrides = entryOverrides && typeof entryOverrides === 'object' ? entryOverrides : null;

    const keyRegex = tryParseRegexKeyword(needle);
    if (keyRegex) {
        return keyRegex.test(haystack);
    }

    const caseSensitive = overrides?.caseSensitive ?? defaults.caseSensitive;
    const matchWholeWords = overrides?.matchWholeWords ?? defaults.matchWholeWords;

    const transformedHaystack = caseSensitive ? haystack : haystack.toLowerCase();
    const transformedNeedle = caseSensitive ? needle : needle.toLowerCase();

    if (matchWholeWords) {
        const keyWords = transformedNeedle.split(/\s+/);
        if (keyWords.length > 1) {
            return transformedHaystack.includes(transformedNeedle);
        }
        // `\W` 而非 `\b`（基线 §6.4）；中文无 ASCII 词边界，行为见文件头注释
        const regex = new RegExp(`(?:^|\\W)(${escapeRegex(transformedNeedle)})(?:$|\\W)`);
        return regex.test(transformedHaystack);
    }

    return transformedHaystack.includes(transformedNeedle);
}

/**
 * 多关键字：命中任一条即 true（需求 4.1）。
 * @param {string} haystack
 * @param {string[]} needles
 * @param {{ caseSensitive?: boolean, matchWholeWords?: boolean }|null} entryOverrides
 * @param {{ caseSensitive: boolean, matchWholeWords: boolean }} globalDefaults
 * @returns {boolean}
 */
export function matchAnyKeyword(haystack, needles, entryOverrides, globalDefaults) {
    if (!Array.isArray(needles) || needles.length === 0) {
        return false;
    }
    for (const needle of needles) {
        if (typeof needle !== 'string' || needle.length === 0) {
            continue;
        }
        if (matchKeyword(haystack, needle, entryOverrides, globalDefaults)) {
            return true;
        }
    }
    return false;
}

/**
 * 解析 `/pattern/flags`；非正则则返回 null。
 * 实现应优先复用宿主导出的 parseRegexFromString（经适配器注入），本纯函数为无宿主时的退化。
 * 语义对齐 ref/SillyTavern/.../world-info.js:2901 parseRegexFromString。
 * @param {string} needle
 * @returns {RegExp|null}
 */
export function tryParseRegexKeyword(needle) {
    if (typeof needle !== 'string') {
        return null;
    }
    const match = needle.match(/^\/([\w\W]+?)\/([gimsuy]*)$/);
    if (!match) {
        return null;
    }
    let [, pattern, flags] = match;
    // 未转义的分隔符 / → 非法
    if (pattern.match(/(^|[^\\])\//)) {
        return null;
    }
    pattern = pattern.replace('\\/', '/');
    try {
        return new RegExp(pattern, flags);
    } catch {
        return null;
    }
}

/**
 * 对齐 utils.js:1377 escapeRegex。
 * @param {string} string
 * @returns {string}
 */
function escapeRegex(string) {
    return string.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}
