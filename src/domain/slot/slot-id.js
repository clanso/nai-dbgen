/**
 * L3 领域层 · 会话内 slotId 分配（需求 4.7）。
 * 纯函数：从楼层 swipe 正文取最大编号，再从 max+1 起依次分配。
 */

import { parseSlotIds } from './slot-token.js';
import { requireArg } from '../../infra/validate.js';

/**
 * @param {string|null|undefined} text
 * @returns {number} 正文中最大 slotId；无则 0
 */
export function maxSlotIdInText(text) {
    const ids = parseSlotIds(typeof text === 'string' ? text : '');
    let max = 0;
    for (const id of ids) {
        if (id > max) {
            max = id;
        }
    }
    return max;
}

/**
 * @param {Iterable<string|null|undefined>} texts
 * @returns {number} 多段正文中的最大 slotId；无则 0
 */
export function maxSlotIdInTexts(texts) {
    let max = 0;
    if (texts == null) {
        return 0;
    }
    for (const text of texts) {
        const m = maxSlotIdInText(text);
        if (m > max) {
            max = m;
        }
    }
    return max;
}

/**
 * 从新到旧的楼层列表中，找**最新一条**正文（含全部 swipe）带 slot 的楼，
 * 只看这一楼，返回其最大 slotId；全无则 0。
 *
 * @param {Array<{ texts: Iterable<string|null|undefined> }>} floorsNewestFirst
 * @returns {number}
 */
export function findLatestFloorMaxSlotId(floorsNewestFirst) {
    if (!Array.isArray(floorsNewestFirst)) {
        return 0;
    }
    for (const floor of floorsNewestFirst) {
        if (!floor) {
            continue;
        }
        const max = maxSlotIdInTexts(floor.texts);
        if (max > 0) {
            return max;
        }
    }
    return 0;
}

/**
 * 从已有最大编号之后依次分配 count 个 slotId。
 * maxExisting=0 → 从 1 起；maxExisting=5,count=2 → [6,7]。
 *
 * @param {number} maxExisting
 * @param {number} count
 * @returns {number[]}
 */
export function allocateSlotIdsAfterMax(maxExisting, count) {
    const max = Number(maxExisting);
    const n = Number(count);
    requireArg(Number.isFinite(max) && max >= 0, 'maxExisting');
    requireArg(Number.isInteger(n) && n >= 0, 'count');
    /** @type {number[]} */
    const ids = [];
    const start = Math.floor(max) + 1;
    for (let i = 0; i < n; i += 1) {
        ids.push(start + i);
    }
    return ids;
}
