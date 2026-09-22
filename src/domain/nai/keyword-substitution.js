/**
 * L3 领域层 · 角色关键字原位替换成固定特征（需求 4.14 步骤 2）。
 * 非固定特征不参与；固定特征内再现关键字不做第二遍。
 * 归属：W1-A 领域代理实现。W0 仅冻结签名。
 */

import { tryParseRegexKeyword } from '../matching/keyword-matcher.js';

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
    if (!caption || typeof caption !== 'object') {
        throw new Error('invalid argument: caption');
    }
    const active = filterActiveCharacters(groups, characters);
    const matchGlobals = globals ?? { caseSensitive: false, matchWholeWords: false };

    const posCap = caption.v4_prompt?.caption;
    const negCap = caption.v4_negative_prompt?.caption;

    return {
        v4_prompt: {
            caption: {
                base_caption: substituteKeywordsInText(
                    String(posCap?.base_caption ?? ''),
                    active,
                    matchGlobals,
                ),
                char_captions: mapCharCaptions(posCap?.char_captions, active, matchGlobals),
            },
        },
        v4_negative_prompt: {
            caption: {
                base_caption: substituteKeywordsInText(
                    String(negCap?.base_caption ?? ''),
                    active,
                    matchGlobals,
                ),
                char_captions: mapCharCaptions(negCap?.char_captions, active, matchGlobals),
            },
        },
    };
}

/**
 * 对单段文本做一次原位替换。
 * 在原文上收集全部命中区间，按起点排序后单次拼接——替换产物不再二次扫描。
 * @param {string} text
 * @param {Character[]} activeCharacters 已按组过滤
 * @param {ActivationGlobals} globals
 * @returns {string}
 */
export function substituteKeywordsInText(text, activeCharacters, globals) {
    if (typeof text !== 'string' || text.length === 0) {
        return typeof text === 'string' ? text : '';
    }
    if (!Array.isArray(activeCharacters) || activeCharacters.length === 0) {
        return text;
    }
    const matchGlobals = globals ?? { caseSensitive: false, matchWholeWords: false };

    /** @type {Array<{ start: number, end: number, replacement: string }>} */
    const ranges = [];

    for (const character of activeCharacters) {
        if (!character) {
            continue;
        }
        const replacement = String(character.fixedFeatures ?? '');
        const overrides = character.matchOverrides ?? null;
        for (const needle of character.keywords ?? []) {
            if (typeof needle !== 'string' || needle.length === 0) {
                continue;
            }
            collectMatchRanges(text, needle, overrides, matchGlobals, replacement, ranges);
        }
    }

    if (ranges.length === 0) {
        return text;
    }

    ranges.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));

    /** @type {string[]} */
    const parts = [];
    let cursor = 0;
    for (const range of ranges) {
        if (range.start < cursor) {
            continue;
        }
        parts.push(text.slice(cursor, range.start));
        parts.push(range.replacement);
        cursor = range.end;
    }
    parts.push(text.slice(cursor));
    return parts.join('');
}

/**
 * @param {CharacterGroup[]|undefined} groups
 * @param {Character[]|undefined} characters
 * @returns {Character[]}
 */
function filterActiveCharacters(groups, characters) {
    if (!Array.isArray(groups) || !Array.isArray(characters)) {
        return [];
    }
    const activeIds = new Set(
        groups.filter((g) => g && g.active === true).map((g) => g.id),
    );
    return characters.filter((c) => c && activeIds.has(c.groupId));
}

/**
 * @param {unknown} raw
 * @param {Character[]} active
 * @param {ActivationGlobals} globals
 * @returns {import('../model/nai-params.js').CharCaption[]}
 */
function mapCharCaptions(raw, active, globals) {
    if (!Array.isArray(raw)) {
        return [];
    }
    return raw.map((c) => {
        /** @type {import('../model/nai-params.js').CharCaption} */
        const item = {
            char_caption: substituteKeywordsInText(
                String(c?.char_caption ?? ''),
                active,
                globals,
            ),
        };
        if (Array.isArray(c?.centers)) {
            item.centers = c.centers.map((p) => ({
                x: Number(p?.x) || 0,
                y: Number(p?.y) || 0,
            }));
        }
        return item;
    });
}

/**
 * @param {string} text
 * @param {string} needle
 * @param {{ caseSensitive?: boolean, matchWholeWords?: boolean }|null} overrides
 * @param {ActivationGlobals} globals
 * @param {string} replacement
 * @param {Array<{ start: number, end: number, replacement: string }>} out
 */
function collectMatchRanges(text, needle, overrides, globals, replacement, out) {
    const regexKw = tryParseRegexKeyword(needle);
    if (regexKw) {
        const flags = regexKw.flags.includes('g') ? regexKw.flags : `${regexKw.flags}g`;
        const re = new RegExp(regexKw.source, flags);
        let m = re.exec(text);
        while (m) {
            if (m[0].length > 0) {
                out.push({
                    start: m.index,
                    end: m.index + m[0].length,
                    replacement,
                });
            }
            if (m[0].length === 0) {
                re.lastIndex += 1;
            }
            m = re.exec(text);
        }
        return;
    }

    const caseSensitive = overrides?.caseSensitive ?? globals.caseSensitive === true;
    const matchWholeWords = overrides?.matchWholeWords ?? globals.matchWholeWords === true;
    const hay = caseSensitive ? text : text.toLowerCase();
    const nee = caseSensitive ? needle : needle.toLowerCase();

    if (matchWholeWords && nee.split(/\s+/).length === 1) {
        // 与 matchKeys 相同的 \W 边界；索引对齐到原文（大小写折叠不改长度的常见路径）
        const boundary = new RegExp(`(?:^|\\W)(${escapeRegex(nee)})(?:$|\\W)`, 'g');
        let m = boundary.exec(hay);
        while (m) {
            const captured = m[1];
            const start = m.index + m[0].indexOf(captured);
            out.push({
                start,
                end: start + needle.length,
                replacement,
            });
            m = boundary.exec(hay);
        }
        return;
    }

    let from = 0;
    while (from <= hay.length - nee.length) {
        const idx = hay.indexOf(nee, from);
        if (idx === -1) {
            break;
        }
        out.push({
            start: idx,
            end: idx + needle.length,
            replacement,
        });
        from = idx + Math.max(needle.length, 1);
    }
}

/**
 * @param {string} string
 * @returns {string}
 */
function escapeRegex(string) {
    return string.replace(/[/\-\\^$*+?.()|[\]{}]/g, '\\$&');
}
