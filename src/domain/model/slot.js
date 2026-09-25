/**
 * L3 领域模型 · SlotPlan / SlotRecord（架构文档 §5.3）。
 * 会话内主键 slotId；权威记录在服务器会话文件（需求 4.17）。
 * 归属：W0 契约冻结。
 */

import {
    isIntInRange,
    isNonEmptyString,
    isPlainObject,
    requireArg,
    schemaVersionMismatch,
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
 * @property {string} [size] 「尺寸」：`"宽x高"`；空则不存
 * @property {string} [analysis] 「解析」文本；空则不存
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
 * @property {string} [worldInfoSnapshot] 世界书文本快照，供复现（架构 §6.3）
 * @property {string|null} [traceId]
 * @property {string} [size] 「尺寸」：`"宽x高"`；没有则不存
 * @property {string} [analysis] 「解析」；没有则不存
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
        anchorSentence: input.anchorSentence ?? input.anchor ?? input['生成点'] ?? '',
        caption: input.caption ?? input['生图内容'] ?? emptyNaiCaption(),
    });
}

/**
 * 从 LLM JSON 数组项构造（可读中文键名 slotid / 生成点 / 生图内容）。
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
 * 步骤 5 新格式：模型回 slotid + 生图内容，可选尺寸 / 解析（不回生成点）。
 * @param {unknown} item
 * @returns {{ ok: true, value: { slotId: number, caption: NaiCaption, size?: string, analysis?: string } } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function slotCaptionFromLlmItem(item) {
    if (!isPlainObject(item)) {
        return validationErr('SLOT_PLAN_SHAPE', '生图计划项格式无效');
    }
    const slotId = Number(item.slotId ?? item.slotid);
    if (!isIntInRange(slotId, 1, 9999)) {
        return validationErr('SLOT_PLAN_ID', 'slotId 必须是正整数');
    }
    const cap = validateNaiCaption(item.caption ?? item['生图内容'] ?? emptyNaiCaption());
    if (!cap.ok) {
        return cap;
    }
    /** @type {{ slotId: number, caption: NaiCaption, size?: string, analysis?: string }} */
    const value = { slotId, caption: cap.value };
    const size = optionalLlmText(item.size ?? item['尺寸']);
    if (size != null) {
        value.size = size;
    }
    const analysis = optionalLlmText(item.analysis ?? item['解析']);
    if (analysis != null) {
        value.analysis = analysis;
    }
    return validationOk(value);
}

/**
 * LLM 可选文本字段：空串 / 非字符串 → 视为未写。
 * @param {unknown} raw
 * @returns {string|null}
 */
function optionalLlmText(raw) {
    if (typeof raw !== 'string') {
        return null;
    }
    const t = raw.trim();
    return t.length > 0 ? t : null;
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
    /** @type {SlotRecord} */
    const rec = {
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
    const size = optionalLlmText(input.size);
    if (size != null) {
        rec.size = size;
    }
    const analysis = optionalLlmText(input.analysis);
    if (analysis != null) {
        rec.analysis = analysis;
    }
    return rec;
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
    const ver = schemaVersionMismatch(obj, SLOT_SCHEMA_VERSION, 'SLOT_REC_SCHEMA', 'Slot 记录');
    if (ver) {
        return ver;
    }
    /** @type {SlotRecord} */
    const value = {
        schemaVersion: SLOT_SCHEMA_VERSION,
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
    };
    const size = optionalLlmText(obj.size);
    if (size != null) {
        value.size = size;
    }
    const analysis = optionalLlmText(obj.analysis);
    if (analysis != null) {
        value.analysis = analysis;
    }
    return validationOk(value);
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

