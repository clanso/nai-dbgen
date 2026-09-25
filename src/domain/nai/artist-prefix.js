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
    if (!caption || typeof caption !== 'object') {
        throw new Error('invalid argument: caption');
    }
    const posBase = caption.v4_prompt?.caption?.base_caption ?? '';
    const negBase = caption.v4_negative_prompt?.caption?.base_caption ?? '';
    const posChars = cloneCharCaptions(caption.v4_prompt?.caption?.char_captions);
    const negChars = cloneCharCaptions(caption.v4_negative_prompt?.caption?.char_captions);

    if (!artist) {
        return cloneCaption(String(posBase), posChars, String(negBase), negChars);
    }

    const posArtist = String(artist.positivePrompt ?? '').trim();
    const negArtist = String(artist.negativePrompt ?? '').trim();
    if (!posArtist && !negArtist) {
        return cloneCaption(String(posBase), posChars, String(negBase), negChars);
    }

    return cloneCaption(
        prefixCaptionPart(String(posBase), posArtist),
        posChars,
        prefixCaptionPart(String(negBase), negArtist),
        negChars,
    );
}

/**
 * @param {string} baseCaption
 * @param {string} artistPart
 * @returns {string}
 */
export function prefixCaptionPart(baseCaption, artistPart) {
    const artist = artistPart == null ? '' : String(artistPart).trim();
    if (!artist) {
        return baseCaption == null ? '' : String(baseCaption);
    }
    const base = baseCaption == null ? '' : String(baseCaption);
    if (!base.trim()) {
        return artist;
    }
    return `${artist}, ${base}`;
}

/**
 * @param {string} posBase
 * @param {import('../model/nai-params.js').CharCaption[]} posChars
 * @param {string} negBase
 * @param {import('../model/nai-params.js').CharCaption[]} negChars
 * @returns {NaiCaption}
 */
function cloneCaption(posBase, posChars, negBase, negChars) {
    return {
        v4_prompt: {
            caption: {
                base_caption: posBase,
                char_captions: posChars,
            },
        },
        v4_negative_prompt: {
            caption: {
                base_caption: negBase,
                char_captions: negChars,
            },
        },
    };
}

/**
 * @param {unknown} raw
 * @returns {import('../model/nai-params.js').CharCaption[]}
 */
function cloneCharCaptions(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.map((c) => {
        /** @type {import('../model/nai-params.js').CharCaption} */
        const item = { char_caption: String(c?.char_caption ?? '') };
        if (Array.isArray(c?.centers)) {
            item.centers = c.centers.map((p) => ({
                x: Number(p?.x) || 0,
                y: Number(p?.y) || 0,
            }));
        }
        return item;
    });
}
