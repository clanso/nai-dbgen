/**
 * L2 适配器 · 图片 blob 仓库（IndexedDB）。
 * 归属：W1-D 存储代理实现。W0 仅冻结签名。
 *
 * 风险 R-07：配额压力靠 gc(liveRefs) + estimateUsage；object URL 必须配套 revoke。
 */

import { Ok, Err } from '../../infra/result.js';
import { configError } from '../../infra/errors.js';
import { newId } from '../../infra/id.js';
import { nowIso } from '../../infra/clock.js';
import { mapIdbError, IDB_STORES } from './idb.js';
import { catchToResult } from './import-export.js';

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

        async gc(liveRefs) {
            const live = new Set(
                (Array.isArray(liveRefs) ? liveRefs : [])
                    .filter((r) => r != null && r !== '')
                    .map((r) => String(r)),
            );
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
