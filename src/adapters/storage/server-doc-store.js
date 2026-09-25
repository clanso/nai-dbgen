/**
 * L2 适配器 · 服务器 JSON 文档库（IdbClient 形状）。
 *
 * 每个 store 对应一个固定文件名（nai-dbgen_*.json）。启动时加载到内存：
 * - 404 → 空集合（首次使用）
 * - 其他读失败 → 该 store 进入不可用（只读禁写），绝不用空数据写回覆盖
 *
 * 写：先成功写入服务器，再改内存；写失败则内存不变。
 * runTransaction：先在草稿上跑 runner，再按 store 逐个写服务器。
 * 每写成功一个 store，立即把该 store 的内存更新为草稿（与服务器一致）。
 * 若中途失败：已成功的 store 内存已是新内容；失败及未写的 store 内存保持旧内容。
 * Err.context 含 partialWriteStores（已成功）与 failedStore（本次失败的那个）。
 */

import { IDB_STORES } from './idb.js';
import { hostError } from '../../infra/errors.js';
import {
    SERVER_FILE_PREFIX,
} from './server-files.js';

/** 文档库文件 schema 版本常量；读写只认此值 */
export const DOC_FILE_SCHEMA_VERSION = 1;

/**
 * store → 固定服务器文件名
 * @readonly
 */
export const DOC_STORE_FILES = Object.freeze({
    [IDB_STORES.CHARACTER_GROUPS]: `${SERVER_FILE_PREFIX}character_groups.json`,
    [IDB_STORES.CHARACTERS]: `${SERVER_FILE_PREFIX}characters.json`,
    [IDB_STORES.TAG_LIBRARIES]: `${SERVER_FILE_PREFIX}tag_libraries.json`,
    [IDB_STORES.TAG_ENTRIES]: `${SERVER_FILE_PREFIX}tag_entries.json`,
    [IDB_STORES.ARTISTS]: `${SERVER_FILE_PREFIX}artists.json`,
    [IDB_STORES.PRESETS]: `${SERVER_FILE_PREFIX}presets.json`,
    [IDB_STORES.LLM_CONFIGS]: `${SERVER_FILE_PREFIX}llm_configs.json`,
    [IDB_STORES.NAI_CONFIGS]: `${SERVER_FILE_PREFIX}nai_configs.json`,
});

/** @type {readonly string[]} */
export const DOC_STORE_NAMES = Object.freeze(Object.keys(DOC_STORE_FILES));

/**
 * @typedef {'ok'|'empty'|'unavailable'} StoreHealth
 */

/**
 * @param {string} store
 * @param {any} row
 * @returns {string}
 */
function keyOf(store, row) {
    return String(row?.id);
}

/**
 * @param {string|number|Array<string|number>} key
 * @returns {string}
 */
function normalizeKey(key) {
    if (Array.isArray(key)) {
        return key.join('::');
    }
    return String(key);
}

/**
 * @param {any} v
 * @returns {any}
 */
function clone(v) {
    if (v == null || typeof v !== 'object') {
        return v;
    }
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(v);
        } catch {
            // fall through
        }
    }
    return JSON.parse(JSON.stringify(v));
}

/**
 * @param {unknown} raw
 * @returns {Map<string, any>}
 */
function recordsFromFile(raw) {
    /** @type {Map<string, any>} */
    const map = new Map();
    if (raw == null) {
        return map;
    }
    if (Array.isArray(raw)) {
        for (const row of raw) {
            if (row && row.id != null) {
                map.set(String(row.id), clone(row));
            }
        }
        return map;
    }
    if (typeof raw !== 'object') {
        throw new Error('DOC_STORE_SHAPE');
    }
    const body = /** @type {Record<string, unknown>} */ (raw);
    if (!Array.isArray(body.records)) {
        // 只接受 { records: [] }；其它形状视为损坏，禁止当成空库写回
        throw new Error('DOC_STORE_SHAPE');
    }
    for (const row of body.records) {
        if (row && /** @type {any} */ (row).id != null) {
            map.set(String(/** @type {any} */ (row).id), clone(row));
        }
    }
    return map;
}

