/**
 * 解析失败时留下的原文。只在判定解析失败的那一刻拷贝字符串，之后不再改。
 * 存在当前页面内存里，刷新即清空。
 */

const MAX_ENTRIES = 40;

/**
 * @typedef {object} ParseDebugEntry
 * @property {number} id
 * @property {string} at
 * @property {string} stage
 * @property {string} code
 * @property {string} message
 * @property {string} rawText
 */

/** @type {ParseDebugEntry[]} */
const entries = [];
let seq = 0;

/**
 * @param {{ stage?: string, code?: string, message?: string, rawText?: unknown }} input
 */
export function recordParseFailure(input) {
    const rawText = input?.rawText == null ? '' : String(input.rawText);
    entries.unshift({
        id: seq + 1,
        at: new Date().toISOString(),
        stage: input?.stage == null ? '' : String(input.stage),
        code: input?.code == null ? '' : String(input.code),
        message: input?.message == null ? '' : String(input.message),
        rawText,
    });
    seq += 1;
    if (entries.length > MAX_ENTRIES) {
        entries.length = MAX_ENTRIES;
    }
}

/**
 * @returns {ParseDebugEntry[]}
 */
export function listParseFailures() {
    return entries.map((entry) => ({ ...entry }));
}

export function clearParseFailures() {
    entries.length = 0;
}
