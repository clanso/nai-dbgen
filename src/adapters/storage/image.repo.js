/**
 * L2 适配器 · 图片 blob 仓库（IndexedDB）。
 * 归属：W1-D 存储代理实现。W0 仅冻结签名。
 *
 * 风险 R-07：配额压力靠 gc(liveRefs) + estimateUsage；object URL 必须配套 revoke。
 * 裁决 D22：空 liveRefs 禁止清空全库；D23：liveRefs 必须覆盖全部 swipe。
 */

import { Ok, Err } from '../../infra/result.js';
import { configError } from '../../infra/errors.js';
import { newId } from '../../infra/id.js';
import { nowIso } from '../../infra/clock.js';
import { mapIdbError, IDB_STORES } from './idb.js';
import { catchToResult } from './import-export.js';
import { MESSAGE_EXTRA_NS, normalizeNaiExtra } from './message-extra.store.js';

/**
 * 收集一楼在**全部 swipe** 上仍存活的 imageRef（裁决 D23）。
 * 扫描范围：
 * - `message.extra['nai-dbgen']`
 * - `message.swipe_info[].extra['nai-dbgen']`（每一项）
 *
 * 调用方做 GC 前必须用本函数（或等价全量扫描），禁止只读当前 extra。
 *
 * @param {object|null|undefined} message 酒馆 chat 楼对象
 * @returns {string[]} 去重后的 ImageRef 列表（可能为空——空时 gc 须 force）
 */
export function collectLiveRefs(message) {
    /** @type {Set<string>} */
    const refs = new Set();

    /**
     * @param {unknown} ns
     */
    function absorbNamespace(ns) {
        // 软归一化：坏片段跳过，不拖垮整楼收集
        const payload = normalizeNaiExtra(ns);
        for (const slot of payload.slots) {
            if (!Array.isArray(slot.images)) {
                continue;
            }
            for (const entry of slot.images) {
                if (entry?.imageRef != null && entry.imageRef !== '') {
                    refs.add(String(entry.imageRef));
                }
            }
        }
    }

    if (message && typeof message === 'object') {
        const extra = /** @type {{ extra?: Record<string, unknown> }} */ (message).extra;
        if (extra && typeof extra === 'object' && MESSAGE_EXTRA_NS in extra) {
            absorbNamespace(extra[MESSAGE_EXTRA_NS]);
        }
        const swipeInfo = /** @type {{ swipe_info?: unknown }} */ (message).swipe_info;
        if (Array.isArray(swipeInfo)) {
            for (const info of swipeInfo) {
                if (!info || typeof info !== 'object') {
                    continue;
                }
                const siExtra = /** @type {{ extra?: Record<string, unknown> }} */ (info).extra;
                if (siExtra && typeof siExtra === 'object' && MESSAGE_EXTRA_NS in siExtra) {
                    absorbNamespace(siExtra[MESSAGE_EXTRA_NS]);
                }
            }
        }
    }

    return [...refs];
}

/**
 * @param {object} deps
 * @param {object} deps.db openIdb 返回值
 * @returns {import('../../ports/repository.port.js').ImageRepository}
 */
