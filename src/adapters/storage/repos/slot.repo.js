/**
 * L2 适配器 · SlotRecord（含 getByMessage / recordImage） 仓库。
 * 归属：W1-D 存储代理实现。W0 仅冻结签名。
 *
 * 双写（裁决 D12）：
 * - 权威：message.extra['nai-dbgen'].slots（经 messageExtra / HostPort）
 * - 派生：IndexedDB slot_index（可重建；不一致时以 extra 为准）
 * - 图片二进制只走 ImageRepository，本仓库只存 imageRef
 *
 * 读失败绝不当作空权威（否则 reconcile 会误删索引 / GC 会误删图）。
 */

import { Ok, Err, isErr } from '../../../infra/result.js';
import { configError, hostError } from '../../../infra/errors.js';
import { nowIso } from '../../../infra/clock.js';
import { mapIdbError, IDB_STORES } from '../idb.js';
import {
    appendSlotImage,
    migrateSlotRecord,
    validateSlotRecord,
} from '../../../domain/model/slot.js';
import { catchToResult, createChangeEmitter } from '../import-export.js';

/**
 * @param {import('../../../domain/model/slot.js').SlotRecord} record
 * @returns {object}
 */
export function toSlotIndexRow(record) {
    return {
        messageId: record.messageId,
        slotId: record.slotId,
        imageCount: Array.isArray(record.images) ? record.images.length : 0,
        latestImageRef: Array.isArray(record.images) && record.images.length > 0
            ? record.images[record.images.length - 1].imageRef
            : null,
        anchorPreview: String(record.anchorSentence || '').slice(0, 120),
        updatedAt: nowIso(),
    };
}

/**
 * @param {{ read: (messageId: number) => any }} messageExtra
 * @param {number} messageId
 * @returns {{ ok: true, value: { schemaVersion: number, slots: import('../../../domain/model/slot.js').SlotRecord[] } } | { ok: false, error: import('../../../infra/errors.js').AppError }}
 */
function readAuthority(messageExtra, messageId) {
    const r = messageExtra.read(messageId);
    if (r && typeof r === 'object' && 'ok' in r) {
        return r;
    }
    return Err(hostError({
        code: 'MESSAGE_EXTRA_READ_SHAPE',
        message: 'messageExtra.read 未返回 Result',
        context: { messageId },
    }));
}

/**
 * 对账：以 message.extra 为准，重建 / 修剪 IDB 索引。
 * 读失败时**不删任何索引**（避免空权威误伤）。
 *
 * @param {object} args
 * @param {object} args.db
 * @param {{ read: (messageId: number) => any }} args.messageExtra
 * @param {number} args.messageId
 * @returns {Promise<{ ok: true, value: { repaired: number, removed: number } } | { ok: false, error: import('../../../infra/errors.js').AppError }>}
 */
export async function reconcileSlotIndex(args) {
    const { db, messageExtra, messageId } = args;
    try {
        const authorityResult = readAuthority(messageExtra, messageId);
        if (isErr(authorityResult)) {
            return authorityResult;
        }
        const authority = authorityResult.value;
        const indexed = typeof db.getAllByIndex === 'function'
            ? await db.getAllByIndex(IDB_STORES.SLOT_INDEX, 'by_messageId', messageId)
            : (await db.getAll(IDB_STORES.SLOT_INDEX)).filter((r) => r.messageId === messageId);

        const authIds = new Set(authority.slots.map((s) => s.slotId));
        let removed = 0;
        let repaired = 0;

        for (const row of indexed) {
            if (!authIds.has(row.slotId)) {
                await db.delete(IDB_STORES.SLOT_INDEX, [row.messageId, row.slotId]);
                removed += 1;
            }
        }

        for (const slot of authority.slots) {
            await db.put(IDB_STORES.SLOT_INDEX, toSlotIndexRow(slot));
            repaired += 1;
        }

        return Ok({ repaired, removed });
    } catch (err) {
        if (err && typeof err === 'object' && 'category' in err) {
            return Err(/** @type {import('../../../infra/errors.js').AppError} */ (err));
        }
        return Err(mapIdbError(err));
    }
}

/**
 * @param {{ db: object, bus?: object, messageExtra?: object }} deps
 * @returns {import('../../../ports/repository.port.js').Repository<any>|import('../../../ports/repository.port.js').SlotRepository}
 */
