/**
 * L3 领域层 · 4.14 NAI 请求装配（纯函数，唯一点）。
 * 操作顺序由需求锁死：替换 → 画师串 → 结构开关 → input/negative → 合并参数。
 * 归属：W1-A 领域代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {import('../model/nai-params.js').NaiCaption} NaiCaption
 * @typedef {import('../model/nai-params.js').NaiParams} NaiParams
 * @typedef {import('../model/nai-params.js').NaiRequest} NaiRequest
 * @typedef {import('../model/artist.js').ArtistString} ArtistString
 * @typedef {import('../model/character.js').Character} Character
 * @typedef {import('../model/character.js').CharacterGroup} CharacterGroup
 * @typedef {import('../matching/activation.js').ActivationGlobals} ActivationGlobals
 */

/**
 * @typedef {object} AssembleInput
 * @property {NaiCaption} caption 调用方原文
 * @property {NaiParams} params 4.13 默认；可被 overrides 覆盖
 * @property {Record<string, unknown>} [paramOverrides] 按次覆盖 + 多传原生字段
 * @property {boolean} replaceCharacterKeywords 必填，无默认
 * @property {ArtistString|null} artist 已由调用方按 ImageGenRequest 三态解析后的画师串；null=不拼
 * @property {CharacterGroup[]} [groups] 替换开关为开时需要
 * @property {Character[]} [characters]
 * @property {ActivationGlobals} [matchGlobals]
 */

/**
 * @param {AssembleInput} input
 * @returns {NaiRequest}
 */
export function assembleNaiPayload(input) {
    throw new Error('not implemented: assembleNaiPayload');
}
