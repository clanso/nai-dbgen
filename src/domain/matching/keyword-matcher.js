/**
 * L3 领域层 · 关键字匹配器。
 * 镜像酒馆 matchKeys 语义（宿主能力基线 §6.4）；纯函数，无 IO。
 * 归属：W1-A 领域代理实现。W0 仅冻结签名。
 *
 * 易错点（实现时必须命中）：`\W` 而非 `\b`、多词键绕过全词、
 * 空键前置过滤、正则键覆盖大小写/全词开关。
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
    throw new Error('not implemented: matchKeyword');
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
    throw new Error('not implemented: matchAnyKeyword');
}

/**
 * 解析 `/pattern/flags`；非正则则返回 null。
 * 实现应优先复用宿主导出的 parseRegexFromString（经适配器注入），本纯函数为无宿主时的退化。
 * @param {string} needle
 * @returns {RegExp|null}
 */
export function tryParseRegexKeyword(needle) {
    throw new Error('not implemented: tryParseRegexKeyword');
}
