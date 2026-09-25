/**
 * L5 UI · 分类提示词纯文本的 format / parse（提示词页复制 ↔ 工作台粘贴）。
 * 往返必须一致。
 */

import { Ok, Err } from '../../infra/result.js';
import { domainError } from '../../infra/errors.js';
import { emptyNaiCaption } from '../../domain/model/nai-params.js';

/** 解析时角色数默认上限（与工作台一致）；调用方可覆盖。 */
export const PROMPT_TEXT_DEFAULT_MAX_CHARACTERS = 4;

/**
 * @param {unknown} artist
 * @returns {{ pos: string, neg: string }}
 */
function artistPromptPair(artist) {
    if (!artist || typeof artist !== 'object') {
        return { pos: '', neg: '' };
    }
    const rec = /** @type {Record<string, unknown>} */ (artist);
    // 库实体用 positivePrompt；粘贴 DTO 用 positive
    const pos = String(rec.positivePrompt ?? rec.positive ?? '').trim();
    const neg = String(rec.negativePrompt ?? rec.negative ?? '').trim();
    return { pos, neg };
}

/**
 * @param {unknown} artist
 * @returns {boolean}
 */
export function isUsableArtist(artist) {
    const { pos, neg } = artistPromptPair(artist);
    return Boolean(pos || neg);
}

/**
 * @param {string|null|undefined} text
 * @returns {boolean}
 */
function hasText(text) {
    return typeof text === 'string' && text.trim().length > 0;
}

/**
 * @param {number} n
 * @returns {string}
 */
function formatCoord(n) {
    return Number(n).toFixed(2);
}

/**
 * @param {Array<{x?: number, y?: number}>|null|undefined} centers
 * @returns {{ x: number, y: number }|null}
 */
