/**
 * L4 应用层 · 步骤 7–8：按 slot 出图并记入仓库。
 * 归属：W2-F 用例代理实现。W0 仅冻结签名。
 * replaceCharacterKeywords 百分之百传 false。
 */

/**
 * @typedef {object} RenderSlotDeps
 * @property {import('./image-gen.service.js').ImageGenService} imageGen
 * @property {import('../ports/repository.port.js').SlotRepository} slotRepo
 * @property {import('../ports/repository.port.js').ImageRepository} imageRepo
 * @property {ReturnType<import('../infra/event-bus.js').createEventBus>} bus
 * @property {() => string} nowIso
 */

/**
 * @typedef {object} RenderSlotResult
 * @property {import('../domain/model/slot.js').SlotRecord} record
 * @property {import('../ports/image-gen.port.js').GeneratedImage} image
 * @property {string} traceId
 */

/**
 * @param {RenderSlotDeps} deps
 * @returns {{ execute: (messageId: number, slotId: number, opts?: { signal?: AbortSignal }) => Promise<import('../infra/result.js').Ok<RenderSlotResult>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>> }}
 */
export function createRenderSlotUseCase(deps) {
    throw new Error('not implemented: createRenderSlotUseCase');
}