export function createImageRepo(deps) {
    const db = deps?.db;
    if (!db) {
        throw new Error('createImageRepo requires deps.db');
    }

    /** @type {Map<string, string>} imageRef → objectURL */
    const urlCache = new Map();

    /**
     * @param {unknown} err
     */
    function mapErr(err) {
        if (err && typeof err === 'object' && 'category' in err && 'code' in err) {
            return /** @type {import('../../infra/errors.js').AppError} */ (err);
        }
        return mapIdbError(err);
    }

    /**
     * @param {string} ref
     */
    function revokeCached(ref) {
        const url = urlCache.get(ref);
        if (url && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
            try {
                URL.revokeObjectURL(url);
            } catch {
                // ignore
            }
        }
        urlCache.delete(ref);
    }

    const repo = {
        async put(blob) {
            if (typeof Blob === 'undefined' || !(blob instanceof Blob)) {
                return Err(configError({
                    code: 'IMAGE_BLOB_REQUIRED',
                    message: 'put 需要 Blob',
                }));
            }
            return catchToResult(async () => {
                const id = newId('img');
                const record = {
                    id,
                    blob,
                    mimeType: blob.type || 'application/octet-stream',
                    size: blob.size,
                    createdAt: nowIso(),
                };
                await db.put(IDB_STORES.IMAGES, record);
                return id;
            }, mapErr, Ok, Err);
        },

        async getUrl(ref) {
            if (ref == null || ref === '') {
                return Ok(null);
            }
            const key = String(ref);
            return catchToResult(async () => {
                if (urlCache.has(key)) {
                    return urlCache.get(key) || null;
                }
                const row = await db.get(IDB_STORES.IMAGES, key);
                if (!row || !row.blob) {
                    return null;
                }
                if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
                    return null;
                }
                const url = URL.createObjectURL(row.blob);
                urlCache.set(key, url);
                return url;
            }, mapErr, Ok, Err);
        },

        /**
         * @param {import('../../domain/model/slot.js').ImageRef[]} liveRefs
         * @param {{ force?: boolean }} [opts]
         */
        async gc(liveRefs, opts) {
            if (!Array.isArray(liveRefs)) {
                return Err(configError({
                    code: 'IMAGE_GC_INVALID_LIVE_REFS',
                    message: 'gc 需要 liveRefs 数组',
                    hint: '请用 collectLiveRefs(message) 收集全部 swipe 引用；确需清空传 { force: true }',
                    context: { typeofLiveRefs: typeof liveRefs },
                }));
            }

            const live = new Set(
                liveRefs
                    .filter((r) => r != null && r !== '')
                    .map((r) => String(r)),
            );

            // 裁决 D22：空集合绝不解释为清空全库
            if (live.size === 0 && opts?.force !== true) {
                return Err(configError({
                    code: 'IMAGE_GC_EMPTY_LIVE_REFS',
                    message: 'gc 拒绝空 liveRefs（防止误删全库）',
                    hint: '请用 collectLiveRefs(message) 扫齐当前楼全部 swipe；确需清空必须显式 { force: true }',
                    context: { force: false, inputLength: liveRefs.length },
                }));
            }

            return catchToResult(async () => {
                const all = await db.getAll(IDB_STORES.IMAGES);
                let removed = 0;
                for (const row of all) {
                    const id = String(row.id);
                    if (!live.has(id)) {
                        await db.delete(IDB_STORES.IMAGES, id);
                        revokeCached(id);
                        removed += 1;
                    }
                }
                return { removed };
            }, mapErr, Ok, Err);
        },

        /**
         * 容量估算（端口外辅助，供容量面板）。
         * @returns {Promise<{ ok: true, value: { bytes: number, count: number, quota: number|null, usage: number|null } } | { ok: false, error: import('../../infra/errors.js').AppError }>}
         */
        async estimateUsage() {
            return catchToResult(async () => {
                const all = await db.getAll(IDB_STORES.IMAGES);
                let bytes = 0;
                for (const row of all) {
                    bytes += Number(row.size) || (row.blob && row.blob.size) || 0;
                }
                let quota = null;
                let usage = null;
                try {
                    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
                        const est = await navigator.storage.estimate();
                        quota = est.quota ?? null;
                        usage = est.usage ?? null;
                    }
                } catch {
                    // ignore
                }
                return { bytes, count: all.length, quota, usage };
            }, mapErr, Ok, Err);
        },

        /**
         * 释放全部缓存的 object URL（页面卸载 / 切聊天时可调）。
         */
        revokeAllUrls() {
            for (const ref of [...urlCache.keys()]) {
                revokeCached(ref);
            }
        },
    };

    return repo;
}
