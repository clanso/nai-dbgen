/**
 * L4 应用层 · 步骤 7–8：按 slot 出图并记入仓库。
 * 归属：W2-F 用例代理实现。
 * replaceCharacterKeywords 百分之百传 false。
 * 裁决 D34：注入 newTraceId，与 generateSlots 对称、可测。
 */

import { Ok, Err } from '../infra/result.js';
import { domainError } from '../infra/errors.js';
import {
    abortErrIfNeeded,
    attachTraceId,
    APP_EVENTS,
} from './_helpers.js';

/**
 * @typedef {object} RenderSlotDeps
 * @property {import('./image-gen.service.js').ImageGenService} imageGen
 * @property {import('../ports/repository.port.js').SlotRepository} slotRepo
 * @property {import('../ports/repository.port.js').ImageRepository} imageRepo
 * @property {ReturnType<import('../infra/event-bus.js').createEventBus>} bus
 * @property {() => string} nowIso
 * @property {() => string} newTraceId 裁决 D34
 */

/**
 * @typedef {object} RenderSlotResult
 * @property {import('../domain/model/slot.js').SlotRecord} record
 * @property {import('../ports/image-gen.port.js').GeneratedImage} image
 * @property {string} traceId
 */

/**
 * @param {RenderSlotDeps} deps
 * @returns {{ execute: (messageId: number, slotId: number, opts?: { signal?: AbortSignal, traceId?: string }) => Promise<import('../infra/result.js').Ok<RenderSlotResult>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>> }}
 */
export function createRenderSlotUseCase(deps) {
    return {
        /**
         * @param {number} messageId
         * @param {number} slotId
         * @param {{ signal?: AbortSignal, traceId?: string }} [opts]
         */
        async execute(messageId, slotId, opts) {
            // 出图链路独立 trace，不与 generateSlots 的两次 LLM 混用
            const traceId = opts?.traceId ?? deps.newTraceId();
            const signal = opts?.signal;

            const aborted = abortErrIfNeeded(signal, traceId);
            if (aborted) {
                return aborted;
            }

            const slotR = await deps.slotRepo.get(messageId, slotId);
            if (!slotR.ok) {
                return attachTraceId(slotR, traceId);
            }
            if (!slotR.value) {
                return Err(domainError({
                    code: 'SLOT_NOT_FOUND',
                    message: `找不到 slot #${slotId}`,
                    hint: '请先点「生图」生成提示词，或确认编号正确',
                    traceId,
                    context: { messageId, slotId },
                }));
            }

            const record = slotR.value;

            // 需求：基于上下文的点按钮百分之百传关
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

            const image = genR.value[0];
            const putR = await deps.imageRepo.put(image.blob);
            if (!putR.ok) {
                return attachTraceId(putR, traceId);
            }
            const imageRef = putR.value;

            const recR = await deps.slotRepo.recordImage(messageId, slotId, imageRef, {
                createdAt: deps.nowIso(),
            });
            if (!recR.ok) {
                return attachTraceId(recR, traceId);
            }

            deps.bus.emit(APP_EVENTS.SLOT_RENDERED, {
                messageId,
                slotId,
                imageRef,
                traceId,
                record: recR.value,
            });

            return Ok({
                record: recR.value,
                image,
                traceId,
            });
        },
    };
}
