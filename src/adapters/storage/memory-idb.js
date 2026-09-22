/**
 * 内存假 IndexedDB 客户端，形状对齐 openIdb 返回值。单测用，不碰真实 IndexedDB。
 */

/**
 * @param {object} [seed] storeName → rows[]
 * @returns {object}
 */
export function createMemoryIdb(seed = {}) {
    /** @type {Map<string, Map<string, any>>} */
    const stores = new Map();

    /**
     * @param {string} name
     */
    function bucket(name) {
        let m = stores.get(name);
        if (!m) {
            m = new Map();
            stores.set(name, m);
            const rows = seed[name];
            if (Array.isArray(rows)) {
                for (const row of rows) {
                    const key = keyOf(name, row);
                    m.set(key, clone(row));
                }
            }
        }
        return m;
    }

    /**
     * @param {string} store
     * @param {any} row
     * @returns {string}
     */
    function keyOf(store, row) {
        if (store === 'slot_index') {
            return `${row.messageId}::${row.slotId}`;
        }
        return String(row.id);
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

    return {
        async get(store, key) {
            const m = bucket(store);
            const row = m.get(normalizeKey(key));
            return row === undefined ? undefined : clone(row);
        },
        async put(store, value, explicitKey) {
            const m = bucket(store);
            const row = clone(value);
            const key = explicitKey !== undefined
                ? normalizeKey(explicitKey)
                : keyOf(store, row);
            if (store !== 'slot_index' && row.id == null && explicitKey !== undefined) {
                row.id = explicitKey;
            }
            m.set(key, row);
        },
        async delete(store, key) {
            bucket(store).delete(normalizeKey(key));
        },
        async getAll(store) {
            return [...bucket(store).values()].map(clone);
        },
        async getAllByIndex(store, indexName, query) {
            const rows = await this.getAll(store);
            if (indexName === 'by_groupId') {
                return rows.filter((r) => r.groupId === query);
            }
            if (indexName === 'by_libraryId') {
                return rows.filter((r) => r.libraryId === query);
            }
            if (indexName === 'by_messageId') {
                return rows.filter((r) => r.messageId === query);
            }
            if (indexName === 'by_kind') {
                return rows.filter((r) => r.kind === query);
            }
            if (indexName === 'by_order') {
                return rows;
            }
            return rows;
        },
        async runTransaction(storeNames, _mode, runner) {
            /** @type {Record<string, any>} */
            const fakeStores = {};
            for (const name of storeNames) {
                const m = bucket(name);
                fakeStores[name] = {
                    put(value) {
                        m.set(keyOf(name, value), clone(value));
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

/**
 * @param {any} v
 */
function clone(v) {
    if (v == null || typeof v !== 'object') {
        return v;
    }
    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(v);
        } catch {
            // Blob 等
        }
    }
    if (typeof Blob !== 'undefined' && v instanceof Blob) {
        return v;
    }
    return JSON.parse(JSON.stringify(v));
}
