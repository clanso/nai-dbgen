/**
 * L3 领域层 · 画师串前置拼接（需求 4.14 步骤 3）。
 * 必须在关键字替换之后调用——画师串里的字不得参与关键字匹配。
 * 归属：W1-A 领域代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {import('../model/artist.js').ArtistString} ArtistString
 * @typedef {import('../model/nai-params.js').NaiCaption} NaiCaption
 */

/**
 * 正向/负向各接到对应 base_caption 最前面，", " 连接；原文空则等于画师串本身。
 * char_caption 与 centers 不动。artist 为空/双空串时原文不动。
 * @param {NaiCaption} caption
 * @param {ArtistString|null} artist
 * @returns {NaiCaption}
 */
export function prefixArtist(caption, artist) {
    throw new Error('not implemented: prefixArtist');
}

/**
 * @param {string} baseCaption
 * @param {string} artistPart
 * @returns {string}
 */
export function prefixCaptionPart(baseCaption, artistPart) {
    throw new Error('not implemented: prefixCaptionPart');
}
