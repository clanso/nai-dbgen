/**
 * L3 领域层 · 构图标签注入块格式化（需求 4.3 / 4.4 / 4.16）。
 */

/**
 * @typedef {import('../model/tag.js').TagEntry} TagEntry
 */

/**
 * @typedef {object} CompositionPosition
 * @property {number} slotId
 * @property {string} anchorSentence 生成点
 * @property {TagEntry[]} entries 该位置命中的构图条目
 */

/**
 * @param {TagEntry[]} entries
 * @returns {string[]}
 */
function formatKvLines(entries) {
    if (!Array.isArray(entries)) {
        return [];
    }
    /** @type {string[]} */
    const lines = [];
    for (const entry of entries) {
        if (!entry) {
            continue;
        }
        const key = String(entry.key ?? '');
        const value = String(entry.value ?? '');
        if (!key && !value) {
            continue;
        }
        lines.push(`${key}: ${value}`);
    }
    return lines;
}

/**
 * 楼中生图用：按位置列出 slotid、生成点、该位置的 key: value。
 * @param {CompositionPosition[]} positions
 * @returns {string}
 */
export function formatCompositionBlock(positions) {
    if (!Array.isArray(positions) || positions.length === 0) {
        return '';
    }
    /** @type {string[]} */
    const parts = [];
    for (const pos of positions) {
        if (!pos) {
            continue;
        }
        const slotId = Number(pos.slotId);
        const anchor = String(pos.anchorSentence ?? '');
        /** @type {string[]} */
        const lines = [
            `slotid: ${Number.isFinite(slotId) ? slotId : String(pos.slotId ?? '')}`,
            `生成点: ${anchor}`,
            ...formatKvLines(pos.entries),
        ];
        parts.push(lines.join('\n'));
    }
    return parts.join('\n\n');
}

/**
 * 单图用：只列 key: value，无 slotid、无生成点。
 * @param {TagEntry[]} entries
 * @returns {string}
 */
export function formatSingleCompositionBlock(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
        return '';
    }
    return formatKvLines(entries).join('\n');
}
