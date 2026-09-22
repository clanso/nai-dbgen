/**
 * L2 适配器 · IndexedDB 封装 + schema 迁移。
 * 归属：W1-D 存储代理实现。W0 仅冻结签名。
 *
 * 重要：IndexedDB 事务在 await 任意非本事务 IDBRequest 的 Promise 后会自动提交。
 * 因此所有读写必须在同一同步调度内发出全部 IDBRequest，再统一 await 事务完成；
 * 禁止在事务回调里 `await` 网络 / 其它 store 的独立 Promise。
 */

import { hostError } from '../../infra/errors.js';

/** @type {string} */
export const IDB_NAME = 'nai-dbgen';

/** @type {number} */
export const IDB_VERSION = 1;

/**
 * 对象存储名集中定义（升版时只改此处 + upgrade 阶段）。
 * @readonly
 */
export const IDB_STORES = Object.freeze({
    CHARACTER_GROUPS: 'character_groups',
    CHARACTERS: 'characters',
    TAG_LIBRARIES: 'tag_libraries',
    TAG_ENTRIES: 'tag_entries',
    ARTISTS: 'artists',
    PRESETS: 'presets',
    LLM_CONFIGS: 'llm_configs',
    NAI_CONFIGS: 'nai_configs',
    SLOT_INDEX: 'slot_index',
    IMAGES: 'images',
});

/**
 * 索引定义：store → [{ name, keyPath, options }]
 * @readonly
 */
export const IDB_INDEXES = Object.freeze({
    [IDB_STORES.CHARACTER_GROUPS]: Object.freeze([
        Object.freeze({ name: 'by_order', keyPath: 'order', options: { unique: false } }),
    ]),
    [IDB_STORES.CHARACTERS]: Object.freeze([
        Object.freeze({ name: 'by_groupId', keyPath: 'groupId', options: { unique: false } }),
    ]),
    [IDB_STORES.TAG_ENTRIES]: Object.freeze([
        Object.freeze({ name: 'by_libraryId', keyPath: 'libraryId', options: { unique: false } }),
    ]),
    [IDB_STORES.PRESETS]: Object.freeze([
        Object.freeze({ name: 'by_kind', keyPath: 'kind', options: { unique: false } }),
    ]),
    [IDB_STORES.SLOT_INDEX]: Object.freeze([
        Object.freeze({ name: 'by_messageId', keyPath: 'messageId', options: { unique: false } }),
    ]),
});

/**
 * @param {unknown} err
 * @returns {import('../../infra/errors.js').AppError}
 */
export function mapIdbError(err) {
    const name = err && typeof err === 'object' && 'name' in err
        ? String(/** @type {{ name?: string }} */ (err).name)
        : '';
    const message = err instanceof Error ? err.message : String(err ?? '未知 IndexedDB 错误');

    if (name === 'QuotaExceededError' || /quota/i.test(message)) {
        return hostError({
            code: 'IDB_QUOTA_EXCEEDED',
            message: '浏览器存储空间不足，无法写入 IndexedDB',
            hint: '请在插件面板清理未引用图片（GC），或导出库后清理站点数据；也可换用更大配额的浏览器配置',
            cause: err,
            retryable: false,
        });
    }
    if (name === 'InvalidStateError' || name === 'UnknownError') {
        return hostError({
            code: 'IDB_UNAVAILABLE',
            message: 'IndexedDB 当前不可用（可能处于隐私模式或已被禁用）',
            hint: '请关闭隐私/无痕模式，或在浏览器设置中允许本站使用 IndexedDB 后重试',
            cause: err,
            retryable: true,
        });
    }
    if (name === 'VersionError' || name === 'AbortError') {
        return hostError({
            code: 'IDB_OPEN_FAILED',
            message: '打开 IndexedDB 失败',
            hint: '请刷新页面后重试；若持续失败可导出数据后清除本扩展站点存储',
            cause: err,
            retryable: true,
        });
    }
    return hostError({
        code: 'IDB_OPERATION_FAILED',
        message: `IndexedDB 操作失败：${message}`,
        hint: '请刷新后重试；若反复出现请导出库备份',
        cause: err,
        retryable: true,
    });
}

