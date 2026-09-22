/**
 * L4 应用层私有辅助（不对外契约）。
 */

import { Err } from '../infra/result.js';
import { upstreamFromHttpStatus } from '../infra/errors.js';

/**
 * @param {AbortSignal} [signal]
 * @param {string} [traceId]
 * @returns {import('../infra/result.js').Err<import('../infra/errors.js').AppError>|null}
 */
export function abortErrIfNeeded(signal, traceId) {
    if (signal == null || !signal.aborted) {
        return null;
    }
    const cause = signal.reason instanceof Error
        ? signal.reason
        : Object.assign(new Error('aborted'), { name: 'AbortError' });
    return Err(upstreamFromHttpStatus(0, {
        code: 'UPSTREAM_ABORTED',
        message: '请求已取消',
        cause,
        traceId: traceId ?? null,
    }));
}

/**
 * 给 AppError 补上 traceId（若尚无）。
 * @template T
 * @param {{ ok: true, value: T } | { ok: false, error: import('../infra/errors.js').AppError }} r
 * @param {string} traceId
 * @returns {{ ok: true, value: T } | { ok: false, error: import('../infra/errors.js').AppError }}
 */
export function attachTraceId(r, traceId) {
    if (r.ok) {
        return r;
    }
    if (r.error && r.error.traceId == null) {
        r.error.traceId = traceId;
    }
    return r;
}

/**
 * 从 LLM 回文中抽出 key 列表（数组，或 { keys: [...] }）。
 * @param {unknown} json
 * @param {string} [text]
 * @returns {string[]}
 */
export function extractRecalledKeyList(json, text) {
    if (Array.isArray(json)) {
        return json.map((x) => (x == null ? '' : String(x)));
    }
    if (json && typeof json === 'object') {
        const keys = /** @type {Record<string, unknown>} */ (json).keys
            ?? /** @type {Record<string, unknown>} */ (json).key
            ?? /** @type {Record<string, unknown>} */ (json).tags;
        if (Array.isArray(keys)) {
            return keys.map((x) => (x == null ? '' : String(x)));
        }
    }
    if (typeof text === 'string' && text.trim()) {
        // 兜底：按行拆非空行
        return text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    }
    return [];
}

/**
 * 解析步骤 5 的 SlotPlan 数组（兼容外层包一层对象）。
 * @param {unknown} json
 * @returns {unknown[]}
 */
export function extractSlotPlanItems(json) {
    if (Array.isArray(json)) {
        return json;
    }
    if (json && typeof json === 'object') {
        const o = /** @type {Record<string, unknown>} */ (json);
        if (Array.isArray(o.slots)) {
            return o.slots;
        }
        if (Array.isArray(o.items)) {
            return o.items;
        }
        if (Array.isArray(o.data)) {
            return o.data;
        }
    }
    return [];
}

/**
 * 列出角色库全部角色（跨组）。
 * @param {import('../ports/repository.port.js').CharacterRepository} characterRepo
 * @returns {Promise<{ ok: true, value: { groups: import('../domain/model/character.js').CharacterGroup[], characters: import('../domain/model/character.js').Character[] } } | { ok: false, error: import('../infra/errors.js').AppError }>}
 */
export async function loadAllCharacters(characterRepo) {
    const groupsR = await characterRepo.listGroups();
    if (!groupsR.ok) {
        return groupsR;
    }
    /** @type {import('../domain/model/character.js').Character[]} */
    const characters = [];
    for (const g of groupsR.value) {
        const cr = await characterRepo.listByGroup(g.id);
        if (!cr.ok) {
            return cr;
        }
        characters.push(...cr.value);
    }
    return { ok: true, value: { groups: groupsR.value, characters } };
}

/** 召回预设里「候选 key」变量名（BlockSet 额外键，见 preset-renderer 注释） */
export const RECALL_CANDIDATE_KEYS_VAR = '候选 key';

/** 步骤 5 结构化输出 schema（提示网关/中转） */
export const SLOT_PLAN_JSON_SCHEMA = Object.freeze({
    name: 'slot_plan_array',
    schema: {
        type: 'array',
        items: {
            type: 'object',
            properties: {
                slotid: { type: 'integer' },
                生成点: { type: 'string' },
                生图内容: { type: 'object' },
            },
            required: ['slotid', '生成点', '生图内容'],
        },
    },
});

/** 召回 key 列表 schema */
export const RECALL_KEYS_JSON_SCHEMA = Object.freeze({
    name: 'recall_keys',
    schema: {
        type: 'array',
        items: { type: 'string' },
    },
});

/** 工作台写提示词：直接产出 NaiCaption */
export const WORKBENCH_CAPTION_JSON_SCHEMA = Object.freeze({
    name: 'nai_caption',
    schema: {
        type: 'object',
        properties: {
            v4_prompt: { type: 'object' },
            v4_negative_prompt: { type: 'object' },
        },
        required: ['v4_prompt', 'v4_negative_prompt'],
    },
});

/** 应用层 → UI 事件名与载荷约定（W3 / UI 装配必读） */
export const APP_EVENTS = Object.freeze({
    /**
     * generateSlots 写完 slot 后发出。
     * payload: { messageId, records, traceId, llmCallCount, unmatchedKeys, placements? }
     */
    SLOTS_WRITTEN: 'slots:written',
    /**
     * renderSlot 出图成功后发出。
     * payload: { messageId, slotId, imageRef, traceId, record }
     */
    SLOT_RENDERED: 'slot:rendered',
    /**
     * 召回有未命中 key 时发出（可与 toast 订阅）。
     * payload: { messageId?, traceId, unmatchedKeys, matchedCount }
     */
    TAG_RECALL_UNMATCHED: 'tag-recall:unmatched',
});
