/**
 * L4 应用层 · 步骤 7–8：按 slot 出图并记入仓库。
 * 归属：W2-F。
 *
 * 裁决：
 * - D34：注入 newTraceId
 * - D35：闸门在本 usecase 内（进行中互斥 + 已有图拒重出，除非 force）
 * - D36：键带 chatId；切聊后仍写入发起时会话文件，楼层正文仅同会话才改
 * - D39：读失败 ≠ 没有图
 * - D42：NAI/blob 成功但 recordImage 失败时保留 imageRef，重试只写盘
 */

import { Ok, Err } from '../infra/result.js';
import { domainError } from '../infra/errors.js';
import { createLogger } from '../infra/logger.js';
import { latestSlotImage } from '../domain/model/slot.js';
import { parseSizeSpec } from '../domain/model/size-spec.js';
import {
    abortErrIfNeeded,
    attachTraceId,
    APP_EVENTS,
} from './_helpers.js';
import { renderGateKey } from './_gate-key.js';

const log = createLogger('application/render-slot');

/**
 * @param {{ recordImage: Function }} slotRepo
 * @param {number} messageId
 * @param {Array<{ slotId: number, imageRef: string, writeOpts?: object }>} list
 */
async function recordImagesOneByOne(slotRepo, messageId, list) {
    /** @type {object[]} */
    const rows = [];
    for (const item of list) {
        const one = await slotRepo.recordImage(
            messageId,
            item.slotId,
            item.imageRef,
            {},
            item.writeOpts,
        );
        if (!one.ok) {
            return one;
        }
        rows.push(one.value);
    }
    return Ok(rows);
}

