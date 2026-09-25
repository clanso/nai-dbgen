/**
 * L3 领域层 · 「近期生图记录」注入块格式化（需求 4.4 / 4.17 / 步骤 5）。
 *
 * 按 slotid 从小到大；每 slot 只写有值的行；slot 之间空一行；无记录 → 空串。
 */

/**
 * @typedef {import('../model/slot.js').SlotRecord} SlotRecord
 */

/**
 * @param {string|undefined|null} value
 * @returns {string|null} 非空文本，否则 null
 */
function nonEmptyText(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const t = value.trim();
    return t.length > 0 ? t : null;
}

/**
 * 将保留范围内的 slot 记录格式化为「近期生图记录」变量值。
 * @param {SlotRecord[]} records 调用方已排除本轮 slot；本函数再按 slotId 排序
 * @returns {string}
 */
export function formatRecentSlotsBlock(records) {
    if (!Array.isArray(records) || records.length === 0) {
        return '';
    }
    const sorted = [...records].sort((a, b) => Number(a.slotId) - Number(b.slotId));
    /** @type {string[]} */
    const parts = [];
    for (const rec of sorted) {
        if (!rec) {
            continue;
        }
        /** @type {string[]} */
        const lines = [`slotid: ${Number(rec.slotId)}`];
        const analysis = nonEmptyText(rec.analysis);
        if (analysis != null) {
            lines.push(`解析: ${analysis}`);
        }
        const size = nonEmptyText(rec.size);
        if (size != null) {
            lines.push(`尺寸: ${size}`);
        }
        if (rec.caption != null) {
            lines.push(`生图内容: ${JSON.stringify(rec.caption)}`);
        }
        parts.push(lines.join('\n'));
    }
    return parts.join('\n\n');
}
