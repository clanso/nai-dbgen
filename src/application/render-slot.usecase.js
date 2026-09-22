/**
 * L4 应用层 · 步骤 7–8：按 slot 出图并记入仓库。
 * 归属：W2-F。
 *
 * 裁决：
 * - D34：注入 newTraceId
 * - D35：闸门在本 usecase 内（进行中互斥 + 已有图拒重出，除非 force）
 * - D36：键带 chatId；写盘前校验 chat，切楼则丢弃结果
 * - D39：读失败 ≠ 没有图
 * - D42：NAI/blob 成功但 recordImage 失败时保留 imageRef，重试只写盘
 */

import { Ok, Err } from '../infra/result.js';
import { domainError } from '../infra/errors.js';
import { createLogger } from '../infra/logger.js';
import { latestSlotImage } from '../domain/model/slot.js';
import {
    abortErrIfNeeded,
    attachTraceId,
    APP_EVENTS,
} from './_helpers.js';
import { renderGateKey } from './_gate-key.js';

const log = createLogger('application/render-slot');

/**
 * @typedef {object} RenderSlotDeps
 * @property {import('./image-gen.service.js').ImageGenService} imageGen
 * @property {import('../ports/repository.port.js').SlotRepository} slotRepo
 * @property {import('../ports/repository.port.js').ImageRepository} imageRepo
 * @property {import('../ports/host.port.js').HostPort} host
 *   D36：getCurrentChatId / onChatChanged
 * @property {ReturnType<import('../infra/event-bus.js').createEventBus>} bus
 * @property {() => string} nowIso
 * @property {() => string} newTraceId
 */

/**
 * @typedef {object} RenderSlotOptions
 * @property {AbortSignal} [signal]
 * @property {string} [traceId]
 * @property {boolean} [force]
 *   显式强制重出；默认 false。已有图且非 force → 拒紹（D35）
 * @property {string} [imageRef]
 *   D42：仅重试写盘（跳过 NAI / imageRepo.put）
 */

/**
 * @typedef {object} RenderSlotResult
 * @property {import('../domain/model/slot.js').SlotRecord} record
 * @property {import('../ports/image-gen.port.js').GeneratedImage} [image]
 *   仅写盘重试时可能缺省（无新 blob）
 * @property {string} traceId
 * @property {string} [imageRef]
 */

/**
 * @typedef {object} PendingWrite
 * @property {string} imageRef
 * @property {import('../ports/image-gen.port.js').GeneratedImage} [image]
 * @property {string|null} chatId
 * @property {number} messageId
 * @property {number} slotId
 */

/**
 * @param {RenderSlotDeps} deps
 * @returns {{
 *   execute: (messageId: number, slotId: number, opts?: RenderSlotOptions) => Promise<import('../infra/result.js').Ok<RenderSlotResult>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>,
 *   isRendering: (messageId: number, slotId: number) => boolean,
 *   hasPendingWrite: (messageId: number, slotId: number) => boolean,
 * }}
 */