/** D42 挂起写盘上限：跨聊天保留但不无限增长（FIFO 淘汰最旧项） */
const MAX_PENDING_WRITES = 32;

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
 * @property {boolean} [deferPersist]
 *   同一楼多张图时先出图，最后一次写入会话文件
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
    // 上限 MAX_PENDING_WRITES：FIFO 淘汰，避免跳聊天永久泄漏

    /**
     * @param {string} key
     * @param {PendingWrite} entry
     */
    function rememberPending(key, entry) {
        if (pendingWrites.has(key)) {
            pendingWrites.delete(key);
        }
        pendingWrites.set(key, entry);
        while (pendingWrites.size > MAX_PENDING_WRITES) {
            const oldest = pendingWrites.keys().next().value;
            if (oldest == null) {
                break;
            }
            pendingWrites.delete(oldest);
            log.warn('pendingWrites capped; evicted oldest', {
                evictedKey: oldest,
                max: MAX_PENDING_WRITES,
            });
        }
    }

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
        const sessionIdAtStart = typeof deps.host.getSessionId === 'function'
            ? deps.host.getSessionId()
            : null;
        const messagesAtStart = typeof deps.host.getMessages === 'function'
            ? deps.host.getMessages()
            : [];
        const locationAtStart = typeof deps.host.getChatLocation === 'function'
            ? deps.host.getChatLocation()
            : null;
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
                message: `找不到第 ${slotId} 号生图标记`,
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
                hint: '该图已生成过；若要重出请点「重新生成」',
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
            /** @type {Record<string, unknown>|undefined} */
            let params;
            if (typeof record.size === 'string' && record.size.trim()) {
                const sizeR = parseSizeSpec(record.size);
                if (!sizeR.ok) {
                    return attachTraceId(sizeR, traceId);
                }
                params = {
                    width: sizeR.value.width,
                    height: sizeR.value.height,
                };
            }
            const genR = await deps.imageGen.generate({
                caption: /** @type {import('../domain/model/nai-params.js').NaiCaption} */ (record.caption),
                replaceCharacterKeywords: false,
                ...(params ? { params } : {}),
                signal,
                traceId,
                shouldStart: () => deps.host.getCurrentChatId() === chatIdAtStart,
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

        // 会话文件按 integrity 寻址：切到 B 后仍须把图记进发起时的 A 会话文件。
        // inflight 键仍带 chatId（D36），避免 B 会话误显「生图中」。
        const chatNow = deps.host.getCurrentChatId();
        const writeOpts = sessionIdAtStart
            ? {
                sessionId: String(sessionIdAtStart),
                messagesForTrim: messagesAtStart,
                chatLocation: locationAtStart,
            }
            : undefined;

        if (opts?.deferPersist === true) {
            rememberPending(key, { imageRef, image, chatId: chatIdAtStart, messageId, slotId });
            return Ok({
                record: null,
                image,
                traceId,
                imageRef,
                chatChanged: chatNow !== chatIdAtStart,
                deferEmit: true,
                deferred: {
                    messageId,
                    slotId,
                    imageRef,
                    writeOpts,
                    traceId,
                    chatId: chatIdAtStart,
                },
            });
        }

        const recR = await deps.slotRepo.recordImage(
            messageId,
            slotId,
            imageRef,
            { createdAt: deps.nowIso() },
            writeOpts,
        );
        if (!recR.ok) {
            // D42：保留 imageRef，下次可只写盘
            rememberPending(key, {
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
                    sessionId: sessionIdAtStart,
                    chatChanged: chatNow !== chatIdAtStart,
                };
            }
            return err;
        }

        pendingWrites.delete(key);

        if (chatNow !== chatIdAtStart) {
            log.info('chat changed after NAI; image recorded to original session file', {
                traceId,
                chatIdAtStart,
                chatNow,
                sessionIdAtStart,
                messageId,
                slotId,
            });
        }

        return Ok({
            record: recR.value,
            image,
            traceId,
            imageRef,
            chatChanged: chatNow !== chatIdAtStart,
        });
    }

    /**
     * inflight 清表后再发 bus：订阅方（slot 控件）刷新时 isRendering 已为 false。
     * 若在 runOnce 内同步 emit，控件会在 finally 之前 paint，永久卡在「生图中」。
     * @param {number} messageId
     * @param {number} slotId
     * @param {string|null} chatId
     * @param {import('../infra/result.js').Ok<RenderSlotResult>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>} result
     */
    function emitAfterSettle(messageId, slotId, chatId, result) {
        if (result && result.ok) {
            const value = result.value;
            deps.bus.emit(APP_EVENTS.SLOT_RENDERED, {
                messageId,
                slotId,
                imageRef: value.imageRef,
                traceId: value.traceId,
                chatId,
                record: value.record,
            });
            return;
        }
        const error = result && result.error != null ? result.error : result;
        const traceId = error && typeof error === 'object'
            && /** @type {{ traceId?: unknown }} */ (error).traceId != null
            ? String(/** @type {{ traceId: unknown }} */ (error).traceId)
            : undefined;
        deps.bus.emit(APP_EVENTS.SLOT_RENDER_FAILED, {
            messageId,
            slotId,
            chatId,
            error,
            traceId,
        });
    }

    return {
        /**
         * @param {number} messageId
         * @param {number} slotId
         * @param {RenderSlotOptions} [opts]
         */
        execute(messageId, slotId, opts) {
            if (deps.isEditing?.(messageId)) return Promise.resolve(Err(domainError({
                code: 'SLOT_EDITOR_BUSY', message: '本楼提示词正在保存，请稍后再试',
            })));
            const chatId = deps.host.getCurrentChatId();
            const key = renderGateKey(chatId, messageId, slotId);

            // D35：进行中互斥——并发调用共享同一 Promise → NAI 只调一次
            const existing = inflight.get(key);
            if (existing) {
                return existing;
            }

            /** @type {Promise<import('../infra/result.js').Ok<RenderSlotResult>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} */
            let promise;
            promise = runOnce(messageId, slotId, opts)
                .finally(() => {
                    if (inflight.get(key) === promise) {
                        inflight.delete(key);
                    }
                })
                .then((result) => {
                    if (!(result?.ok && result.value?.deferEmit)) {
                        emitAfterSettle(messageId, slotId, chatId, result);
                    }
                    return result;
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

        /**
         * 把同一楼已经出好的图记进会话文件，只写一次。
         * @param {number} messageId
         * @param {Array<{ slotId: number, imageRef: string, writeOpts?: object, traceId?: string, chatId?: string|null }>} items
         */
        async commitRendered(messageId, items) {
            const list = Array.isArray(items) ? items : [];
            if (!list.length) {
                return Ok([]);
            }
            const recR = typeof deps.slotRepo.recordImages === 'function'
                ? await deps.slotRepo.recordImages(
                    messageId,
                    list.map((item) => ({ slotId: item.slotId, imageRef: item.imageRef })),
                    list[0].writeOpts,
                )
                : await recordImagesOneByOne(deps.slotRepo, messageId, list);
            if (!recR.ok) {
                return recR;
            }
            for (const item of list) {
                pendingWrites.delete(renderGateKey(item.chatId ?? null, messageId, item.slotId));
                const record = recR.value.find((row) => row.slotId === item.slotId) ?? null;
                deps.bus.emit(APP_EVENTS.SLOT_RENDERED, {
                    messageId,
                    slotId: item.slotId,
                    imageRef: item.imageRef,
                    traceId: item.traceId,
                    chatId: item.chatId ?? null,
                    record,
                });
            }
            return Ok(recR.value);
        },
    };
}