export function createSlotRepo(deps) {
    const db = deps?.db;
    const messageExtra = deps?.messageExtra;
    if (!db) {
        throw new Error('createSlotRepo requires deps.db');
    }
    if (!messageExtra || typeof messageExtra.read !== 'function' || typeof messageExtra.write !== 'function') {
        throw new Error('createSlotRepo requires deps.messageExtra');
    }
    const changes = createChangeEmitter();

    /**
     * @param {unknown} err
     */
    function mapErr(err) {
        if (err && typeof err === 'object' && 'category' in err && 'code' in err) {
            return /** @type {import('../../../infra/errors.js').AppError} */ (err);
        }
        return mapIdbError(err);
    }

    /**
     * @param {number} messageId
     * @param {import('../../../domain/model/slot.js').SlotRecord[]} records
     */
    async function writeAuthorityAndIndex(messageId, records) {
        const writeResult = await messageExtra.write(messageId, { slots: records });
        if (writeResult && writeResult.ok === false) {
            throw writeResult.error;
        }
        // 先写权威；索引失败不回滚权威，交对账修复
        try {
            const existing = typeof db.getAllByIndex === 'function'
                ? await db.getAllByIndex(IDB_STORES.SLOT_INDEX, 'by_messageId', messageId)
                : (await db.getAll(IDB_STORES.SLOT_INDEX)).filter((r) => r.messageId === messageId);
            const keep = new Set(records.map((r) => r.slotId));
            for (const row of existing) {
                if (!keep.has(row.slotId)) {
                    await db.delete(IDB_STORES.SLOT_INDEX, [row.messageId, row.slotId]);
                }
            }
            for (const record of records) {
                await db.put(IDB_STORES.SLOT_INDEX, toSlotIndexRow(record));
            }
        } catch (indexErr) {
            // 索引是派生数据；记录但不阻断
            void indexErr;
        }
    }

    return {
        async getByMessage(messageId) {
            return catchToResult(async () => {
                const authorityResult = readAuthority(messageExtra, messageId);
                if (isErr(authorityResult)) {
                    throw authorityResult.error;
                }
                // 读路径顺便轻量对账（不强制 await 成功）
                void reconcileSlotIndex({ db, messageExtra, messageId }).then(
                    () => undefined,
                    () => undefined,
                );
                return authorityResult.value.slots;
            }, mapErr, Ok, Err);
        },

        async get(messageId, slotId) {
            return catchToResult(async () => {
                const authorityResult = readAuthority(messageExtra, messageId);
                if (isErr(authorityResult)) {
                    throw authorityResult.error;
                }
                return authorityResult.value.slots.find((s) => s.slotId === Number(slotId)) || null;
            }, mapErr, Ok, Err);
        },

        async put(messageId, records) {
            if (!Array.isArray(records)) {
                return Err(configError({
                    code: 'SLOT_PUT_SHAPE',
                    message: 'Slot 写入必须是数组',
                }));
            }
            /** @type {import('../../../domain/model/slot.js').SlotRecord[]} */
            const validated = [];
            for (const raw of records) {
                const withMsg = { ...raw, messageId: Number(messageId) };
                const fromVersion = Number(withMsg.schemaVersion) || 1;
                const migrated = migrateSlotRecord(withMsg, fromVersion);
                if (!migrated.ok) {
                    return migrated;
                }
                const v = validateSlotRecord(migrated.value);
                if (!v.ok) {
                    return v;
                }
                validated.push(v.value);
            }
            return catchToResult(async () => {
                await writeAuthorityAndIndex(messageId, validated);
                changes.emit({ type: 'put', messageId });
            }, mapErr, Ok, Err);
        },

        async recordImage(messageId, slotId, imageRef, meta) {
            if (imageRef == null || imageRef === '') {
                return Err(configError({
                    code: 'SLOT_IMAGE_REF',
                    message: '缺少 imageRef',
                }));
            }
            return catchToResult(async () => {
                const authorityResult = readAuthority(messageExtra, messageId);
                if (isErr(authorityResult)) {
                    throw authorityResult.error;
                }
                const authority = authorityResult.value;
                const idx = authority.slots.findIndex((s) => s.slotId === Number(slotId));
                if (idx < 0) {
                    throw hostError({
                        code: 'SLOT_NOT_FOUND',
                        message: '找不到对应 slot 记录',
                        hint: '请先完成生图计划写入',
                        context: { messageId, slotId },
                    });
                }
                const entry = {
                    imageRef: String(imageRef),
                    createdAt: nowIso(),
                    naiConfigId: meta?.naiConfigId == null ? null : String(meta.naiConfigId),
                    artistId: meta?.artistId == null ? null : String(meta.artistId),
                };
                const next = [...authority.slots];
                next[idx] = appendSlotImage(next[idx], entry);
                await writeAuthorityAndIndex(messageId, next);
                changes.emit({ type: 'recordImage', messageId, slotId: Number(slotId) });
                return next[idx];
            }, mapErr, Ok, Err);
        },

        onChanged(fn) {
            return changes.subscribe(fn);
        },

        /** 显式对账入口（面板/启动时可调） */
        reconcile(messageId) {
            return reconcileSlotIndex({ db, messageExtra, messageId });
        },
    };
}
