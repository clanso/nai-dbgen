/**
 * L3 领域层 · 角色关键字原位替换成固定特征（需求 4.14 步骤 2）。
 * 非固定特征不参与；固定特征内再现关键字不做第二遍。
 * 归属：W1-A 领域代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {import('../model/character.js').Character} Character
 * @typedef {import('../model/character.js').CharacterGroup} CharacterGroup
 * @typedef {import('../matching/activation.js').ActivationGlobals} ActivationGlobals
 * @typedef {import('../model/nai-params.js').NaiCaption} NaiCaption
 */

/**
 * 在 caption 正负面文本中做关键字→固定特征替换。
 * @param {NaiCaption} caption
 * @param {CharacterGroup[]} groups 仅已激活组内角色参与
 * @param {Character[]} characters
 * @param {ActivationGlobals} globals
 * @returns {NaiCaption} 新对象，不改入参
 */
export function substituteCharacterKeywords(caption, groups, characters, globals) {
    throw new Error('not implemented: substituteCharacterKeywords');
}

/**
 * 对单段文本做一次原位替换。
 * @param {string} text
 * @param {Character[]} activeCharacters 已按组过滤
 * @param {ActivationGlobals} globals
 * @returns {string}
 */
export function substituteKeywordsInText(text, activeCharacters, globals) {
    throw new Error('not implemented: substituteKeywordsInText');
}