export function createRenderSlotUseCase(deps) {
    /** @type {Map<string, Promise<import('../infra/result.js').Ok<RenderSlotResult>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>>} */
    const inflight = new Map();
    /** @type {Map<string, PendingWrite>} */
    const pendingWrites = new Map();
    // pendingWrites（已扣费待写盘）跨聊天保留；写盘前用 chatId 校验防写错楼（D36/D42）

    /**
     * @param {number} messageId
     * @param {number} slotId
     * @returns {string}
     */
    function currentKey(messageId, slotId) {
        return renderGateKey(deps.host.getCurrentChatId(), messageId, slotId);
    }

    /**
     * @param {number} messageId
     * @param {number} slotId
     * @param {RenderSlotOptions} [opts]
     */
    async function runOnce(messageId, slotId, opts) {
        const traceId = opts?.traceId ?? deps.newTraceId();
        const signal = opts?.signal;
        const force = opts?.force === true;
        const chatIdAtStart = deps.host.getCurrentChatId();
        const key = renderGateKey(chatIdAtStart, messageId, slotId);

        const aborted = abortErrIfNeeded(signal, traceId);
        if (aborted) {
            return aborted;
        }

        const slotR = await deps.slotRepo.get(messageId, slotId);
        if (!slotR.ok) {
            // D39：读失败 ≠ 没有；不得出图
            log.warn('slotRepo.get failed; refusing to render', {
                traceId,
                messageId,
                slotId,
                code: slotR.error?.code,
            });
            return attachTraceId(slotR, traceId);
        }
        if (!slotR.value) {
            return Err(domainError({
                code: 'SLOT_NOT_FOUND',
                message: `找不到 slot #${slotId}`,
                hint: '请先点「生图」生成提示词，或确认编号正确',
                traceId,
                context: { messageId, slotId, chatId: chatIdAtStart },
            }));
        }

        const record = slotR.value;
        const alreadyHasImage = latestSlotImage(record) != null;
        const pending = pendingWrites.get(key)
            ?? (opts?.imageRef
                ? {
                    imageRef: opts.imageRef,
                    chatId: chatIdAtStart,
                    messageId,
                    slotId,
                }
                : null);

        // D35：已有图且非 force，且不是 D42 写盘重试 → 拒紹
        if (alreadyHasImage && !force && !pending) {
            return Err(domainError({
                code: 'SLOT_ALREADY_RENDERED',
                message: `slot #${slotId} 已有图片`,
                hint: '重新出图请显式传入 force: true',
                traceId,
                context: { messageId, slotId, chatId: chatIdAtStart },
            }));
        }

        /** @type {string} */
        let imageRef;
        /** @type {import('../ports/image-gen.port.js').GeneratedImage|undefined} */
        let image;

        if (pending) {
            // D42：只重试写盘
            imageRef = pending.imageRef;
            image = pending.image;
        } else {
            const genR = await deps.imageGen.generate({
                caption: /** @type {import('../domain/model/nai-params.js').NaiCaption} */ (record.caption),
                replaceCharacterKeywords: false,
                signal,
                traceId,
            });
            if (!genR.ok) {
                return attachTraceId(genR, traceId);
            }
            if (!genR.value.length) {
                return Err(domainError({
                    code: 'NAI_NO_IMAGE',
                    message: '生图接口未返回图片',
                    hint: '请检查 NAI 配置与上游响应',
                    traceId,
                }));
            }
            image = genR.value[0];

            const putR = await deps.imageRepo.put(image.blob);
            if (!putR.ok) {
                return attachTraceId(putR, traceId);
            }
            imageRef = putR.value;
        }

        // D36：写盘前校验仍是发起时的 chat
        const chatNow = deps.host.getCurrentChatId();
        if (chatNow !== chatIdAtStart) {
            pendingWrites.set(key, {
                imageRef,
                image,
                chatId: chatIdAtStart,
                messageId,
                slotId,
            });
            log.warn('chat changed before recordImage; discarding write', {
                traceId,
                chatIdAtStart,
                chatNow,
                messageId,
                slotId,
            });
            return Err(domainError({
                code: 'CHAT_CHANGED',
                message: '出图完成时已切换聊天，结果未写入当前楼',
                hint: '切回原聊天后可重试（不会再次扣费，仅写盘）',
                traceId,
                context: {
                    imageRef,
                    chatIdAtStart,
                    chatNow,
                    messageId,
                    slotId,
                    retryableWrite: true,
                },
            }));
        }

        const recR = await deps.slotRepo.recordImage(messageId, slotId, imageRef, {
            createdAt: deps.nowIso(),
        });
        if (!recR.ok) {
            // D42：保留 imageRef，下次可只写盘
            pendingWrites.set(key, {
                imageRef,
                image,
                chatId: chatIdAtStart,
                messageId,
                slotId,
            });
            const err = attachTraceId(recR, traceId);
            if (err.error) {
                err.error.context = {
                    ...(err.error.context ?? {}),
                    imageRef,
                    retryableWrite: true,
                    messageId,
                    slotId,
                    chatId: chatIdAtStart,
                };
            }
            return err;
        }

        pendingWrites.delete(key);

        deps.bus.emit(APP_EVENTS.SLOT_RENDERED, {
            messageId,
            slotId,
            imageRef,
            traceId,
            chatId: chatIdAtStart,
            record: recR.value,
        });

        return Ok({
            record: recR.value,
            image,
            traceId,
            imageRef,
        });
    }

    return {
        /**
         * @param {number} messageId
         * @param {number} slotId
         * @param {RenderSlotOptions} [opts]
         */
        execute(messageId, slotId, opts) {
            const chatId = deps.host.getCurrentChatId();
            const key = renderGateKey(chatId, messageId, slotId);

            // D35：进行中互斥——并发调用共享同一 promise → NAI 只调一次
            const existing = inflight.get(key);
            if (existing) {
                return existing;
            }

            const promise = runOnce(messageId, slotId, opts).finally(() => {
                if (inflight.get(key) === promise) {
                    inflight.delete(key);
                }
            });
            inflight.set(key, promise);
            return promise;
        },

        /**
         * 供 UI（W2-G）查询：当前聊天下该 slot 是否正在出图。
         * @param {number} messageId
         * @param {number} slotId
         * @returns {boolean}
         */
        isRendering(messageId, slotId) {
            return inflight.has(currentKey(messageId, slotId));
        },

        /**
         * 是否有「已扣费待写盘」的挂起（D42）。
         * @param {number} messageId
         * @param {number} slotId
         * @returns {boolean}
         */
        hasPendingWrite(messageId, slotId) {
            return pendingWrites.has(currentKey(messageId, slotId));
        },
    };
}
