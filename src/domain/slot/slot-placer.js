/**
 * L3 领域层 · 用「生成点」在楼层正文定位并插入 slot。
 * 归属：W1-A 领域代理实现。W0 仅冻结签名。
 *
 * 匹配降级（R-08）：精确 → 归一化空白/标点 → 最长公共子串；全失败则追加段末并标记警告。
 */

import { formatSlotToken } from './slot-token.js';

/**
 * @typedef {import('../model/slot.js').SlotPlan} SlotPlan
 */

/**
 * @typedef {object} PlaceSlotsResult
 * @property {string} text 插入后的正文
 * @property {Array<{ slotId: number, placed: boolean, mode: string }>} placements
 */

/**
 * 按各 SlotPlan 的 anchorSentence 依次插入 formatSlotToken(slotId)。
 * @param {string} messageText 当前楼正文
 * @param {SlotPlan[]} plans
 * @returns {PlaceSlotsResult}
 */
export function placeSlots(messageText, plans) {
    let text = typeof messageText === 'string' ? messageText : '';
    if (!Array.isArray(plans)) {
        return { text, placements: [] };
    }

    /** @type {Array<{ slotId: number, placed: boolean, mode: string }>} */
    const placements = [];

    for (const plan of plans) {
        if (!plan) {
            continue;
        }
        const slotId = Number(plan.slotId);
        const token = formatSlotToken(slotId);
        const anchor = String(plan.anchorSentence ?? '');
        const found = findAnchorInsertIndex(text, anchor);

        if (found.index >= 0) {
            text = insertTokenOnOwnLine(text, found.index, token);
            placements.push({ slotId, placed: true, mode: found.mode });
        } else {
            // 全失败：另起一行追加段末并告警（mode=append-warn）
            text = insertTokenOnOwnLine(text, text.length, token);
            placements.push({ slotId, placed: false, mode: 'append-warn' });
        }
    }

    return { text, placements };
}

/**
 * 标记独占一行：前面、后面都换行，已有换行不重复加。
 * @param {string} text
 * @param {number} index
 * @param {string} token
 * @returns {string}
 */
function insertTokenOnOwnLine(text, index, token) {
    const before = text.slice(0, index);
    const after = text.slice(index);
    const lead = before.length === 0 || before.endsWith('\n') ? '' : '\n';
    const trail = after.length === 0 || after.startsWith('\n') ? '' : '\n';
    return before + lead + token + trail + after;
}

/**
 * 在 text 中定位 anchor，返回插入下标（anchor 结束之后）；找不到返回 -1。
 * @param {string} text
 * @param {string} anchorSentence
 * @returns {{ index: number, mode: string }}
 */
export function findAnchorInsertIndex(text, anchorSentence) {
    const source = typeof text === 'string' ? text : '';
    const anchor = typeof anchorSentence === 'string' ? anchorSentence : '';

    if (!anchor) {
        return { index: -1, mode: 'fail' };
    }

    // 1) 精确
    const exact = source.indexOf(anchor);
    if (exact !== -1) {
        return { index: exact + anchor.length, mode: 'exact' };
    }

    // 2) 归一化空白与标点
    const normResult = findNormalized(source, anchor);
    if (normResult.index >= 0) {
        return { index: normResult.index, mode: 'normalized' };
    }

    // 3) 最长公共子串
    const lcsResult = findByLongestCommonSubstring(source, anchor);
    if (lcsResult.index >= 0) {
        return { index: lcsResult.index, mode: 'lcs' };
    }

    return { index: -1, mode: 'fail' };
}

/**
 * @param {string} text
 * @param {string} anchor
 * @returns {{ index: number }}
 */
function findNormalized(text, anchor) {
    const { normalized: normText, map } = normalizeWithMap(text);
    const normAnchor = normalizeText(anchor);
    if (!normAnchor) {
        return { index: -1 };
    }
    const at = normText.indexOf(normAnchor);
    if (at === -1) {
        return { index: -1 };
    }
    const endNorm = at + normAnchor.length - 1;
    const endOrig = map[endNorm];
    if (endOrig == null) {
        return { index: -1 };
    }
    return { index: endOrig + 1 };
}

/**
 * 去掉全部空白与常见中英标点，便于「你好 世界」对齐「你好世界」。
 * @param {string} s
 * @returns {string}
 */
function normalizeText(s) {
    return s
        .replace(/\s+/g, '')
        .replace(/[，。！？、；：""''「」『』（）【】《》,.!?;:'"()\[\]{}]/g, '')
        .toLowerCase();
}

/**
 * @param {string} text
 * @returns {{ normalized: string, map: number[] }} map[i] = 归一化第 i 字符对应原文下标
 */
function normalizeWithMap(text) {
    /** @type {number[]} */
    const map = [];
    /** @type {string[]} */
    const chars = [];
    const lower = text.toLowerCase();
    for (let i = 0; i < text.length; i += 1) {
        const ch = lower[i];
        if (/\s/.test(ch)) {
            continue;
        }
        if (/[，。！？、；：""''「」『』（）【】《》,.!?;:'"()\[\]{}]/.test(ch)) {
            continue;
        }
        chars.push(ch);
        map.push(i);
    }
    return {
        normalized: chars.join(''),
        map,
    };
}

/**
 * 在原文中找与 anchor 的最长公共子串；要求长度 ≥ max(4, ceil(anchorLen*0.4))。
 * 命中后插入点取该子串在原文中的结束位置。
 * @param {string} text
 * @param {string} anchor
 * @returns {{ index: number }}
 */
function findByLongestCommonSubstring(text, anchor) {
    const a = text.toLowerCase();
    const b = anchor.toLowerCase();
    if (!a || !b) {
        return { index: -1 };
    }
    const minLen = Math.max(4, Math.ceil(b.length * 0.4));
    let bestLen = 0;
    let bestEndInText = -1;

    // DP 滚动数组找 LCS（连续）
    let prev = new Array(b.length + 1).fill(0);
    let curr = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i += 1) {
        for (let j = 1; j <= b.length; j += 1) {
            if (a[i - 1] === b[j - 1]) {
                curr[j] = prev[j - 1] + 1;
                if (curr[j] > bestLen) {
                    bestLen = curr[j];
                    bestEndInText = i;
                }
            } else {
                curr[j] = 0;
            }
        }
        const tmp = prev;
        prev = curr;
        curr = tmp;
        curr.fill(0);
    }

    if (bestLen < minLen || bestEndInText < 0) {
        return { index: -1 };
    }
    return { index: bestEndInText };
}