/**
 * @param {Map<string, any>} map
 * @returns {{ schemaVersion: number, records: any[] }}
 */
function filePayload(map) {
    return {
        schemaVersion: DOC_FILE_SCHEMA_VERSION,
        records: [...map.values()].map(clone),
    };
}

/**
 * @param {object} deps
 * @param {ReturnType<import('./server-files.js').createServerFiles>} deps.serverFiles
 * @param {readonly string[]} [deps.storeNames]
 * @returns {Promise<import('../../ports/repository.port.js').IdbClient & {
 *   ready: boolean,
 *   loadErrors: Record<string, import('../../infra/errors.js').AppError>,
 *   storeHealth: (store: string) => StoreHealth,
 *   getLoadReport: () => { ready: boolean, errors: { store: string, error: import('../../infra/errors.js').AppError }[] },
 * }>}
 */
export async function openServerDocStore(deps) {
    const serverFiles = deps?.serverFiles;
    if (!serverFiles) {
        throw new Error('openServerDocStore requires serverFiles');
    }
    const storeNames = deps.storeNames || DOC_STORE_NAMES;

    /** @type {Map<string, Map<string, any>>} */
    const memory = new Map();
    /** @type {Map<string, StoreHealth>} */
    const health = new Map();
    /** @type {Record<string, import('../../infra/errors.js').AppError>} */
    const loadErrors = {};

    for (const store of storeNames) {
        const fileName = DOC_STORE_FILES[store];
        if (!fileName) {
            health.set(store, 'unavailable');
            loadErrors[store] = hostError({
                code: 'DOC_STORE_UNKNOWN',
                message: `未知资料库：${store}`,
            });
            memory.set(store, new Map());
            continue;
        }
        const r = await serverFiles.readJson(fileName);
        if (!r.ok) {
            health.set(store, 'unavailable');
            loadErrors[store] = r.error;
            memory.set(store, new Map());
            continue;
        }
        if (r.value == null) {
            health.set(store, 'empty');
            memory.set(store, new Map());
            continue;
        }
        try {
            memory.set(store, recordsFromFile(r.value));
            health.set(store, 'ok');
        } catch (err) {
            health.set(store, 'unavailable');
            loadErrors[store] = hostError({
                code: 'DOC_STORE_PARSE',
                message: `解析资料库失败：${store}`,
                cause: err,
                hint: '请勿用空数据覆盖服务器文件',
                context: { store, fileName },
            });
            memory.set(store, new Map());
        }
    }

    const ready = Object.keys(loadErrors).length === 0;

    /**
     * @param {string} store
     */
    function assertWritable(store) {
        const h = health.get(store);
        if (h === 'unavailable') {
            throw loadErrors[store] || hostError({
                code: 'DOC_STORE_UNAVAILABLE',
                message: `资料库不可用：${store}`,
                hint: '服务器文件读取曾失败，禁止用空数据覆盖；请修复后刷新',
                context: { store },
            });
        }
    }

    /**
     * @param {string} store
     * @returns {Map<string, any>}
     */
    function bucket(store) {
        let m = memory.get(store);
        if (!m) {
            m = new Map();
            memory.set(store, m);
        }
        return m;
    }

    /**
     * @param {string} store
     * @param {Map<string, any>} map
     */
    async function persistStore(store, map) {
        assertWritable(store);
        const fileName = DOC_STORE_FILES[store];
        if (!fileName) {
            throw hostError({
                code: 'DOC_STORE_UNKNOWN',
                message: `未知资料库：${store}`,
            });
        }
        const wr = await serverFiles.writeJson(fileName, filePayload(map));
        if (!wr.ok) {
            throw wr.error;
        }
        if (health.get(store) === 'empty') {
            health.set(store, 'ok');
        }
    }

    /**
     * @param {string} store
     * @param {string} indexName
     * @param {IDBValidKey|IDBKeyRange|undefined} query
     * @param {Map<string, any>} map
     */
    function filterByIndex(store, indexName, query, map) {
        const rows = [...map.values()].map(clone);
        if (indexName === 'by_groupId') {
            return rows.filter((r) => r.groupId === query);
        }
        if (indexName === 'by_libraryId') {
            return rows.filter((r) => r.libraryId === query);
        }
        if (indexName === 'by_kind') {
            return rows.filter((r) => r.kind === query);
        }
        if (indexName === 'by_order') {
            return rows;
        }
        if (indexName === 'by_messageId') {
            return rows.filter((r) => r.messageId === query);
        }
        return rows;
    }

    const client = {
        ready,
        loadErrors,

        /**
         * @param {string} store
         * @returns {StoreHealth}
         */
        storeHealth(store) {
            return health.get(store) || 'unavailable';
        },

        getLoadReport() {
            /** @type {{ store: string, error: import('../../infra/errors.js').AppError }[]} */
            const errors = [];
            for (const [store, err] of Object.entries(loadErrors)) {
                errors.push({ store, error: err });
            }
            return { ready, errors };
        },

        async get(store, key) {
            if (health.get(store) === 'unavailable') {
                throw loadErrors[store] || hostError({
                    code: 'DOC_STORE_UNAVAILABLE',
                    message: `资料库不可用：${store}`,
                    context: { store },
                });
            }
            const row = bucket(store).get(normalizeKey(key));
            return row === undefined ? undefined : clone(row);
        },

        async put(store, value, explicitKey) {
            assertWritable(store);
            const row = clone(value);
            const key = explicitKey !== undefined
                ? normalizeKey(explicitKey)
                : keyOf(store, row);
            if (row.id == null && explicitKey !== undefined) {
                row.id = explicitKey;
            }
            const next = new Map(bucket(store));
            next.set(key, row);
            await persistStore(store, next);
            memory.set(store, next);
        },

        async delete(store, key) {
            assertWritable(store);
            const next = new Map(bucket(store));
            next.delete(normalizeKey(key));
            await persistStore(store, next);
            memory.set(store, next);
        },

        async getAll(store) {
            if (health.get(store) === 'unavailable') {
                throw loadErrors[store] || hostError({
                    code: 'DOC_STORE_UNAVAILABLE',
                    message: `资料库不可用：${store}`,
                    context: { store },
                });
            }
            return [...bucket(store).values()].map(clone);
        },

        async getAllByIndex(store, indexName, query) {
            if (health.get(store) === 'unavailable') {
                throw loadErrors[store] || hostError({
                    code: 'DOC_STORE_UNAVAILABLE',
                    message: `资料库不可用：${store}`,
                    context: { store },
                });
            }
            return filterByIndex(store, indexName, query, bucket(store));
        },

        /**
         * 多 store 事务：草稿上同步 mutate → 逐文件写服务器。
         * 每个 store 写服务器成功后立即提交该 store 的内存，保证内存与服务器一致。
         * 部分失败：已成功的 store 内存为新值；失败/未写的 store 内存仍为旧值。
         * @param {string|string[]} storeNamesArg
         * @param {IDBTransactionMode} _mode
         * @param {(stores: Record<string, { put: Function, delete: Function, get: Function }>, tx: object) => void} runner
         */
        async runTransaction(storeNamesArg, _mode, runner) {
            const names = Array.isArray(storeNamesArg) ? storeNamesArg : [storeNamesArg];
            for (const name of names) {
                assertWritable(name);
            }

            /** @type {Map<string, Map<string, any>>} */
            const drafts = new Map();
            for (const name of names) {
                drafts.set(name, new Map(bucket(name)));
            }

            /** @type {Record<string, any>} */
            const fakeStores = {};
            for (const name of names) {
                const m = /** @type {Map<string, any>} */ (drafts.get(name));
                fakeStores[name] = {
                    put(value) {
                        const row = clone(value);
                        m.set(keyOf(name, row), row);
                    },
                    delete(key) {
                        m.delete(normalizeKey(key));
                    },
                    get(key) {
                        return { result: m.has(normalizeKey(key)) ? clone(m.get(normalizeKey(key))) : undefined };
                    },
                };
            }

            try {
                runner(fakeStores, {});
            } catch (err) {
                throw err && typeof err === 'object' && 'category' in err
                    ? err
                    : hostError({
                        code: 'DOC_STORE_TX_RUNNER',
                        message: '资料库保存失败',
                        cause: err,
                    });
            }

            /** @type {string[]} */
            const written = [];
            for (const name of names) {
                try {
                    await persistStore(name, /** @type {Map<string, any>} */ (drafts.get(name)));
                    // 写成功：内存立刻跟服务器对齐
                    memory.set(name, /** @type {Map<string, any>} */ (drafts.get(name)));
                    written.push(name);
                } catch (err) {
                    const pending = names.filter((n) => !written.includes(n) && n !== name);
                    const baseContext = err && typeof err === 'object' && 'context' in err
                        && /** @type {any} */ (err).context
                        && typeof /** @type {any} */ (err).context === 'object'
                        ? { .../** @type {any} */ (err).context }
                        : {};
                    const context = {
                        ...baseContext,
                        partialWriteStores: [...written],
                        failedStore: name,
                        pendingStores: pending,
                    };
                    if (err && typeof err === 'object' && 'category' in err) {
                        /** @type {any} */ (err).context = context;
                        throw err;
                    }
                    throw hostError({
                        code: 'DOC_STORE_TX_PERSIST',
                        message: '资料库写入服务器失败',
                        cause: err,
                        context,
                    });
                }
            }
        },

        close() {
            // 无持有连接
        },
    };

    return client;
}

