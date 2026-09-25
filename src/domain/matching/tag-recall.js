/**
 * L3 领域层 · 标签召回回文 key 原文对账（需求 4.11 / 4.3 / 裁决 D25）。
 *
 * 严格度（函数头即契约，详见交付报告）：
 * - **区分大小写**：`===`，不做 toLowerCase（「原文」）
 * - **回文侧 trim**：只对 LLM 回文做 `.trim()`，目录 key 原样比较
 *   （吸收模型常带的首尾空白/换行；不改用户存盘的 key）
 * - **不做**模糊、包含、正则。按编号对账见 reconcileRecalledIds
 * - **多库同名 key**：`activeEntries` 数组序**先出现者胜**；调用方负责排序
 * - **重复回文**：同一 entry 只命中一次；后续同 key 回文忽略（不进 unmatched）
 * - **空 / 仅空白回文**：记入 unmatched（可观测，不静默吞掉）
 *
 * `activeEntries` 须已是「已激活库」内的条目；本函数不再读库开关。
 */

/**
 * @typedef {import('../model/tag.js').TagEntry} TagEntry
 */

/**
 * @typedef {object} ReconcileRecalledKeysResult
 * @property {TagEntry[]} matched
 *   命中条目，顺序与 recalledKeys 中**首次**命中顺序一致；元素为入参数组中的引用副本语义
 *   （新数组，条目对象不深拷贝）。
 * @property {string[]} unmatched
 *   未对上的回文（保序）：编造、拼错、大小写不符、trim 后仍对不上、空串/仅空白。
 *   上层应展示给用户（可观测）；注入块只用 matched。
 */

/**
 * 构图 key 里第一个「：」前是分类，只用于显示。传给模型和回文对账时不用这段。
 * @param {unknown} key
 * @returns {string}
 */
export function compositionNameForRecall(key) {
    const text = typeof key === 'string' ? key.trim() : '';
    const sep = text.indexOf('：');
    if (sep < 0) {
        return text;
    }
    return text.slice(sep + 1).trim();
}

/**
 * 候选行：`编号 名称`。编号从 1 起，与 ordered 下标对应。
 * @param {TagEntry[]} activeEntries
 * @returns {{ lines: string[], ordered: TagEntry[] }}
 */
export function formatRecallCandidateLines(activeEntries) {
    const entries = Array.isArray(activeEntries) ? activeEntries : [];
    /** @type {string[]} */
    const lines = [];
    /** @type {TagEntry[]} */
    const ordered = [];
    for (const entry of entries) {
        if (!entry || typeof entry.key !== 'string' || entry.key.length === 0) {
            continue;
        }
        ordered.push(entry);
        lines.push(`${ordered.length} ${compositionNameForRecall(entry.key)}`);
    }
    return { lines, ordered };
}

/**
 * 回文是候选编号（1 起），不是汉字 key。
 * @param {unknown} recalledIds
 * @param {TagEntry[]} orderedEntries formatRecallCandidateLines 的 ordered
 * @returns {ReconcileRecalledKeysResult}
 */
export function reconcileRecalledIds(recalledIds, orderedEntries) {
    const ids = Array.isArray(recalledIds) ? recalledIds : [];
    const ordered = Array.isArray(orderedEntries) ? orderedEntries : [];
    /** @type {TagEntry[]} */
    const matched = [];
    /** @type {string[]} */
    const unmatched = [];
    /** @type {Set<number>} */
    const seen = new Set();

    for (const raw of ids) {
        const original = raw == null ? '' : String(raw);
        const trimmed = original.trim();
        if (trimmed.length === 0) {
            unmatched.push(original);
            continue;
        }
        if (!/^\d+$/.test(trimmed)) {
            unmatched.push(original);
            continue;
        }
        const n = Number(trimmed);
        if (!Number.isInteger(n) || n < 1 || n > ordered.length) {
            unmatched.push(original);
            continue;
        }
        if (seen.has(n)) {
            continue;
        }
        const entry = ordered[n - 1];
        if (!entry) {
            unmatched.push(original);
            continue;
        }
        seen.add(n);
        matched.push(entry);
    }

    return { matched, unmatched };
}

/**
 * 将 LLM 召回回文与已激活库条目做原文对账。
 *
 * @param {unknown} recalledKeys LLM 回文 key 列表（非数组视为空）
 * @param {TagEntry[]} activeEntries 已激活库内的候选条目（调用方过滤）
 * @returns {ReconcileRecalledKeysResult}
 */
export function reconcileRecalledKeys(recalledKeys, activeEntries) {
    const keys = Array.isArray(recalledKeys) ? recalledKeys : [];
    const entries = Array.isArray(activeEntries) ? activeEntries : [];

    /** @type {Map<string, TagEntry>} */
    const byKey = new Map();
    for (const entry of entries) {
        if (!entry || typeof entry.key !== 'string') {
            continue;
        }
        // 先出现者胜：已有同名 key 则跳过
        if (!byKey.has(entry.key)) {
            byKey.set(entry.key, entry);
        }
    }

    /** @type {TagEntry[]} */
    const matched = [];
    /** @type {string[]} */
    const unmatched = [];
    /** @type {Set<string>} 已命中的目录 key，用于去重 */
    const matchedKeys = new Set();

    for (const raw of keys) {
        // 非字符串：转成可展示的原文再记未命中（不静默丢）
        const original = raw == null ? '' : String(raw);
        const trimmed = original.trim();

        if (trimmed.length === 0) {
            unmatched.push(original);
            continue;
        }

        if (matchedKeys.has(trimmed)) {
            // 重复回文且已命中：忽略，不二次注入、不报未命中
            continue;
        }

        const entry = byKey.get(trimmed);
        if (!entry) {
            unmatched.push(original);
            continue;
        }

        matchedKeys.add(trimmed);
        matched.push(entry);
    }

    return { matched, unmatched };
}
