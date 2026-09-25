/**
 * server-doc-store：加载 404/失败语义、写后内存、事务部分失败。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    openServerDocStore,
    createMemoryDocStore,
    DOC_STORE_FILES,
} from '../../src/adapters/storage/server-doc-store.js';
import { createServerFiles, SERVER_FILE_PREFIX, base64ToUtf8, utf8ToBase64, serverFilePath } from '../../src/adapters/storage/server-files.js';
import { IDB_STORES } from '../../src/adapters/storage/idb.js';
import { Ok, Err, isOk, isErr } from '../../src/infra/result.js';
import { hostError } from '../../src/infra/errors.js';

function fakeServerFiles(disk) {
    return createServerFiles({
        getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
        fetch: async (url, init) => {
            const u = String(url);
            if (u.startsWith('/api/files/upload')) {
                const body = JSON.parse(String(init.body));
                disk.set(body.name, body.data);
                return { ok: true, status: 200, json: async () => ({ path: serverFilePath(body.name) }) };
            }
            if (u.startsWith('/api/files/delete')) {
                const body = JSON.parse(String(init.body));
                const name = String(body.path).replace(/^\/user\/files\//, '');
                disk.delete(name);
                return { ok: true, status: 200 };
            }
            if (u.includes('/user/files/')) {
                const name = u.replace(/^\/user\/files\//, '').split('?')[0];
                if (!disk.has(name)) {
                    return { ok: false, status: 404, text: async () => '' };
                }
                return {
                    ok: true,
                    status: 200,
                    text: async () => base64ToUtf8(/** @type {string} */ (disk.get(name))),
                };
            }
            return { ok: false, status: 500, text: async () => 'nope' };
        },
    });
}