/**
 * @param {IDBObjectStore} store
 * @param {string} storeName
 */
function ensureIndexesOnStore(store, storeName) {
    const defs = IDB_INDEXES[storeName] || [];
    for (const def of defs) {
        if (!store.indexNames.contains(def.name)) {
            store.createIndex(def.name, def.keyPath, def.options || {});
        }
    }
}

/**
 * @param {IDBDatabase} db
 * @param {IDBTransaction} tx
 * @param {number} oldVersion
 */
function runUpgrade(db, tx, oldVersion) {
    if (oldVersion < 1) {
        const specs = [
            [IDB_STORES.CHARACTER_GROUPS, { keyPath: 'id' }],
            [IDB_STORES.CHARACTERS, { keyPath: 'id' }],
            [IDB_STORES.TAG_LIBRARIES, { keyPath: 'id' }],
            [IDB_STORES.TAG_ENTRIES, { keyPath: 'id' }],
            [IDB_STORES.ARTISTS, { keyPath: 'id' }],
            [IDB_STORES.PRESETS, { keyPath: 'id' }],
            [IDB_STORES.LLM_CONFIGS, { keyPath: 'id' }],
            [IDB_STORES.NAI_CONFIGS, { keyPath: 'id' }],
            [IDB_STORES.SLOT_INDEX, { keyPath: ['messageId', 'slotId'] }],
            [IDB_STORES.IMAGES, { keyPath: 'id' }],
        ];
        for (const [name, params] of specs) {
            let store;
            if (db.objectStoreNames.contains(/** @type {string} */ (name))) {
                store = tx.objectStore(/** @type {string} */ (name));
            } else {
                store = db.createObjectStore(
                    /** @type {string} */ (name),
                    /** @type {IDBObjectStoreParameters} */ (params),
                );
            }
            ensureIndexesOnStore(store, /** @type {string} */ (name));
        }
    }
}

/**
 * @param {IDBRequest} request
 * @returns {Promise<any>}
 */
function reqToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IDBRequest failed'));
    });
}

/**
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
function txDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
        tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction error'));
    });
}

/**
 * @param {object} [opts]
 * @param {string} [opts.dbName='nai-dbgen']
 * @param {number} [opts.version]
 * @param {IDBFactory} [opts.indexedDB] 可注入，便于测试
 * @returns {Promise<{
 *   get: (store: string, key: string) => Promise<any>,
 *   put: (store: string, value: any, key?: string) => Promise<void>,
 *   delete: (store: string, key: string) => Promise<void>,
 *   getAll: (store: string) => Promise<any[]>,
 *   close: () => void,
 * }>}
 */
export function openIdb(opts) {
    const dbName = opts?.dbName || IDB_NAME;
    const version = opts?.version ?? IDB_VERSION;
    const factory = opts?.indexedDB
        || (typeof globalThis !== 'undefined' ? globalThis.indexedDB : undefined);

    if (!factory || typeof factory.open !== 'function') {
        return Promise.reject(mapIdbError(Object.assign(new Error('IndexedDB is not available'), {
            name: 'InvalidStateError',
        })));
    }

    return new Promise((resolve, reject) => {
        let request;
        try {
            request = factory.open(dbName, version);
        } catch (err) {
            reject(mapIdbError(err));
            return;
        }

        request.onerror = () => {
            reject(mapIdbError(request.error));
        };

        request.onblocked = () => {
            reject(hostError({
                code: 'IDB_BLOCKED',
                message: 'IndexedDB 打开被阻塞（其他标签页可能占用旧版本）',
                hint: '请关闭其他使用本插件的标签页后刷新',
                retryable: true,
            }));
        };

        request.onupgradeneeded = (event) => {
            const db = request.result;
            const tx = request.transaction;
            const oldVersion = event.oldVersion || 0;
            if (tx) {
                runUpgrade(db, tx, oldVersion);
            }
        };

        request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => {
                try {
                    db.close();
                } catch {
                    // ignore
                }
            };
            resolve(createClient(db));
        };
    });
}

