/**
 * L2 适配器 · IndexedDB 封装 + schema。
 * 浏览器仅存图片缓存（及可选本地派生）；库/配置/生图记录在服务器文件。
 *
 * **错误约定（裁决 D16）**：本层不返回 Result；抛 AppError，仓库层 catch 成 Result。
 */

import { hostError } from '../../infra/errors.js';

/** @type {string} */
export const IDB_NAME = 'nai-dbgen';

/**
 * 版本 2：图片按 (sessionId, slotId) 建缓存索引（slot_image_cache）。
 * 版本 3：画师串示例图单独存放，不进会清理的公共图片缓存。
 * @type {number}
 */
export const IDB_VERSION = 3;

/**
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
    IMAGES: 'images',
    /** 画师串示例图。不参与图片缓存清理。 */
    ARTIST_IMAGES: 'artist_images',
    /** 会话内 slot → 最新 imageRef（记录被修剪后仍可展示缓存图） */
    SLOT_IMAGE_CACHE: 'slot_image_cache',
});

/**
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
    [IDB_STORES.SLOT_IMAGE_CACHE]: Object.freeze([
        Object.freeze({ name: 'by_sessionId', keyPath: 'sessionId', options: { unique: false } }),
        Object.freeze({ name: 'by_imageRef', keyPath: 'imageRef', options: { unique: false } }),
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
    const message = err instanceof Error ? err.message : String(err ?? '未知浏览器图片缓存错误');

    if (name === 'QuotaExceededError' || /quota/i.test(message)) {
        return hostError({
            code: 'IDB_QUOTA_EXCEEDED',
            message: '浏览器图片缓存空间不足',
            hint: '请到存储管理清理，或清理本站站点数据后重试',
            cause: err,
            retryable: false,
        });
    }
    if (name === 'InvalidStateError' || name === 'UnknownError') {
        return hostError({
            code: 'IDB_UNAVAILABLE',
            message: '浏览器图片缓存不可用（可能处于隐私模式或已被禁用）',
            hint: '请关闭隐私/无痕模式，或在浏览器设置中允许本站使用后重试',
            cause: err,
            retryable: true,
        });
    }
    if (name === 'VersionError' || name === 'AbortError') {
        return hostError({
            code: 'IDB_OPEN_FAILED',
            message: '打开浏览器图片缓存失败',
            hint: '请刷新页面后重试；若持续失败可清理本站站点数据',
            cause: err,
            retryable: true,
        });
    }
    return hostError({
        code: 'IDB_OPERATION_FAILED',
        message: `浏览器图片缓存操作失败：${message}`,
        hint: '请刷新后重试',
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
 * @param {string} name
 * @param {IDBObjectStoreParameters} params
 * @param {IDBTransaction} tx
 */
function ensureStore(db, name, params, tx) {
    let store;
    if (db.objectStoreNames.contains(name)) {
        store = tx.objectStore(name);
    } else {
        store = db.createObjectStore(name, params);
    }
    ensureIndexesOnStore(store, name);
    return store;
}

/**
 * @param {IDBDatabase} db
 * @param {IDBTransaction} tx
 * @param {number} oldVersion
 */
function runUpgrade(db, tx, oldVersion) {
    void oldVersion;
    const specs = [
        [IDB_STORES.CHARACTER_GROUPS, { keyPath: 'id' }],
        [IDB_STORES.CHARACTERS, { keyPath: 'id' }],
        [IDB_STORES.TAG_LIBRARIES, { keyPath: 'id' }],
        [IDB_STORES.TAG_ENTRIES, { keyPath: 'id' }],
        [IDB_STORES.ARTISTS, { keyPath: 'id' }],
        [IDB_STORES.PRESETS, { keyPath: 'id' }],
        [IDB_STORES.LLM_CONFIGS, { keyPath: 'id' }],
        [IDB_STORES.NAI_CONFIGS, { keyPath: 'id' }],
        [IDB_STORES.IMAGES, { keyPath: 'id' }],
        [IDB_STORES.ARTIST_IMAGES, { keyPath: 'id' }],
        [IDB_STORES.SLOT_IMAGE_CACHE, { keyPath: ['sessionId', 'slotId'] }],
    ];
    for (const [name, params] of specs) {
        ensureStore(db, /** @type {string} */ (name), /** @type {IDBObjectStoreParameters} */ (params), tx);
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
        tx.onabort = () => reject(tx.error || new Error('浏览器图片缓存事务已中止'));
        tx.onerror = () => reject(tx.error || new Error('浏览器图片缓存事务出错'));
    });
}

/**
 * @param {object} [opts]
 * @param {string} [opts.dbName='nai-dbgen']
 * @param {number} [opts.version]
 * @param {IDBFactory} [opts.indexedDB]
 * @returns {Promise<import('../../ports/repository.port.js').IdbClient>}
 */
export function openIdb(opts) {
    const dbName = opts?.dbName || IDB_NAME;
    const version = opts?.version ?? IDB_VERSION;
    const factory = opts?.indexedDB
        || (typeof globalThis !== 'undefined' ? globalThis.indexedDB : undefined);

    if (!factory || typeof factory.open !== 'function') {
        return Promise.reject(mapIdbError(Object.assign(new Error('浏览器图片缓存不可用'), {
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
                message: '浏览器图片缓存打开被阻塞（其他标签页可能占用旧版本）',
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
 * @returns {import('../../ports/repository.port.js').IdbClient}
 */
function createClient(db) {
    /**
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
        get(store, key) {
            return withStore(store, 'readonly', (s) => s.get(key));
        },

        put(store, value, key) {
            return withStore(store, 'readwrite', (s) => (
                key === undefined ? s.put(value) : s.put(value, key)
            )).then(() => undefined);
        },

        delete(store, key) {
            return withStore(store, 'readwrite', (s) => s.delete(key)).then(() => undefined);
        },

        getAll(store) {
            return withStore(store, 'readonly', (s) => s.getAll()).then((rows) => (
                Array.isArray(rows) ? rows : []
            ));
        },

        getAllByIndex(store, indexName, query) {
            return withStore(store, 'readonly', (s) => {
                const index = s.index(indexName);
                return query === undefined ? index.getAll() : index.getAll(query);
            }).then((rows) => (Array.isArray(rows) ? rows : []));
        },

        async runTransaction(storeNames, mode, runner) {
            const names = Array.isArray(storeNames) ? storeNames : [storeNames];
            let tx;
            try {
                tx = db.transaction(names, mode);
            } catch (err) {
                throw mapIdbError(err);
            }
            /** @type {Record<string, IDBObjectStore>} */
            const stores = {};
            for (const name of names) {
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
