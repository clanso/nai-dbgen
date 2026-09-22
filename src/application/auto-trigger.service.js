/**
 * L4 应用层 · 两个自动开关：自动写 slot / 自动出图（需求 4.12）。
 * 归属：W2-F 用例代理实现。
 * 裁决 D32：注入 bus，订阅 `slots:written`；禁止包装 generateSlots.execute。
 */

import { createLogger } from '../infra/logger.js';
import { latestSlotImage } from '../domain/model/slot.js';
import { APP_EVENTS } from './_helpers.js';

const log = createLogger('application/auto-trigger');

/**
 * @typedef {import('../domain/model/plugin-settings.js').PluginSettings} PluginSettings
 */

/**
 * @typedef {object} AutoTriggerDeps
 * @property {import('../ports/host.port.js').HostPort} host
 * @property {ReturnType<import('./generate-slots.usecase.js').createGenerateSlotsUseCase>} generateSlots
 * @property {ReturnType<import('./render-slot.usecase.js').createRenderSlotUseCase>} renderSlot
 * @property {import('../ports/repository.port.js').SlotRepository} slotRepo
 * @property {() => PluginSettings} loadSettings
 * @property {ReturnType<import('../infra/event-bus.js').createEventBus>} bus
 *   裁决 D32：订阅 slots:written，覆盖「只开自动出图 + 手点生图」
 */

/**
 * 订阅 onAiMessageSettled 与 slots:written；按开关触发写 slot / 对尚未生图编号出图。
 * @param {AutoTriggerDeps} deps
 * @returns {{ start: () => void, stop: () => void }}
 */
export function createAutoTriggerService(deps) {
    /** @type {(() => void)|null} */
    let unsubSettled = null;
    /** @type {(() => void)|null} */
    let unsubSlotsWritten = null;

    /** @type {Set<number>} 正在写 slot 的楼，防重复计费 */
    const writing = new Set();
    /** @type {Set<string>} `${messageId}:${slotId}` 正在出图 */
    const rendering = new Set();

    /**
     * @param {number} messageId
     */
    async function writeSlots(messageId) {
        if (writing.has(messageId)) {
            return;
        }
        writing.add(messageId);
        try {
            const r = await deps.generateSlots.execute(messageId);
            if (!r.ok) {
                log.warn('autoWriteSlots failed', {
                    messageId,
                    code: r.error?.code,
                });
            }
            // 自动出图由 slots:written 事件驱动，不在此处直接 render
        } finally {
            writing.delete(messageId);
        }
    }

    /**
     * 只出尚未生图的编号；已有 images 的跳过（需求 4.12）。
     * @param {number} messageId
     */
    async function renderPending(messageId) {
        const listR = await deps.slotRepo.getByMessage(messageId);
        if (!listR.ok) {
            log.warn('autoRenderSlots: getByMessage failed', {
                messageId,
                code: listR.error?.code,
            });
            return;
        }
        for (const record of listR.value) {
            if (latestSlotImage(record)) {
                continue;
            }
            const key = `${messageId}:${record.slotId}`;
            if (rendering.has(key)) {
                continue;
            }
            rendering.add(key);
            try {
                const again = await deps.slotRepo.get(messageId, record.slotId);
                if (again.ok && again.value && latestSlotImage(again.value)) {
                    continue;
                }
                const r = await deps.renderSlot.execute(messageId, record.slotId);
                if (!r.ok) {
                    log.warn('autoRenderSlots failed', {
                        messageId,
                        slotId: record.slotId,
                        code: r.error?.code,
                    });
                }
            } finally {
                rendering.delete(key);
            }
        }
    }

    /**
     * @param {unknown} payload
     */
    function onSlotsWritten(payload) {
        if (!deps.loadSettings().autoRenderSlots) {
            return;
        }
        const messageId = payload && typeof payload === 'object'
            ? /** @type {{ messageId?: number }} */ (payload).messageId
            : undefined;
        if (typeof messageId !== 'number') {
            return;
        }
        void renderPending(messageId);
    }

    return {
        start() {
            if (!unsubSlotsWritten) {
                unsubSlotsWritten = deps.bus.on(APP_EVENTS.SLOTS_WRITTEN, onSlotsWritten);
            }
            if (unsubSettled) {
                return;
            }
            unsubSettled = deps.host.onAiMessageSettled((messageId) => {
                void (async () => {
                    const settings = deps.loadSettings();
                    if (settings.autoWriteSlots) {
                        // 写 slot → emit slots:written → 若开了 autoRender 则出图
                        await writeSlots(messageId);
                    } else if (settings.autoRenderSlots) {
                        // 仅自动出图：对本楼已有、尚未生图的 slot 出图
                        await renderPending(messageId);
                    }
                })();
            });
        },

        stop() {
            if (unsubSettled) {
                unsubSettled();
                unsubSettled = null;
            }
            if (unsubSlotsWritten) {
                unsubSlotsWritten();
                unsubSlotsWritten = null;
            }
        },
    };
}