/**
 * 测试用：内存假文档库（形状同 openServerDocStore，不碰网络）。
 * @param {object} [seed] storeName → rows[]
 * @returns {Awaited<ReturnType<typeof openServerDocStore>>}
 */
export function createMemoryDocStore(seed = {}) {
    /** @type {Map<string, Map<string, any>>} */
    const stores = new Map();
    for (const name of DOC_STORE_NAMES) {
        const m = new Map();
        const rows = seed[name];
        if (Array.isArray(rows)) {
            for (const row of rows) {
                m.set(keyOf(name, row), clone(row));
            }
        }
        stores.set(name, m);
    }

    return {
        ready: true,
        loadErrors: {},
        storeHealth() {
            return /** @type {StoreHealth} */ ('ok');
        },
        getLoadReport() {
            return { ready: true, errors: [] };
        },
        async get(store, key) {
            const row = stores.get(store)?.get(normalizeKey(key));
            return row === undefined ? undefined : clone(row);
        },
        async put(store, value, explicitKey) {
            let m = stores.get(store);
            if (!m) {
                m = new Map();
                stores.set(store, m);
            }
            const row = clone(value);
            const key = explicitKey !== undefined ? normalizeKey(explicitKey) : keyOf(store, row);
            if (row.id == null && explicitKey !== undefined) {
                row.id = explicitKey;
            }
            m.set(key, row);
        },
        async delete(store, key) {
            stores.get(store)?.delete(normalizeKey(key));
        },
        async getAll(store) {
            return [...(stores.get(store)?.values() || [])].map(clone);
        },
        async getAllByIndex(store, indexName, query) {
            const rows = await this.getAll(store);
            if (indexName === 'by_groupId') return rows.filter((r) => r.groupId === query);
            if (indexName === 'by_libraryId') return rows.filter((r) => r.libraryId === query);
            if (indexName === 'by_kind') return rows.filter((r) => r.kind === query);
            if (indexName === 'by_order') return rows;
            if (indexName === 'by_messageId') return rows.filter((r) => r.messageId === query);
            return rows;
        },
        async runTransaction(storeNames, _mode, runner) {
            const names = Array.isArray(storeNames) ? storeNames : [storeNames];
            /** @type {Record<string, any>} */
            const fakeStores = {};
            for (const name of names) {
                let m = stores.get(name);
                if (!m) {
                    m = new Map();
                    stores.set(name, m);
                }
                fakeStores[name] = {
                    put(value) {
                        const row = clone(value);
                        m.set(keyOf(name, row), row);
                    },
                    delete(key) {
                        m.delete(normalizeKey(key));
                    },
                    get(key) {
                        return { result: m.get(normalizeKey(key)) };
                    },
                };
            }
            runner(fakeStores, {});
        },
        close() {},
    };
}
