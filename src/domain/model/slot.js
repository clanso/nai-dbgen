/**
 * L3 领域模型 · SlotPlan / SlotRecord（架构文档 §5.3）。
 * 主键 (messageId, slotId)；权威记录挂 message.extra。
 * 归属：W0 契约冻结。
 */

import {
    isIntInRange,
    isNonEmptyString,
    isPlainObject,
    requireArg,
    validationErr,
    validationOk,
} from '../../infra/validate.js';
import { validateNaiCaption, emptyNaiCaption } from './nai-params.js';

export const SLOT_SCHEMA_VERSION = 1;

/**
 * @typedef {import('./artist.js').ImageRef} ImageRef
 * @typedef {import('./nai-params.js').NaiCaption} NaiCaption
 */

/**
 * LLM 一次产出的一项（步骤 5 输出）。仅在本批次内 slotId 唯一。
 * @typedef {object} SlotPlan
 * @property {number} slotId 模型给的 1..n
 * @property {string} anchorSentence 「生成点」：段落最后一句
 * @property {NaiCaption} caption
 */

/**
 * @typedef {object} SlotImageEntry
 * @property {ImageRef} imageRef
 * @property {string} createdAt
 * @property {string|null} naiConfigId
 * @property {string|null} artistId
 */

/**
 * 落地记录，主键 (messageId, slotId)。
 * @typedef {object} SlotRecord
 * @property {number} schemaVersion
 * @property {number} messageId
 * @property {number} slotId
 * @property {NaiCaption} caption
 * @property {string} anchorSentence
 * @property {SlotImageEntry[]} images 多次重生成追加；展示取最新
 * @property {string} createdAt
 * @property {string|null} presetId
 * @property {string|null} llmConfigId
 * @property {string} [worldInfoSnapshot] 解析出的世界书文本，供复现（架构 §6.3）
 * @property {string|null} [traceId]
 */

/**
 * @typedef {{ id?: string, now: string }} SlotDeps id 可选；slot 用 (messageId,slotId) 主键
 */

/**
 * @param {object} input
 * @returns {{ ok: true, value: SlotPlan } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function createSlotPlan(input) {
    requireArg(isPlainObject(input), 'input');
    return validateSlotPlan({
        slotId: input.slotId ?? input.slotid,
        anchorSentence: input.anchorSentence ?? input['生成点'] ?? '',
        caption: input.caption ?? input['生图内容'] ?? emptyNaiCaption(),
    });
}

/**
 * 从 LLM JSON 数组项构造（兼容中文键名 slotid / 生成点 / 生图内容）。
 * @param {unknown} item
 * @returns {{ ok: true, value: SlotPlan } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function slotPlanFromLlmItem(item) {
    if (!isPlainObject(item)) {
        return validationErr('SLOT_PLAN_SHAPE', '生图计划项格式无效');
    }
    return createSlotPlan(item);
}

/**
 * @param {object} input
 * @param {SlotDeps} deps
 * @returns {SlotRecord}
 */
export function createSlotRecord(input, deps) {
    requireArg(isPlainObject(input), 'input');
    requireArg(deps && isNonEmptyString(deps.now), 'deps');
    const captionResult = validateNaiCaption(input.caption ?? emptyNaiCaption());
    const caption = captionResult.ok ? captionResult.value : emptyNaiCaption();
    return {
        schemaVersion: SLOT_SCHEMA_VERSION,
        messageId: Number(input.messageId),
        slotId: Number(input.slotId),
        caption,
        anchorSentence: String(input.anchorSentence ?? ''),
        images: Array.isArray(input.images) ? input.images.map(normalizeImageEntry) : [],
        createdAt: deps.now,
        presetId: input.presetId == null ? null : String(input.presetId),
        llmConfigId: input.llmConfigId == null ? null : String(input.llmConfigId),
        worldInfoSnapshot: input.worldInfoSnapshot == null
            ? undefined
            : String(input.worldInfoSnapshot),
        traceId: input.traceId == null ? null : String(input.traceId),
    };
}

