/**
 * L4 应用层 · 「本楼生图」：对最近 AI 楼（或显式 messageId）写 slot + 顺序出图。
 * 归属：悬浮球双击入口（编排 generateSlots → renderSlot）。
 *
 * 裁决：
 * - D36：闸门键 chatId:messageId；切聊天停止后续出图
 * - D38：已有 slot 记录不重跑 LLM
 * - D39：getByMessage Err → 直接返回，零计费
 * - D54 / D57：同键并发共享同一 Promise（合计只写一次、每 slot 只出一次）
 *
 * 完成语义（选定）：只要解析出 messageId 且读记录成功后流程走完（含中途切聊天 /
 * signal 中止 / 部分出图失败），一律返回 Ok(summary)。
 * UI 按 failed.length 显示 warning。不因「待出图全失败」改成 Err——
 * 摘要里的 wroteSlots / skipped / failed 对调用方都有用。
 */

import { Ok, Err } from '../infra/result.js';
import { domainError } from '../infra/errors.js';
import { createLogger } from '../infra/logger.js';
import { latestSlotImage } from '../domain/model/slot.js';
import { abortErrIfNeeded } from './_helpers.js';
import { writeGateKey } from './_gate-key.js';

const log = createLogger('application/generate-floor');

/**
 * 局部进度事件名（未进 APP_EVENTS；见交付报告契约变更申请）。
 * @type {Readonly<{ PROGRESS: string }>}
 */
export const FLOOR_EVENTS = Object.freeze({
    PROGRESS: 'floor:progress',
});

/**
 * @typedef {object} GenerateFloorSkipped
 * @property {number} slotId
 * @property {string} reason
 */

/**
 * @typedef {object} GenerateFloorFailed
 * @property {number} slotId
 * @property {string} message
 */

/**
 * @typedef {object} GenerateFloorSummary
 * @property {number} messageId
 * @property {boolean} wroteSlots
 * @property {number[]} rendered
 * @property {GenerateFloorSkipped[]} skipped
 * @property {GenerateFloorFailed[]} failed
 */

/**
 * @typedef {object} GenerateFloorOptions
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {object} GenerateFloorDeps
 * @property {import('../ports/host.port.js').HostPort} host
 * @property {import('../ports/repository.port.js').SlotRepository} slotRepo
 * @property {{
 *   execute: (messageId: number, opts?: { signal?: AbortSignal }) => Promise<
 *     import('../infra/result.js').Ok<{ records: import('../domain/model/slot.js').SlotRecord[] }>
 *     | import('../infra/result.js').Err<import('../infra/errors.js').AppError>
 *   >,
 *   isWriting: (messageId: number) => boolean,
 * }} generateSlots
 * @property {{
 *   execute: (messageId: number, slotId: number, opts?: { signal?: AbortSignal }) => Promise<
 *     import('../infra/result.js').Ok<unknown>
 *     | import('../infra/result.js').Err<import('../infra/errors.js').AppError>
 *   >,
 *   isRendering: (messageId: number, slotId: number) => boolean,
 * }} renderSlot
 * @property {ReturnType<import('../infra/logger.js').createLogger>} [logger]
 * @property {{ emit: (type: string, payload?: unknown) => void }} [bus]
 */

/**
 * @param {import('../infra/errors.js').AppError} err
 * @returns {string}
 */
function formatFailMessage(err) {
    const msg = err?.message ? String(err.message) : '出图失败';
    if (err?.hint) {
        return `${msg}；${err.hint}`;
    }
    return msg;
}

/**
 * @param {GenerateFloorDeps} deps
 * @returns {{
 *   execute: (messageId?: number, opts?: GenerateFloorOptions) => Promise<
 *     import('../infra/result.js').Ok<GenerateFloorSummary>
 *     | import('../infra/result.js').Err<import('../infra/errors.js').AppError>
 *   >,
 *   isRunning: (messageId?: number) => boolean,
 * }}
 */
