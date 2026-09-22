/**
 * L2 适配器 · message.extra['nai-dbgen'] slot 权威记录（基线 §9）。
 * 归属：W1-D 存储代理实现。W0 仅冻结签名。
 *
 * swipe 行为（已核实）：
 * - syncMesToSwipe：`swipe_info[i].extra = structuredClone(message.extra)`（script.js:6939）
 * - syncSwipeToMes：`message.extra = structuredClone(swipe_info[i].extra) ?? {}`（script.js:7015）
 * 因此本命名空间随 swipe 整体克隆/还原；读写当前楼时只碰 HostPort，不直接碰全局 chat。
 *
 * **读语义**：读失败 / 数据损坏 → `Err`；真的没有数据 → `Ok({ slots: [] })`。
 * 二者绝不可混淆（避免 D23 叠加：读失败 → 空 slots → 空 liveRefs → GC 误删）。
 */

import { Ok, Err } from '../../infra/result.js';
import { configError, hostError } from '../../infra/errors.js';
import { createLogger } from '../../infra/logger.js';
import { isPlainObject } from '../../infra/validate.js';
import { SLOT_SCHEMA_VERSION, validateSlotRecord } from '../../domain/model/slot.js';

const log = createLogger('storage/message-extra');

/** @type {string} */
export const MESSAGE_EXTRA_NS = 'nai-dbgen';

/**
 * @typedef {{ schemaVersion: number, slots: import('../../domain/model/slot.js').SlotRecord[] }} NaiExtraPayload
 */

/**
 * 严格解析命名空间内容。`null`/`undefined`/缺 slots = 真没有数据（Ok 空）。
 * 类型损坏（非对象、slots 类型非法）= Err，不得伪装成空。
 *
 * @param {unknown} raw HostPort.readMessageExtra 返回值（已是 nai-dbgen 命名空间）
 * @returns {{ ok: true, value: NaiExtraPayload } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function parseNaiExtra(raw) {
    if (raw == null) {
        return Ok({ schemaVersion: SLOT_SCHEMA_VERSION, slots: [] });
    }
    if (!isPlainObject(raw)) {
        return Err(hostError({
            code: 'MESSAGE_EXTRA_CORRUPT',
            message: 'message.extra[nai-dbgen] 格式损坏',
            hint: '请勿手动编辑聊天 JSON 中的 nai-dbgen 字段；必要时从备份恢复该楼',
            context: { typeofRaw: typeof raw },
        }));
    }
    if (raw.slots != null && !Array.isArray(raw.slots) && !isPlainObject(raw.slots)) {
        return Err(hostError({
            code: 'MESSAGE_EXTRA_CORRUPT',
            message: 'message.extra[nai-dbgen].slots 类型无效',
            hint: '权威 slots 必须是数组或对象映射',
            context: { slotsType: typeof raw.slots },
        }));
    }
    return Ok(normalizeNaiExtra(raw));
}

/**
 * 软归一化：用于 collectLiveRefs 等「尽量多收集、跳过坏片段」场景。
 * **不要**在权威读路径用本函数吞掉损坏（权威读请用 `parseNaiExtra`）。
 *
 * @param {unknown} raw
 * @returns {NaiExtraPayload}
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
 *   read: (messageId: number) => import('../../infra/result.js').Ok<NaiExtraPayload>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>,
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
         * 读当前楼的 nai-dbgen 命名空间。
         * - 宿主抛错 → Err(MESSAGE_EXTRA_READ_FAILED)
         * - 内容损坏 → Err(MESSAGE_EXTRA_CORRUPT)
         * - 缺失/空 → Ok({ slots: [] })
         * @param {number} messageId
         */
        read(messageId) {
            try {
                const raw = host.readMessageExtra(messageId);
                return parseNaiExtra(raw);
            } catch (cause) {
                return Err(hostError({
                    code: 'MESSAGE_EXTRA_READ_FAILED',
                    message: '读取 message.extra 失败',
                    hint: '请刷新后重试；勿将读失败当作「没有 slot」去跑 GC',
                    cause,
                    context: { messageId },
                }));
            }
        },

        /**
         * 合并写入。patch.slots 若提供则整表替换 slots。
         * 非法 slot：**不静默成功**——logger.warn + Err，且不落盘。
         * @param {number} messageId
         * @param {object} patch
         */
        async write(messageId, patch) {
            try {
                const currentResult = parseNaiExtra(host.readMessageExtra(messageId));
                if (!currentResult.ok) {
                    return currentResult;
                }
                const current = currentResult.value;
                /** @type {Record<string, unknown>} */
                const next = {
                    schemaVersion: SLOT_SCHEMA_VERSION,
                    slots: current.slots,
                };

                if (isPlainObject(patch)) {
                    if (Array.isArray(patch.slots)) {
                        /** @type {import('../../domain/model/slot.js').SlotRecord[]} */
                        const slots = [];
                        /** @type {string[]} */
                        const dropped = [];
                        for (const item of patch.slots) {
                            const withMsg = isPlainObject(item)
                                ? { ...item, messageId: Number(messageId) }
                                : item;
                            const v = validateSlotRecord(withMsg);
                            if (v.ok) {
                                slots.push(v.value);
                            } else {
                                const reason = v.error?.message || '校验失败';
                                dropped.push(reason);
                                log.warn('丢弃非法 slot', { messageId, reason, item });
                            }
                        }
                        if (dropped.length > 0) {
                            return Err(configError({
                                code: 'MESSAGE_EXTRA_SLOT_INVALID',
                                message: `${dropped.length} 条 slot 校验失败，未写入`,
                                hint: '请检查 caption / slotId / messageId 后重试',
                                context: { messageId, droppedCount: dropped.length, reasons: dropped },
                            }));
                        }
                        next.slots = slots.sort((a, b) => a.slotId - b.slotId);
                    } else if (patch.slots != null && !Array.isArray(patch.slots)) {
                        return Err(hostError({
                            code: 'MESSAGE_EXTRA_SLOTS_SHAPE',
                            message: 'message.extra slots 必须是数组',
                            context: { messageId },
                        }));
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