function firstValidCenter(centers) {
    if (!Array.isArray(centers) || centers.length === 0) return null;
    const c = centers[0];
    if (!c || typeof c !== 'object') return null;
    const x = Number(c.x);
    const y = Number(c.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
}

/**
 * @param {string} label
 * @param {string} value
 * @returns {string|null}
 */
function kvLine(label, value) {
    if (!hasText(value)) return null;
    return `${label}：${value}`;
}

/**
 * @param {{ positivePrompt?: string, negativePrompt?: string, positive?: string, negative?: string }} artist
 * @returns {string|null}
 */
function formatArtistBlock(artist) {
    /** @type {string[]} */
    const lines = ['画师串'];
    const { pos, neg } = artistPromptPair(artist);
    const posLine = kvLine('正面', pos);
    const negLine = kvLine('负面', neg);
    if (posLine) lines.push(posLine);
    if (negLine) lines.push(negLine);
    if (lines.length === 1) return null;
    return lines.join('\n');
}

/**
 * @param {import('../../domain/model/nai-params.js').NaiCaption|null|undefined} caption
 * @returns {string|null}
 */
function formatSceneBlock(caption) {
    const posCap = caption?.v4_prompt?.caption;
    const negCap = caption?.v4_negative_prompt?.caption;
    const scenePos = posCap && typeof posCap.base_caption === 'string' ? posCap.base_caption : '';
    const sceneNeg = negCap && typeof negCap.base_caption === 'string' ? negCap.base_caption : '';
    /** @type {string[]} */
    const lines = ['场景'];
    const pos = kvLine('正面', scenePos);
    const neg = kvLine('负面', sceneNeg);
    if (pos) lines.push(pos);
    if (neg) lines.push(neg);
    if (lines.length === 1) return null;
    return lines.join('\n');
}

/**
 * @param {import('../../domain/model/nai-params.js').NaiCaption|null|undefined} caption
 * @returns {string[]}
 */
function formatCharacterBlocks(caption) {
    const posCap = caption?.v4_prompt?.caption;
    const negCap = caption?.v4_negative_prompt?.caption;
    const posChars = Array.isArray(posCap?.char_captions) ? posCap.char_captions : [];
    const negChars = Array.isArray(negCap?.char_captions) ? negCap.char_captions : [];
    const count = Math.max(posChars.length, negChars.length);
    /** @type {string[]} */
    const blocks = [];
    for (let i = 0; i < count; i += 1) {
        const pc = posChars[i];
        const nc = negChars[i];
        const charPos = pc && typeof pc.char_caption === 'string' ? pc.char_caption : '';
        const charNeg = nc && typeof nc.char_caption === 'string' ? nc.char_caption : '';
        const center = firstValidCenter(
            (pc && Array.isArray(pc.centers) ? pc.centers : null)
            || (nc && Array.isArray(nc.centers) ? nc.centers : null),
        );
        /** @type {string[]} */
        const lines = [`角色${i + 1}`];
        const pos = kvLine('正面', charPos);
        const neg = kvLine('负面', charNeg);
        if (pos) lines.push(pos);
        if (neg) lines.push(neg);
        if (center) {
            lines.push(`位置：${formatCoord(center.x)}, ${formatCoord(center.y)}`);
        }
        if (lines.length > 1) {
            blocks.push(lines.join('\n'));
        }
    }
    return blocks;
}

/**
 * 分类纯文本格式化。勾选 includeArtist 时前置「画师串」段；场景不拼画师串。
 *
 * @param {import('../../domain/model/nai-params.js').NaiCaption|null|undefined} caption
 * @param {object} [opts]
 * @param {{ positive?: string, negative?: string }|null} [opts.artist]
 * @param {boolean} [opts.includeArtist]
 * @returns {string}
 */
export function formatPromptText(caption, opts = {}) {
    /** @type {string[]} */
    const blocks = [];
    if (opts?.includeArtist === true && isUsableArtist(opts?.artist)) {
        const artistBlock = formatArtistBlock(/** @type {{ positive?: string, negative?: string }} */ (opts.artist));
        if (artistBlock) blocks.push(artistBlock);
    }
    const scene = formatSceneBlock(caption);
    if (scene) blocks.push(scene);
    for (const charBlock of formatCharacterBlocks(caption)) {
        blocks.push(charBlock);
    }
    return blocks.join('\n\n');
}

/**
 * @typedef {object} PromptTextArtist
 * @property {string} positive
 * @property {string} negative
 */

/**
 * @typedef {object} ParsedPromptText
 * @property {PromptTextArtist|null} artist
 * @property {import('../../domain/model/nai-params.js').NaiCaption} caption
 * @property {boolean} truncated
 * @property {string|null} truncateMessage
 */

/**
 * @typedef {'artist'|'scene'|'char'|null} SectionKind
 */

/**
 * @param {string} line
 * @returns {{ kind: SectionKind, index?: number }|null}
 */
function matchSectionHeader(line) {
    const t = line.trim();
    if (t === '画师串') return { kind: 'artist' };
    if (t === '场景') return { kind: 'scene' };
    const m = /^角色\s*(\d+)\s*$/.exec(t);
    if (m) return { kind: 'char', index: Number(m[1]) };
    return null;
}

/**
 * @param {string} line
 * @returns {{ key: '正面'|'负面'|'位置', value: string }|null}
 */
function matchFieldLine(line) {
    const m = /^(正面|负面|位置)\s*[：:](.*)$/.exec(line);
    if (!m) return null;
    return {
        key: /** @type {'正面'|'负面'|'位置'} */ (m[1]),
        value: m[2] ?? '',
    };
}

/**
 * @param {string} raw
 * @returns {{ x: number, y: number }|null}
 */
function parsePositionValue(raw) {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(raw ?? ''));
    if (!m) return null;
    const x = Number(m[1]);
    const y = Number(m[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
}

/**
 * 解析分类提示词文本。须至少有一个「场景」或「角色N」段，否则报错。
 *
 * @param {string} text
 * @param {object} [opts]
 * @param {number} [opts.maxCharacters]
 * @returns {{ ok: true, value: ParsedPromptText } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function parsePromptText(text, opts = {}) {
    const maxCharacters = Number.isFinite(opts?.maxCharacters) && opts.maxCharacters > 0
        ? Math.floor(Number(opts.maxCharacters))
        : PROMPT_TEXT_DEFAULT_MAX_CHARACTERS;

    const normalized = String(text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n');

    /** @type {PromptTextArtist|null} */
    let artist = null;
    let scenePos = '';
    let sceneNeg = '';
    let hasScene = false;
    /** @type {Array<{ positive: string, negative: string, center: {x:number,y:number}|null }>} */
    const chars = [];

    /** @type {SectionKind} */
    let kind = null;
    /** @type {{ positive: string, negative: string, center: {x:number,y:number}|null }|null} */
    let currentChar = null;

    /**
     * @returns {void}
     */
    function flushChar() {
        if (!currentChar) return;
        const empty = !hasText(currentChar.positive)
            && !hasText(currentChar.negative)
            && currentChar.center == null;
        if (!empty) {
            chars.push(currentChar);
        }
        currentChar = null;
    }

    for (const rawLine of lines) {
        const header = matchSectionHeader(rawLine);
        if (header) {
            flushChar();
            kind = header.kind;
            if (header.kind === 'artist') {
                artist = { positive: '', negative: '' };
            } else if (header.kind === 'scene') {
                hasScene = true;
                scenePos = '';
                sceneNeg = '';
            } else if (header.kind === 'char') {
                currentChar = { positive: '', negative: '', center: null };
            }
            continue;
        }

        if (kind == null) continue;
        const field = matchFieldLine(rawLine);
        if (!field) continue;

        if (kind === 'artist' && artist) {
            if (field.key === '正面') artist.positive = field.value;
            else if (field.key === '负面') artist.negative = field.value;
        } else if (kind === 'scene') {
            if (field.key === '正面') scenePos = field.value;
            else if (field.key === '负面') sceneNeg = field.value;
        } else if (kind === 'char' && currentChar) {
            if (field.key === '正面') currentChar.positive = field.value;
            else if (field.key === '负面') currentChar.negative = field.value;
            else if (field.key === '位置') {
                currentChar.center = parsePositionValue(field.value);
            }
        }
    }
    flushChar();

    if (!hasScene && chars.length === 0) {
        return Err(domainError({
            code: 'PROMPT_TEXT_NOT_PROMPT',
            message: '剪贴板里不是提示词',
            hint: '请粘贴「场景」或「角色N」分类文本',
        }));
    }

    if (artist && !isUsableArtist(artist)) {
        artist = null;
    }

    let truncated = false;
    /** @type {string|null} */
    let truncateMessage = null;
    let usedChars = chars;
    if (chars.length > maxCharacters) {
        truncated = true;
        truncateMessage = `角色超过上限（${maxCharacters}），已截断`;
        usedChars = chars.slice(0, maxCharacters);
    }

    /** @type {import('../../domain/model/nai-params.js').CharCaption[]} */
    const posChars = [];
    /** @type {import('../../domain/model/nai-params.js').CharCaption[]} */
    const negChars = [];
    for (const row of usedChars) {
        /** @type {import('../../domain/model/nai-params.js').CharCaption} */
        const pos = { char_caption: String(row.positive ?? '') };
        /** @type {import('../../domain/model/nai-params.js').CharCaption} */
        const neg = { char_caption: String(row.negative ?? '') };
        if (row.center) {
            const centers = [{ x: row.center.x, y: row.center.y }];
            pos.centers = centers.map((p) => ({ ...p }));
            neg.centers = centers.map((p) => ({ ...p }));
        }
        posChars.push(pos);
        negChars.push(neg);
    }

    /** @type {import('../../domain/model/nai-params.js').NaiCaption} */
    const caption = {
        v4_prompt: {
            caption: {
                base_caption: hasScene ? String(scenePos ?? '') : '',
                char_captions: posChars,
            },
        },
        v4_negative_prompt: {
            caption: {
                base_caption: hasScene ? String(sceneNeg ?? '') : '',
                char_captions: negChars,
            },
        },
    };

    if (!hasScene && posChars.length === 0) {
        return Err(domainError({
            code: 'PROMPT_TEXT_NOT_PROMPT',
            message: '剪贴板里不是提示词',
            hint: '请粘贴「场景」或「角色N」分类文本',
        }));
    }

    // 无场景段时仍用空 base，避免空对象
    if (!hasScene) {
        caption.v4_prompt.caption.base_caption = emptyNaiCaption().v4_prompt.caption.base_caption;
        caption.v4_negative_prompt.caption.base_caption = emptyNaiCaption()
            .v4_negative_prompt.caption.base_caption;
    }

    return Ok({
        artist,
        caption,
        truncated,
        truncateMessage,
    });
}

/**
 * 在画师串库中找正/负向均 trim 后一致的一条。
 *
 * @param {Iterable<{ id?: string, name?: string, positivePrompt?: string, negativePrompt?: string, positive?: string, negative?: string }>} artists
 * @param {{ positive?: string, negative?: string, positivePrompt?: string, negativePrompt?: string }|null|undefined} target
 * @returns {{ id: string, name: string, positivePrompt: string, negativePrompt: string }|null}
 */
export function findMatchingArtist(artists, target) {
    if (!target || !isUsableArtist(target)) return null;
    const want = artistPromptPair(target);
    for (const item of artists || []) {
        if (!item || typeof item !== 'object') continue;
        const got = artistPromptPair(item);
        if (got.pos === want.pos && got.neg === want.neg) {
            const id = item.id == null ? '' : String(item.id);
            if (!id) continue;
            return {
                id,
                name: item.name != null ? String(item.name) : id,
                positivePrompt: got.pos,
                negativePrompt: got.neg,
            };
        }
    }
    return null;
}
