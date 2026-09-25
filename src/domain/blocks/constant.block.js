/**
 * L3 领域层 · 常驻标签注入块（需求 4.3 / 4.4）。
 * 已激活常驻库的全部条目原样进入；格式与「特征参考」相同（key: value）。
 */

import { formatFeatureBlock } from './feature.block.js';

/**
 * @typedef {import('../model/tag.js').TagLibrary} TagLibrary
 * @typedef {import('../model/tag.js').TagEntry} TagEntry
 */

/**
 * 按库列表顺序、库内条目保存顺序收集已激活常驻库的全部条目。
 * @param {TagLibrary[]} libraries listLibraries 返回顺序即「列表里的顺序」
 * @param {Map<string, TagEntry[]>} entriesByLibrary
 * @returns {TagEntry[]}
 */
export function collectConstantEntries(libraries, entriesByLibrary) {
    if (!Array.isArray(libraries) || libraries.length === 0) {
        return [];
    }
    /** @type {TagEntry[]} */
    const out = [];
    for (const lib of libraries) {
        if (!lib || lib.active !== true || lib.kind !== 'constant') {
            continue;
        }
        const entries = entriesByLibrary instanceof Map
            ? entriesByLibrary.get(lib.id)
            : null;
        if (!Array.isArray(entries) || entries.length === 0) {
            continue;
        }
        for (const entry of entries) {
            if (entry && entry.active !== false) {
                out.push(entry);
            }
        }
    }
    return out;
}

/**
 * 将常驻条目格式化为「常驻标签」变量值（与特征参考同形：key: value）。
 * @param {TagEntry[]} entries
 * @returns {string}
 */
export function formatConstantBlock(entries) {
    return formatFeatureBlock(entries);
}
