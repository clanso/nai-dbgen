/**
 * L4 应用层 · 两个自动开关：自动写 slot / 自动出图（需求 4.12）。
 * 归属：W2-F 用例代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {object} AutoTriggerDeps
 * @property {import('../ports/host.port.js').HostPort} host
 * @property {ReturnType<import('./generate-slots.usecase.js').createGenerateSlotsUseCase>} generateSlots
 * @property {ReturnType<import('./render-slot.usecase.js').createRenderSlotUseCase>} renderSlot
 * @property {import('../ports/repository.port.js').SlotRepository} slotRepo
 * @property {() => object} loadSettings
 */

/**
 * 订阅 onAiMessageSettled；按开关触发写 slot / 对尚未生图编号出图。
 * @param {AutoTriggerDeps} deps
 * @returns {{ start: () => void, stop: () => void }}
 */
export function createAutoTriggerService(deps) {
    throw new Error('not implemented: createAutoTriggerService');
}
