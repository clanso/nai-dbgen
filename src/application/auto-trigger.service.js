/**
 * L4 应用层 · 两个自动开关：自动写 slot / 自动出图（需求 4.12）。
 * 归属：W2-F。
 *
 * 裁决：
 * - D32：注入 bus，订阅 slots:written
 * - D35：出图闸门在 renderSlot 内；本层不再维护 rendering Set
 * - D38：已有 slot 记录则跳过（含回翻 swipe）；不重跑 LLM
 * - D39：读失败 warn + 跳过，绝不出图
 * - D54：写锁收归 generateSlots；本层不再维护 writing Set（避免与手点双轨）
 */

import { createLogger } from '../infra/logger.js';
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
 */

/**
 * @param {AutoTriggerDeps} deps
 * @returns {{ start: () => void, stop: () => void }}
 */
export function createAutoTriggerService(deps) {
    /** @type {(() => void)|null} */
    let unsubSettled = null;
    /** @type {(() => void)|null} */
    let unsubSlotsWritten = null;

    /**
     * @param {number} messageId
     * @returns {Promise<void>}
     */
    async function writeSlots(messageId) {
        const chatId = deps.host.getCurrentChatId();

        // D38 + D39：先查是否已有记录
        const existing = await deps.slotRepo.getByMessage(messageId);
        if (!existing.ok) {
            log.warn('autoWriteSlots: getByMessage failed; skip', {
                messageId,
                chatId,
                code: existing.error?.code,
            });
            return;
        }
        if (existing.value.length > 0) {
            // 已有记录（含回翻到已存在 swipe）→ 零计费跳过
            return;
        }

        // 二次确认（并发窗口；真正互斥在 generateSlots D54）
        const again = await deps.slotRepo.getByMessage(messageId);
        if (!again.ok) {
            log.warn('autoWriteSlots: re-check failed; skip', {
                messageId,
                code: again.error?.code,
            });
            return;
        }
        if (again.value.length > 0) {
            return;
        }
        if (deps.host.getCurrentChatId() !== chatId) {
            log.warn('autoWriteSlots: chat changed; skip', { messageId, chatId });
            return;
        }

        // D54：闸门在 generateSlots；与手点共享同一 Promise
        const r = await deps.generateSlots.execute(messageId);
        if (!r.ok) {
            log.warn('autoWriteSlots failed', {
                messageId,
                code: r.error?.code,
            });
        }
    }

    /**
     * 只出尚未生图的编号。闸门与「已有图」判断全在 renderSlot（D35）。
     * @param {number} messageId
     * @returns {Promise<void>}
     */
    async function renderPending(messageId) {
        const listR = await deps.slotRepo.getByMessage(messageId);
        if (!listR.ok) {
            // D39
            log.warn('autoRenderSlots: getByMessage failed; skip', {
                messageId,
                code: listR.error?.code,
            });
            return;
        }
        for (const record of listR.value) {
            // 读单条再确认：Err → 跳过（D39）；已有图由 renderSlot 拒紹
            const again = await deps.slotRepo.get(messageId, record.slotId);
            if (!again.ok) {
                log.warn('autoRenderSlots: get failed; skip slot', {
                    messageId,
                    slotId: record.slotId,
                    code: again.error?.code,
                });
                continue;
            }
            if (!again.value) {
                continue;
            }
            const r = await deps.renderSlot.execute(messageId, record.slotId);
            if (!r.ok
                && r.error?.code !== 'SLOT_ALREADY_RENDERED'
                && r.error?.code !== 'CHAT_CHANGED') {
                log.warn('autoRenderSlots failed', {
                    messageId,
                    slotId: record.slotId,
                    code: r.error?.code,
                });
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
                        await writeSlots(messageId);
                    } else if (settings.autoRenderSlots) {
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
