/**
 * L3 领域层 · 角色激活：先组过滤 → 再关键字命中。
 * 归属：W1-A 领域代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {import('../model/character.js').Character} Character
 * @typedef {import('../model/character.js').CharacterGroup} CharacterGroup
 */

/**
 * @typedef {object} ActivationGlobals
 * @property {boolean} caseSensitive
 * @property {boolean} matchWholeWords
 */

/**
 * 从已激活组中筛出关键字命中的角色（顺序：组 order → 角色录入序由调用方保证）。
 * @param {CharacterGroup[]} groups
 * @param {Character[]} characters
 * @param {string} contextText 当前上下文（已剥 slot）
 * @param {ActivationGlobals} globals
 * @returns {Character[]} 命中集；未激活组内角色绝不出现
 */
export function activateCharacters(groups, characters, contextText, globals) {
    throw new Error('not implemented: activateCharacters');
}