/**
 * @param {unknown} raw
 * @returns {SlotImageEntry}
 */
function normalizeImageEntry(raw) {
    if (!isPlainObject(raw)) {
        return {
            imageRef: '',
            createdAt: '',
            naiConfigId: null,
            artistId: null,
        };
    }
    return {
        imageRef: String(raw.imageRef ?? ''),
        createdAt: String(raw.createdAt ?? ''),
        naiConfigId: raw.naiConfigId == null ? null : String(raw.naiConfigId),
        artistId: raw.artistId == null ? null : String(raw.artistId),
    };
}

/**
 * @param {unknown} obj
 * @returns {{ ok: true, value: SlotPlan } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function validateSlotPlan(obj) {
    if (!isPlainObject(obj)) {
        return validationErr('SLOT_PLAN_SHAPE', '生图计划格式无效');
    }
    const slotId = Number(obj.slotId);
    if (!isIntInRange(slotId, 1, 9999)) {
        return validationErr('SLOT_PLAN_ID', 'slotId 必须是正整数');
    }
    if (typeof obj.anchorSentence !== 'string') {
        return validationErr('SLOT_PLAN_ANCHOR', '生成点必须是文本');
    }
    const cap = validateNaiCaption(obj.caption);
    if (!cap.ok) {
        return cap;
    }
    return validationOk(/** @type {SlotPlan} */ ({
        slotId,
        anchorSentence: obj.anchorSentence,
        caption: cap.value,
    }));
}

/**
 * @param {unknown} obj
 * @returns {{ ok: true, value: SlotRecord } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function validateSlotRecord(obj) {
    if (!isPlainObject(obj)) {
        return validationErr('SLOT_REC_SHAPE', 'Slot 记录格式无效');
    }
    if (!Number.isInteger(obj.messageId) || obj.messageId < 0) {
        return validationErr('SLOT_REC_MSG', 'messageId 无效');
    }
    if (!isIntInRange(Number(obj.slotId), 1, 9999)) {
        return validationErr('SLOT_REC_ID', 'slotId 无效');
    }
    const cap = validateNaiCaption(obj.caption);
    if (!cap.ok) {
        return cap;
    }
    return validationOk(/** @type {SlotRecord} */ ({
        schemaVersion: Number(obj.schemaVersion) || SLOT_SCHEMA_VERSION,
        messageId: Number(obj.messageId),
        slotId: Number(obj.slotId),
        caption: cap.value,
        anchorSentence: String(obj.anchorSentence ?? ''),
        images: Array.isArray(obj.images) ? obj.images.map(normalizeImageEntry) : [],
        createdAt: String(obj.createdAt ?? ''),
        presetId: obj.presetId == null ? null : String(obj.presetId),
        llmConfigId: obj.llmConfigId == null ? null : String(obj.llmConfigId),
        worldInfoSnapshot: obj.worldInfoSnapshot == null
            ? undefined
            : String(obj.worldInfoSnapshot),
        traceId: obj.traceId == null ? null : String(obj.traceId),
    }));
}

/**
 * 追加一张图到记录（不修改入参）。
 * @param {SlotRecord} record
 * @param {SlotImageEntry} entry
 * @returns {SlotRecord}
 */
export function appendSlotImage(record, entry) {
    requireArg(isPlainObject(record), 'record');
    requireArg(isPlainObject(entry), 'entry');
    return {
        ...record,
        images: [...(record.images ?? []), normalizeImageEntry(entry)],
    };
}

/**
 * @param {SlotRecord} record
 * @returns {SlotImageEntry|null}
 */
export function latestSlotImage(record) {
    if (!record || !Array.isArray(record.images) || record.images.length === 0) {
        return null;
    }
    return record.images[record.images.length - 1];
}

/**
 * @param {object} obj
 * @param {number} fromVersion
 * @returns {{ ok: true, value: SlotRecord } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function migrateSlotRecord(obj, fromVersion) {
    requireArg(isPlainObject(obj), 'obj');
    return validateSlotRecord({
        ...obj,
        schemaVersion: SLOT_SCHEMA_VERSION,
    });
}