describe('server-doc-store', () => {
    it('404 on load → empty store, ready', async () => {
        const disk = new Map();
        const db = await openServerDocStore({ serverFiles: fakeServerFiles(disk) });
        assert.equal(db.ready, true);
        assert.deepEqual(await db.getAll(IDB_STORES.ARTISTS), []);
        assert.equal(db.storeHealth(IDB_STORES.ARTISTS), 'empty');
    });

    it('non-404 read failure → unavailable, never overwrite with empty', async () => {
        const file = DOC_STORE_FILES[IDB_STORES.ARTISTS];
        let writes = 0;
        const serverFiles = {
            async readJson(name) {
                if (name === file) {
                    return Err(hostError({ code: 'SERVER_FILE_READ_FAILED', message: '500' }));
                }
                return Ok(null);
            },
            async writeJson() {
                writes += 1;
                return Ok(undefined);
            },
            async writeBase64() { return Ok(undefined); },
            urlOf: (n) => `/user/files/${n}`,
            async remove() { return Ok(undefined); },
            async exists() { return Ok({}); },
        };
        const db = await openServerDocStore({ serverFiles });
        assert.equal(db.ready, false);
        assert.equal(db.storeHealth(IDB_STORES.ARTISTS), 'unavailable');
        await assert.rejects(() => db.put(IDB_STORES.ARTISTS, { id: 'a1', name: 'x' }));
        assert.equal(writes, 0);
    });

    it('unexpected JSON shape → unavailable (not treated as empty)', async () => {
        const file = DOC_STORE_FILES[IDB_STORES.ARTISTS];
        const serverFiles = {
            async readJson(name) {
                if (name === file) {
                    return Ok({ schemaVersion: 1, foo: 'bar' });
                }
                return Ok(null);
            },
            async writeJson() {
                throw new Error('must not write');
            },
            async writeBase64() { return Ok(undefined); },
            urlOf: (n) => `/user/files/${n}`,
            async remove() { return Ok(undefined); },
            async exists() { return Ok({}); },
        };
        const db = await openServerDocStore({ serverFiles });
        assert.equal(db.storeHealth(IDB_STORES.ARTISTS), 'unavailable');
        await assert.rejects(() => db.put(IDB_STORES.ARTISTS, { id: 'a1' }));
    });

    it('put writes server then memory', async () => {
        const disk = new Map();
        const db = await openServerDocStore({ serverFiles: fakeServerFiles(disk) });
        await db.put(IDB_STORES.ARTISTS, {
            schemaVersion: 1,
            id: 'ar1',
            name: '画师',
            positivePrompt: 'a',
            negativePrompt: '',
            referenceImageRef: null,
            createdAt: 't',
            updatedAt: 't',
        });
        assert.ok(disk.has(`${SERVER_FILE_PREFIX}artists.json`));
        const row = await db.get(IDB_STORES.ARTISTS, 'ar1');
        assert.equal(row.name, '画师');
    });

    it('runTransaction partial failure keeps memory aligned with server', async () => {
        const disk = new Map();
        const base = fakeServerFiles(disk);
        let artistWrites = 0;
        const serverFiles = {
            ...base,
            async writeJson(name, value) {
                if (name === DOC_STORE_FILES[IDB_STORES.ARTISTS]) {
                    artistWrites += 1;
                    if (artistWrites >= 2) {
                        return Err(hostError({ code: 'SERVER_FILE_UPLOAD_FAILED', message: 'fail' }));
                    }
                }
                return base.writeJson(name, value);
            },
        };
        const db = await openServerDocStore({ serverFiles });
        await db.put(IDB_STORES.PRESETS, {
            id: 'p1', name: 'P', kind: 'recall', prompts: [], prompt_order: [],
            schemaVersion: 1, createdAt: 't', updatedAt: 't',
        });
        await db.put(IDB_STORES.ARTISTS, {
            id: 'a1', name: 'old', positivePrompt: '', negativePrompt: '', referenceImageRef: null,
            schemaVersion: 1, createdAt: 't', updatedAt: 't',
        });

        /** @type {any} */
        let caught = null;
        try {
            await db.runTransaction(
                [IDB_STORES.PRESETS, IDB_STORES.ARTISTS],
                'readwrite',
                (stores) => {
                    stores[IDB_STORES.PRESETS].put({
                        id: 'p1', name: 'NEW', kind: 'recall', prompts: [], prompt_order: [],
                        schemaVersion: 1, createdAt: 't', updatedAt: 't',
                    });
                    stores[IDB_STORES.ARTISTS].put({
                        id: 'a1', name: 'NEW', positivePrompt: '', negativePrompt: '', referenceImageRef: null,
                        schemaVersion: 1, createdAt: 't', updatedAt: 't',
                    });
                },
            );
        } catch (err) {
            caught = err;
        }
        assert.ok(caught, 'expected transaction to fail');
        assert.deepEqual(caught.context?.partialWriteStores, [IDB_STORES.PRESETS]);
        assert.equal(caught.context?.failedStore, IDB_STORES.ARTISTS);

        // 第 1 个已写成功 → 内存为新值；第 2 个失败 → 内存仍旧值
        assert.equal((await db.get(IDB_STORES.PRESETS, 'p1')).name, 'NEW');
        assert.equal((await db.get(IDB_STORES.ARTISTS, 'a1')).name, 'old');

        // 之后再写第 1 个 store，不得用旧内存覆盖掉 NEW
        await db.put(IDB_STORES.PRESETS, {
            id: 'p2', name: 'extra', kind: 'recall', prompts: [], prompt_order: [],
            schemaVersion: 1, createdAt: 't', updatedAt: 't',
        });
        const presets = await db.getAll(IDB_STORES.PRESETS);
        const byId = Object.fromEntries(presets.map((p) => [p.id, p.name]));
        assert.equal(byId.p1, 'NEW');
        assert.equal(byId.p2, 'extra');
    });

    it('createMemoryDocStore works for repos', async () => {
        const db = createMemoryDocStore();
        await db.put(IDB_STORES.LLM_CONFIGS, { id: 'l1', name: 'L' });
        assert.equal((await db.getAll(IDB_STORES.LLM_CONFIGS)).length, 1);
        assert.equal(db.ready, true);
    });
});
