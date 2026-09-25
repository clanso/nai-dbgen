/**
 * L3 领域层 · 会话生图记录保留范围修剪（需求 4.17）。
 * 只保留最近 N 条 AI 回复楼（messageId）上的 slot 记录。
 */

import { requireArg } from '../../infra/validate.js';

/**
 * @param {Array<{ messageId: number, isUser?: boolean, isSystem?: boolean }>} messages
 *   全会话楼层（下标顺序，旧→新或任意；按 messageId 识别）
 * @param {number} n 保留最近 N 条 AI 楼
 * @returns {Set<number>} 应保留的 messageId
 */
export function retainedAiMessageIds(messages, n) {
    const limit = Number(n);
    requireArg(Number.isFinite(limit) && limit >= 0, 'n');
    const capped = Math.floor(limit);
    if (!Array.isArray(messages) || capped === 0) {
        return new Set();
    }
    /** @type {number[]} */
    const aiIds = [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const m = messages[i];
        if (!m || m.isUser || m.isSystem) {
            continue;
        }
        const id = Number(m.messageId);
        if (!Number.isInteger(id) || id < 0) {
            continue;
        }
        aiIds.push(id);
        if (aiIds.length >= capped) {
            break;
        }
    }
    return new Set(aiIds);
}

/**
 * 从记录表中剔出不在保留 messageId 集合内的项（不修改入参）。
 *
 * @template {{ messageId: number, slotId: number }} T
 * @param {Iterable<T>} records
 * @param {Set<number>} keepMessageIds
 * @returns {{ kept: T[], removed: T[] }}
 */
export function trimRecordsByMessageIds(records, keepMessageIds) {
    /** @type {T[]} */
    const kept = [];
    /** @type {T[]} */
    const removed = [];
    const keep = keepMessageIds instanceof Set ? keepMessageIds : new Set();
    if (records == null) {
        return { kept, removed };
    }
    for (const rec of records) {
        if (!rec) {
            continue;
        }
        const mid = Number(rec.messageId);
        if (keep.has(mid)) {
            kept.push(rec);
        } else {
            removed.push(rec);
        }
    }
    return { kept, removed };
}
