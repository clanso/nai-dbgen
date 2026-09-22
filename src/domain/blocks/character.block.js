/**
 * L3 领域层 · 角色库注入块格式化（需求 4.1 缩进格式唯一定义点）。
 * 归属：W1-A 领域代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {import('../model/character.js').Character} Character
 */

/**
 * 将命中角色格式化为「角色库」变量文本。
 * 固定/非固定必须标明；无非固定条目时不输出空的「非固定特征」段。
 * @param {Character[]} characters
 * @returns {string}
 */
export function formatCharacterBlock(characters) {
    throw new Error('not implemented: formatCharacterBlock');
}
