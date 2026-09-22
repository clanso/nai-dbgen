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

/**
 * 返回全部变量登记项（实现时填全别名，如 worldbook / context / character / tags）。
 * @returns {readonly VariableAlias[]}
 */
export function listVariableAliases() {
    throw new Error('not implemented: listVariableAliases');
}

/**
 * 将别名解析为规范中文名；未知返回 null。
 * @param {string} name 不含 {{ }}
 * @returns {string|null}
 */
export function resolveVariableName(name) {
    throw new Error('not implemented: resolveVariableName');
}
