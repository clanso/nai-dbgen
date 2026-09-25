/**
 * L3 领域层 · 预设变量名（仅中文主名）。
 * 七个注入块（需求 4.4）+ 单图「用户描述」（需求 4.16）。
 * 不认 ASCII / 旧名别名；未知 `{{…}}` 由渲染层保留原文。
 */

/** 需求 4.4 / 4.16 钦定的中文主名 */
export const VARIABLE_NAMES = Object.freeze({
    WORLDINFO: '世界书',
    CONTEXT: '当前上下文',
    CHARACTER: '角色库',
    COMPOSITION: '构图标签',
    FEATURE: '特征参考',
    CONSTANT: '常驻标签',
    RECENT_SLOTS: '近期生图记录',
    USER_DESC: '用户描述',
});

/** @type {readonly string[]} */
const REGISTERED = Object.freeze([
    VARIABLE_NAMES.WORLDINFO,
    VARIABLE_NAMES.CONTEXT,
    VARIABLE_NAMES.CHARACTER,
    VARIABLE_NAMES.COMPOSITION,
    VARIABLE_NAMES.FEATURE,
    VARIABLE_NAMES.CONSTANT,
    VARIABLE_NAMES.RECENT_SLOTS,
    VARIABLE_NAMES.USER_DESC,
]);

/**
 * 返回全部已登记变量名（中文主名）。
 * @returns {readonly string[]}
 */
export function listRegisteredVariables() {
    return REGISTERED;
}

/**
 * 将名称解析为规范中文名；未知返回 null。
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
    return REGISTERED.includes(trimmed) ? trimmed : null;
}
