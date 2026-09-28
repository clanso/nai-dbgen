/**
 * 召回 / 生图最近一次原文，以及解析失败时留下的原文。
 * 只在记下的那一刻拷贝字符串，之后不再改。存在当前页面内存里，刷新即清空。
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

/**
 * @typedef {ParseDebugEntry & { ok: boolean }} LatestGenerationEntry
 */

/** @type {ParseDebugEntry[]} */
const entries = [];
/** @type {Record<string, LatestGenerationEntry>} */
const latestByStage = {};
let seq = 0;

/**
 * 覆盖该阶段最近一次调用的原文。成功和失败都记。
 * @param {{ stage?: string, ok?: boolean, code?: string, message?: string, rawText?: unknown }} input
 */
export function recordLatestGeneration(input) {
    const stage = input?.stage == null ? '' : String(input.stage);
    const rawText = input?.rawText == null ? '' : String(input.rawText);
    if (!stage || !rawText) return;
    seq += 1;
    latestByStage[stage] = {
        id: seq,
        at: new Date().toISOString(),
        stage,
        ok: input?.ok === true,
        code: input?.code == null ? '' : String(input.code),
        message: input?.message == null ? '' : String(input.message),
        rawText,
    };
}

/**
 * @returns {LatestGenerationEntry[]}
 */
export function listLatestGenerations() {
    const order = ['召回', '生图'];
    const stages = [
        ...order.filter((stage) => latestByStage[stage]),
        ...Object.keys(latestByStage).filter((stage) => !order.includes(stage)),
    ];
    return stages.map((stage) => ({ ...latestByStage[stage] }));
}

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
    recordLatestGeneration({
        stage: input?.stage,
        ok: false,
        code: input?.code,
        message: input?.message,
        rawText,
    });
}

/**
 * @returns {ParseDebugEntry[]}
 */
export function listParseFailures() {
    return entries.map((entry) => ({ ...entry }));
}

export function clearParseFailures() {
    entries.length = 0;
    for (const stage of Object.keys(latestByStage)) {
        delete latestByStage[stage];
    }
}
