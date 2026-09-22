/**
 * L3 领域层 · 预设变量名映射（中文主名 + ASCII 别名）。
 * 归属：W1-A 领域代理实现。W0 仅冻结签名。
 */

/** 需求 4.4 钦定的四个中文主名 */
export const VARIABLE_NAMES = Object.freeze({
    WORLDINFO: '世界书',
    CONTEXT: '当前上下文',
    CHARACTER: '角色库',
    TAG: '标签库',
});

/**
 * @typedef {object} VariableAlias
 * @property {string} canonical 中文主名
 * @property {string[]} aliases ASCII 等别名（不含花括号）
 */

/** @type {readonly VariableAlias[]} */
const ALIASES = Object.freeze([
    Object.freeze({
        canonical: VARIABLE_NAMES.WORLDINFO,
        aliases: Object.freeze(['worldbook', 'world_info', 'worldinfo']),
    }),
    Object.freeze({
        canonical: VARIABLE_NAMES.CONTEXT,
        aliases: Object.freeze(['context', 'current_context']),
    }),
    Object.freeze({
        canonical: VARIABLE_NAMES.CHARACTER,
        aliases: Object.freeze(['character', 'characters', 'character_library']),
    }),
    Object.freeze({
        canonical: VARIABLE_NAMES.TAG,
        aliases: Object.freeze(['tags', 'tag', 'tag_library']),
    }),
]);

/** @type {Map<string, string>|null} */
let resolveCache = null;

/**
 * @returns {Map<string, string>}
 */
function buildResolveMap() {
    /** @type {Map<string, string>} */
    const map = new Map();
    for (const item of ALIASES) {
        map.set(item.canonical, item.canonical);
        for (const alias of item.aliases) {
            map.set(alias, item.canonical);
            map.set(alias.toLowerCase(), item.canonical);
        }
    }
    return map;
}

/**
 * 返回全部变量登记项（实现时填全别名，如 worldbook / context / character / tags）。
 * @returns {readonly VariableAlias[]}
 */
export function listVariableAliases() {
    return ALIASES;
}

/**
 * 将别名解析为规范中文名；未知返回 null。
 * @param {string} name 不含 {{ }}
 * @returns {string|null}
 */
export function resolveVariableName(name) {
    if (typeof name !== 'string') {
        return null;
    }
    const trimmed = name.trim();
    if (!trimmed) {
        return null;
    }
    if (!resolveCache) {
        resolveCache = buildResolveMap();
    }
    if (resolveCache.has(trimmed)) {
        return /** @type {string} */ (resolveCache.get(trimmed));
    }
    const lower = trimmed.toLowerCase();
    if (resolveCache.has(lower)) {
        return /** @type {string} */ (resolveCache.get(lower));
    }
    return null;
}