/**
 * @param {IDBDatabase} db
 */
function createClient(db) {
    /**
     * 单 store 事务：所有 IDBRequest 在同步阶段发出，再 await tx complete。
     * @template T
     * @param {string} storeName
     * @param {IDBTransactionMode} mode
     * @param {(store: IDBObjectStore) => IDBRequest|IDBRequest[]} runner
     * @returns {Promise<T>}
     */
    async function withStore(storeName, mode, runner) {
        let tx;
        try {
            tx = db.transaction(storeName, mode);
        } catch (err) {
            throw mapIdbError(err);
        }
        const store = tx.objectStore(storeName);
        /** @type {IDBRequest|IDBRequest[]} */
        let requests;
        try {
            requests = runner(store);
        } catch (err) {
            try {
                tx.abort();
            } catch {
                // ignore
            }
            throw mapIdbError(err);
        }
        const list = Array.isArray(requests) ? requests : [requests];
        try {
            const results = await Promise.all(list.map((r) => reqToPromise(r)));
            await txDone(tx);
            return /** @type {T} */ (Array.isArray(requests) ? results : results[0]);
        } catch (err) {
            throw mapIdbError(err);
        }
    }

    return {
        /**
         * @param {string} store
         * @param {string|number|Array<string|number>} key
         */
        get(store, key) {
            return withStore(store, 'readonly', (s) => s.get(key));
        },

        /**
         * @param {string} store
         * @param {any} value
         * @param {string} [key]
         */
        put(store, value, key) {
            return withStore(store, 'readwrite', (s) => (
                key === undefined ? s.put(value) : s.put(value, key)
            )).then(() => undefined);
        },

        /**
         * @param {string} store
         * @param {string|number|Array<string|number>} key
         */
        delete(store, key) {
            return withStore(store, 'readwrite', (s) => s.delete(key)).then(() => undefined);
        },

        /**
         * @param {string} store
         * @returns {Promise<any[]>}
         */
        getAll(store) {
            return withStore(store, 'readonly', (s) => s.getAll()).then((rows) => (
                Array.isArray(rows) ? rows : []
            ));
        },

        /**
         * 按索引取全部（冻结 API 之外的扩展，供标签库按库筛选用）。
         * @param {string} store
         * @param {string} indexName
         * @param {IDBValidKey|IDBKeyRange} [query]
         * @returns {Promise<any[]>}
         */
        getAllByIndex(store, indexName, query) {
            return withStore(store, 'readonly', (s) => {
                const index = s.index(indexName);
                return query === undefined ? index.getAll() : index.getAll(query);
            }).then((rows) => (Array.isArray(rows) ? rows : []));
        },

        /**
         * 多 store 只读/读写：runner 必须同步发出全部 request。
         * @param {string[]} storeNames
         * @param {IDBTransactionMode} mode
         * @param {(stores: Record<string, IDBObjectStore>, tx: IDBTransaction) => void} runner
         * @returns {Promise<void>}
         */
        async runTransaction(storeNames, mode, runner) {
            let tx;
            try {
                tx = db.transaction(storeNames, mode);
            } catch (err) {
                throw mapIdbError(err);
            }
            /** @type {Record<string, IDBObjectStore>} */
            const stores = {};
            for (const name of storeNames) {
                stores[name] = tx.objectStore(name);
            }
            try {
                runner(stores, tx);
            } catch (err) {
                try {
                    tx.abort();
                } catch {
                    // ignore
                }
                throw mapIdbError(err);
            }
            try {
                await txDone(tx);
            } catch (err) {
                throw mapIdbError(err);
            }
        },

        close() {
            try {
                db.close();
            } catch {
                // ignore
            }
        },
    };
}
