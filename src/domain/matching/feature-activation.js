/**
 * L3 领域层 · 特征库关键字激活（需求 4.3）。
 * 只看 active 且 kind==='feature' 的库；条目 key 按逗号拆（正则内逗号不拆）。
 * 纯函数，无 IO。
 */

import { matchAllKeywords, matchAnyKeyword } from './keyword-matcher.js';
import { splitKeywordString } from '../model/character.js';

/**
 * @typedef {import('../model/tag.js').TagLibrary} TagLibrary
 * @typedef {import('../model/tag.js').TagEntry} TagEntry
 */

/**
 * @typedef {object} MatchDefaults
 * @property {boolean} caseSensitive
 * @property {boolean} matchWholeWords
 */

/**
 * @param {unknown} entriesByLibrary
 * @param {string} libraryId
 * @returns {TagEntry[]}
 */
function entriesForLibrary(entriesByLibrary, libraryId) {
    if (entriesByLibrary == null) {
        return [];
    }
    if (entriesByLibrary instanceof Map) {
        const list = entriesByLibrary.get(libraryId);
        return Array.isArray(list) ? list : [];
    }
    if (typeof entriesByLibrary === 'object') {
        const list = /** @type {Record<string, unknown>} */ (entriesByLibrary)[libraryId];
        return Array.isArray(list) ? /** @type {TagEntry[]} */ (list) : [];
    }
    return [];
}

/**
 * 从已激活特征库中筛出关键字命中的条目。
 * @param {TagLibrary[]} libraries
 * @param {Map<string, TagEntry[]>|Record<string, TagEntry[]>} entriesByLibrary
 * @param {string} scanText 扫描文本（通常为当前上下文 ± 用户描述）
 * @param {MatchDefaults} matchDefaults
 * @returns {TagEntry[]} 命中集；未激活 / 非 feature 库内条目绝不出现
 */
export function activateFeatureEntries(libraries, entriesByLibrary, scanText, matchDefaults) {
    if (!Array.isArray(libraries)) {
        return [];
    }
    const text = typeof scanText === 'string' ? scanText : '';
    const globals = matchDefaults ?? { caseSensitive: false, matchWholeWords: false };

    /** @type {TagEntry[]} */
    const hit = [];
    for (const library of libraries) {
        if (!library || library.active !== true || library.kind !== 'feature') {
            continue;
        }
        const entries = entriesForLibrary(entriesByLibrary, library.id);
        for (const entry of entries) {
            if (!entry || entry.libraryId !== library.id || entry.active === false) {
                continue;
            }
            const needles = splitKeywordString(String(entry.key ?? ''));
            if (!matchAnyKeyword(text, needles, null, globals)) {
                continue;
            }
            const secondaryKey = typeof entry.secondaryKey === 'string'
                ? entry.secondaryKey.trim()
                : '';
            if (secondaryKey) {
                const secondaryNeedles = splitKeywordString(secondaryKey);
                const logic = entry.secondaryLogic === 'all' ? 'all' : 'any';
                const secondaryHit = logic === 'all'
                    ? matchAllKeywords(text, secondaryNeedles, null, globals)
                    : matchAnyKeyword(text, secondaryNeedles, null, globals);
                if (!secondaryHit) {
                    continue;
                }
            }
            hit.push(entry);
        }
    }
    return hit;
}
