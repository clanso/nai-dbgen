/**
 * L2 适配器 · message.extra['nai-dbgen'] slot 权威记录（基线 §9）。
 * 归属：W1-D 存储代理实现。W0 仅冻结签名。
 *
 * swipe 行为（已核实）：
 * - syncMesToSwipe：`swipe_info[i].extra = structuredClone(message.extra)`（script.js:6939）
 * - syncSwipeToMes：`message.extra = structuredClone(swipe_info[i].extra) ?? {}`（script.js:7015）
 * 因此本命名空间随 swipe 整体克隆/还原；读写当前楼时只碰 HostPort，不直接碰全局 chat。
 */

import { Ok, Err } from '../../infra/result.js';
import { hostError } from '../../infra/errors.js';
import { isPlainObject } from '../../infra/validate.js';
import { SLOT_SCHEMA_VERSION, validateSlotRecord } from '../../domain/model/slot.js';

/** @type {string} */
export const MESSAGE_EXTRA_NS = 'nai-dbgen';

/**
 * @param {unknown} raw
 * @returns {{ schemaVersion: number, slots: import('../../domain/model/slot.js').SlotRecord[] }}
 */
export function normalizeNaiExtra(raw) {
    if (!isPlainObject(raw)) {
        return { schemaVersion: SLOT_SCHEMA_VERSION, slots: [] };
    }
    const schemaVersion = Number(raw.schemaVersion) || SLOT_SCHEMA_VERSION;
    /** @type {import('../../domain/model/slot.js').SlotRecord[]} */
    const slots = [];
    if (Array.isArray(raw.slots)) {
        for (const item of raw.slots) {
            const v = validateSlotRecord(item);
            if (v.ok) {
                slots.push(v.value);
            }
        }
    } else if (isPlainObject(raw.slots)) {
        for (const item of Object.values(raw.slots)) {
            const v = validateSlotRecord(item);
            if (v.ok) {
                slots.push(v.value);
            }
        }
    }
    slots.sort((a, b) => a.slotId - b.slotId);
    return { schemaVersion, slots };
}

/**
 * @param {object} deps
 * @param {import('../../ports/host.port.js').HostPort} deps.host
 * @returns {{
 *   read: (messageId: number) => object,
 *   write: (messageId: number, patch: object) => Promise<import('../../infra/result.js').Ok<void>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>,
 * }}
 */
export function createMessageExtraStore(deps) {
    const host = deps?.host;
    if (!host || typeof host.readMessageExtra !== 'function' || typeof host.writeMessageExtra !== 'function') {
        throw new Error('createMessageExtraStore requires deps.host with readMessageExtra/writeMessageExtra');
    }

    return {
        /**
         * 读当前楼的 nai-dbgen 命名空间。容忍 extra 缺失 / 污染。
         * @param {number} messageId
         * @returns {object}
         */
        read(messageId) {
            try {
                const raw = host.readMessageExtra(messageId);
                return normalizeNaiExtra(raw);
            } catch {
                return normalizeNaiExtra(null);
            }
        },

        /**
         * 合并写入。patch.slots 若提供则整表替换 slots；其它键浅合并。
         * @param {number} messageId
         * @param {object} patch
         */
        async write(messageId, patch) {
            try {
                const current = normalizeNaiExtra(host.readMessageExtra(messageId));
                /** @type {Record<string, unknown>} */
                const next = {
                    schemaVersion: SLOT_SCHEMA_VERSION,
                    slots: current.slots,
                };

                if (isPlainObject(patch)) {
                    if (Array.isArray(patch.slots)) {
                        const slots = [];
                        for (const item of patch.slots) {
                            const withMsg = isPlainObject(item)
                                ? { ...item, messageId: Number(messageId) }
                                : item;
                            const v = validateSlotRecord(withMsg);
                            if (v.ok) {
                                slots.push(v.value);
                            }
                        }
                        next.slots = slots.sort((a, b) => a.slotId - b.slotId);
                    } else if (patch.slots != null && !Array.isArray(patch.slots)) {
                        return Err(hostError({
                            code: 'MESSAGE_EXTRA_SLOTS_SHAPE',
                            message: 'message.extra slots 必须是数组',
                            context: { messageId },
                        }));
                    }
                    for (const [k, v] of Object.entries(patch)) {
                        if (k === 'slots' || k === 'schemaVersion') {
                            continue;
                        }
                        // 未知键丢弃，避免污染权威记录
                    }
                }

                const result = await host.writeMessageExtra(messageId, next);
                if (result && result.ok === false) {
                    return result;
                }
                return Ok(undefined);
            } catch (cause) {
                return Err(hostError({
                    code: 'MESSAGE_EXTRA_WRITE_FAILED',
                    message: '写入 message.extra 失败',
                    cause,
                    context: { messageId },
                }));
            }
        },
    };
}