export function createGenerateFloorUseCase(deps) {
    /** @type {Map<string, Promise<import('../infra/result.js').Ok<GenerateFloorSummary>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>>} */
    const inflight = new Map();

    /**
     * @param {number} [messageId]
     * @returns {import('../infra/result.js').Ok<number>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>}
     */
    function resolveMessageId(messageId) {
        if (typeof messageId === 'number' && Number.isFinite(messageId)) {
            return Ok(messageId);
        }
        const recent = deps.host.getRecentAiMessages(1);
        if (!Array.isArray(recent) || recent.length === 0) {
            return Err(domainError({
                code: 'NO_AI_MESSAGE',
                message: '当前聊天没有 AI 回复楼',
                hint: '先让 AI 回复一条再试',
            }));
        }
        return Ok(recent[0].messageId);
    }

    /**
     * @param {number} messageId
     * @param {GenerateFloorOptions} [opts]
     */
    async function runOnce(messageId, opts) {
        const signal = opts?.signal;
        const chatIdAtStart = deps.host.getCurrentChatId();
        /** @type {GenerateFloorSummary} */
        const summary = {
            messageId,
            wroteSlots: false,
            rendered: [],
            skipped: [],
            failed: [],
        };

        const aborted0 = abortErrIfNeeded(signal);
        if (aborted0) {
            return aborted0;
        }

        // D39：读失败 ≠ 没有记录
        const listR = await deps.slotRepo.getByMessage(messageId);
        if (!listR.ok) {
            log.warn('getByMessage failed; refusing write/render', {
                messageId,
                chatId: chatIdAtStart,
                code: listR.error?.code,
            });
            return listR;
        }

        /** @type {import('../domain/model/slot.js').SlotRecord[]} */
        let records = listR.value;

        if (records.length === 0) {
            // D38：确实没有 → 写 slot（闸门在 generateSlots）
            const genR = await deps.generateSlots.execute(messageId, { signal });
            if (!genR.ok) {
                return genR;
            }
            summary.wroteSlots = true;
            records = genR.value.records ?? [];
        }

        /** @type {Array<{ slotId: number, imageRef: string, writeOpts?: object, traceId?: string, chatId?: string|null }>} */
        const deferred = [];
        const parallel = deps.host.loadSettings?.()?.naiParallel === true;

        /**
         * @param {import('../domain/model/slot.js').SlotRecord} record
         * @param {number} index
         */
        async function renderOne(record, index) {
            const slotId = record.slotId;
            if (deps.bus) {
                deps.bus.emit(FLOOR_EVENTS.PROGRESS, {
                    messageId,
                    slotId,
                    phase: 'render',
                    index,
                    total: records.length,
                });
            }
            const r = await deps.renderSlot.execute(messageId, slotId, { signal, deferPersist: true });
            if (r.ok && r.value?.deferred) {
                deferred.push(r.value.deferred);
            } else if (r.ok) {
                summary.rendered.push(slotId);
            } else {
                summary.failed.push({
                    slotId,
                    message: formatFailMessage(r.error),
                });
            }
        }

        try {
        for (let i = 0; i < records.length; i += 1) {
            if (signal?.aborted) {
                break;
            }
            if (deps.host.getCurrentChatId() !== chatIdAtStart) {
                // D36：切聊天 → 当前及后续一律 skipped，不再出图
                for (let j = i; j < records.length; j += 1) {
                    summary.skipped.push({
                        slotId: records[j].slotId,
                        reason: 'chat-switched',
                    });
                }
                break;
            }

            const record = records[i];
            const slotId = record.slotId;

            if (latestSlotImage(record) != null) {
                summary.skipped.push({ slotId, reason: 'already-rendered' });
                continue;
            }

            if (parallel) {
                continue;
            }
            await renderOne(record, i);
        }

        if (parallel) {
            const jobs = [];
            for (let i = 0; i < records.length; i += 1) {
                const record = records[i];
                if (latestSlotImage(record) != null) {
                    continue;
                }
                jobs.push(renderOne(record, i));
            }
            await Promise.all(jobs);
        }
        } finally {
            if (deferred.length && typeof deps.renderSlot.commitRendered === 'function') {
                const committed = await deps.renderSlot.commitRendered(messageId, deferred);
                if (committed.ok) {
                    for (const item of deferred) {
                        summary.rendered.push(item.slotId);
                    }
                } else {
                    for (const item of deferred) {
                        summary.failed.push({
                            slotId: item.slotId,
                            message: formatFailMessage(committed.error),
                        });
                    }
                }
            }
        }

        return Ok(summary);
    }

    return {
        /**
         * @param {number} [messageId]
         * @param {GenerateFloorOptions} [opts]
         */
        execute(messageId, opts) {
            const resolved = resolveMessageId(messageId);
            if (!resolved.ok) {
                return Promise.resolve(resolved);
            }
            const mid = resolved.value;
            const key = writeGateKey(deps.host.getCurrentChatId(), mid);
            const existing = inflight.get(key);
            if (existing) {
                return existing;
            }
            const promise = runOnce(mid, opts).finally(() => {
                if (inflight.get(key) === promise) {
                    inflight.delete(key);
                }
            });
            inflight.set(key, promise);
            return promise;
        },

        /**
         * 悬浮球忙碌态：本用例 inflight ∪ generateSlots.isWriting。
         * renderSlot.isRendering 需 slotId，无法在无记录时合并（见契约变更申请）。
         * @param {number} [messageId]
         * @returns {boolean}
         */
        isRunning(messageId) {
            if (typeof messageId !== 'number' || !Number.isFinite(messageId)) {
                return inflight.size > 0;
            }
            const key = writeGateKey(deps.host.getCurrentChatId(), messageId);
            if (inflight.has(key)) {
                return true;
            }
            if (typeof deps.generateSlots.isWriting === 'function'
                && deps.generateSlots.isWriting(messageId)) {
                return true;
            }
            return false;
        },
    };
}
