/**
 * W1-D · 存储适配层：导入导出、重复策略、对账、settings（假 IDB，不碰真实 IndexedDB）
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryIdb } from '../../src/adapters/storage/memory-idb.js';
import {
    buildExportEnvelope,
    parseImportEnvelope,
    resolveDuplicate,
} from '../../src/adapters/storage/import-export.js';
import { mapIdbError, IDB_STORES, IDB_NAME, IDB_VERSION } from '../../src/adapters/storage/idb.js';
import { createCharacterRepo } from '../../src/adapters/storage/repos/character.repo.js';
import { createTagRepo } from '../../src/adapters/storage/repos/tag.repo.js';
import { createArtistRepo } from '../../src/adapters/storage/repos/artist.repo.js';
import { createLlmConfigRepo, createNaiConfigRepo } from '../../src/adapters/storage/repos/api-config.repo.js';
import { createSlotRepo, reconcileSlotIndex } from '../../src/adapters/storage/repos/slot.repo.js';
import { createMessageExtraStore, normalizeNaiExtra } from '../../src/adapters/storage/message-extra.store.js';
import { createImageRepo } from '../../src/adapters/storage/image.repo.js';
import { createSettingsStore } from '../../src/adapters/storage/settings.store.js';
import { assertCharacterRepository, assertTagRepository, assertRepository, assertSlotRepository, assertImageRepository } from '../../src/ports/repository.port.js';
import { isOk, isErr } from '../../src/infra/result.js';
import { emptyNaiCaption } from '../../src/domain/model/nai-params.js';

function sampleGroup(overrides = {}) {
    return {
        schemaVersion: 1,
        id: 'g1',
        name: '组A',
        active: true,
        order: 0,
        createdAt: 't0',
        updatedAt: 't0',
        ...overrides,
    };
}

function sampleChar(overrides = {}) {
    return {
        schemaVersion: 1,
        id: 'c1',
        groupId: 'g1',
        name: '角色',
        keywords: ['alice'],
        fixedFeatures: 'dna',
        variableFeatures: [],
        matchOverrides: null,
        createdAt: 't0',
        updatedAt: 't0',
        ...overrides,
    };
}

function sampleSlot(overrides = {}) {
    return {
        schemaVersion: 1,
        messageId: 3,
        slotId: 1,
        caption: emptyNaiCaption(),
        anchorSentence: '一句。',
        images: [],
        createdAt: 't0',
        presetId: null,
        llmConfigId: null,
        ...overrides,
    };
}

describe('idb schema constants', () => {
    it('exports stable db name/version/stores', () => {
        assert.equal(IDB_NAME, 'nai-dbgen');
        assert.equal(IDB_VERSION, 1);
        assert.ok(IDB_STORES.CHARACTERS);
        assert.ok(IDB_STORES.IMAGES);
        assert.ok(IDB_STORES.SLOT_INDEX);
    });

    it('maps QuotaExceededError with actionable hint', () => {
        const err = mapIdbError(Object.assign(new Error('quota'), { name: 'QuotaExceededError' }));
        assert.equal(err.code, 'IDB_QUOTA_EXCEEDED');
        assert.match(err.hint || '', /GC|清理/);
    });

    it('maps missing IndexedDB to IDB_UNAVAILABLE', () => {
        const err = mapIdbError(Object.assign(new Error('denied'), { name: 'InvalidStateError' }));
        assert.equal(err.code, 'IDB_UNAVAILABLE');
    });
});

describe('import-export helpers', () => {
    it('buildExportEnvelope includes schemaVersion and kind', () => {
        const env = buildExportEnvelope({
            kind: 'artist',
            schemaVersion: 1,
            payload: { items: [] },
        });
        assert.equal(env.kind, 'artist');
        assert.equal(env.schemaVersion, 1);
        assert.ok(env.exportedAt);
        assert.deepEqual(env.items, []);
    });

    it('parseImportEnvelope rejects wrong kind', () => {
        const r = parseImportEnvelope({ kind: 'tag', schemaVersion: 1 }, 'artist');
        assert.equal(r.ok, false);
    });

    it('resolveDuplicate skip/overwrite/rename', () => {
        const incoming = { id: 'a', name: 'A', createdAt: 'new' };
        const existing = { id: 'a', name: 'Old', createdAt: 'old' };
        assert.equal(resolveDuplicate({ incoming, existing, strategy: 'skip' }).action, 'skip');
        const ow = resolveDuplicate({ incoming, existing, strategy: 'overwrite' });
        assert.equal(ow.action, 'write');
        assert.equal(ow.entity.id, 'a');
        assert.equal(ow.entity.createdAt, 'old');
        const rn = resolveDuplicate({ incoming, existing, strategy: 'rename', idPrefix: 'x' });
        assert.equal(rn.action, 'write');
        assert.notEqual(rn.entity.id, 'a');
        assert.match(rn.entity.name, /导入副本/);
    });
});

describe('character repo', () => {
    it('crud + cascade removeGroup + import strategies', async () => {
        const db = createMemoryIdb();
        const repo = createCharacterRepo({ db });
        assert.equal(isOk(assertCharacterRepository(repo)), true);

        assert.equal(isOk(await repo.putGroup(sampleGroup())), true);
        assert.equal(isOk(await repo.put(sampleChar())), true);
        const listed = await repo.listByGroup('g1');
        assert.equal(isOk(listed), true);
        assert.equal(listed.value.length, 1);

        const exported = await repo.exportJson();
        assert.equal(isOk(exported), true);
        assert.equal(exported.value.kind, 'character');
        assert.equal(exported.value.schemaVersion, 1);

        // skip duplicate
        const skip = await repo.importJson(exported.value, { strategy: 'skip' });
        assert.equal(isOk(skip), true);
        assert.equal(skip.value.skipped >= 1, true);

        // overwrite
        const owPayload = {
            ...exported.value,
            groups: [{ ...sampleGroup(), name: '组改名' }],
            characters: [{ ...sampleChar(), name: '角色改名' }],
        };
        const ow = await repo.importJson(owPayload, { strategy: 'overwrite' });
        assert.equal(isOk(ow), true);
        const g = await repo.getGroup('g1');
        assert.equal(g.value.name, '组改名');

        await repo.removeGroup('g1');
        const after = await repo.listByGroup('g1');
        assert.equal(after.value.length, 0);
        assert.equal((await repo.getGroup('g1')).value, null);
    });

    it('onChanged unsubscribe is idempotent', async () => {
        const db = createMemoryIdb();
        const repo = createCharacterRepo({ db });
        let n = 0;
        const off = repo.onChanged(() => { n += 1; });
        await repo.putGroup(sampleGroup({ id: 'g2', name: 'B' }));
        assert.equal(n, 1);
        off();
        off();
        await repo.putGroup(sampleGroup({ id: 'g3', name: 'C' }));
        assert.equal(n, 1);
    });
});

describe('tag repo', () => {
    it('listEntries filters by libraryId', async () => {
        const db = createMemoryIdb();
        const repo = createTagRepo({ db });
        assert.equal(isOk(assertTagRepository(repo)), true);

        await repo.putLibrary({
            schemaVersion: 1, id: 'l1', name: '库1', active: true, createdAt: 't', updatedAt: 't',
        });
        await repo.putLibrary({
            schemaVersion: 1, id: 'l2', name: '库2', active: true, createdAt: 't', updatedAt: 't',
        });
        await repo.put({
            schemaVersion: 1, id: 'e1', libraryId: 'l1', key: 'k1', value: 'v1', createdAt: 't', updatedAt: 't',
        });
        await repo.put({
            schemaVersion: 1, id: 'e2', libraryId: 'l2', key: 'k2', value: 'v2', createdAt: 't', updatedAt: 't',
        });

        const onlyL1 = await repo.listEntries('l1');
        assert.equal(onlyL1.value.length, 1);
        assert.equal(onlyL1.value[0].id, 'e1');
        const all = await repo.listEntries();
        assert.equal(all.value.length, 2);
    });
});

describe('artist / api-config repos', () => {
    it('artist export/import rename', async () => {
        const db = createMemoryIdb();
        const repo = createArtistRepo({ db });
        assert.equal(isOk(assertRepository(repo)), true);
        const artist = {
            schemaVersion: 1,
            id: 'a1',
            name: '串',
            positive: 'p',
            negative: 'n',
            previewImageRef: null,
            createdAt: 't',
            updatedAt: 't',
        };
        await repo.put(artist);
        const exp = await repo.exportJson();
        const again = await repo.importJson(exp.value, { strategy: 'rename' });
        assert.equal(isOk(again), true);
        assert.equal(again.value.imported, 1);
        const list = await repo.list();
        assert.equal(list.value.length, 2);
    });

    it('llm and nai repos are separate stores', async () => {
        const db = createMemoryIdb();
        const llm = createLlmConfigRepo({ db });
        const nai = createNaiConfigRepo({ db });
        await llm.put({
            schemaVersion: 1, id: 'l1', name: 'L', baseUrl: 'https://x', apiKey: 'k',
            model: 'm', transport: 'direct', createdAt: 't', updatedAt: 't',
        });
        await nai.put({
            schemaVersion: 1, id: 'n1', name: 'N', baseUrl: 'https://y', apiKey: 'k',
            transport: 'direct', decoder: 'auto', createdAt: 't', updatedAt: 't',
        });
        assert.equal((await llm.list()).value.length, 1);
        assert.equal((await nai.list()).value.length, 1);
        assert.equal((await llm.get('n1')).value, null);
    });
});

describe('message-extra + slot dual-write', () => {
    it('normalizes polluted extra', () => {
        assert.deepEqual(normalizeNaiExtra(null).slots, []);
        assert.deepEqual(normalizeNaiExtra('x').slots, []);
        assert.deepEqual(normalizeNaiExtra({ slots: 'bad' }).slots, []);
        const ok = normalizeNaiExtra({ slots: [sampleSlot()] });
        assert.equal(ok.slots.length, 1);
    });

    it('authority wins reconcile; swipe-shaped host store', async () => {
        /** @type {Record<number, object>} */
        const extras = {};
        const host = {
            readMessageExtra(messageId) {
                return extras[messageId] ? { ...extras[messageId] } : {};
            },
            async writeMessageExtra(messageId, patch) {
                extras[messageId] = { ...(extras[messageId] || {}), ...patch };
                return { ok: true, value: undefined };
            },
        };
        const messageExtra = createMessageExtraStore({ host });
        const db = createMemoryIdb();
        const slots = createSlotRepo({ db, messageExtra });
        assert.equal(isOk(assertSlotRepository(slots)), true);

        const rec = sampleSlot({ slotId: 1, messageId: 7 });
        const put = await slots.put(7, [rec]);
        assert.equal(isOk(put), true);

        // 权威在 extra
        assert.equal(messageExtra.read(7).slots.length, 1);
        // 索引也在
        const idx = await db.getAll(IDB_STORES.SLOT_INDEX);
        assert.equal(idx.length, 1);

        // 污染索引：多一条 orphan
        await db.put(IDB_STORES.SLOT_INDEX, {
            messageId: 7, slotId: 99, imageCount: 0, latestImageRef: null, anchorPreview: '', updatedAt: 't',
        });
        const recon = await reconcileSlotIndex({ db, messageExtra, messageId: 7 });
        assert.equal(isOk(recon), true);
        assert.equal(recon.value.removed, 1);
        const idx2 = await db.getAll(IDB_STORES.SLOT_INDEX);
        assert.equal(idx2.length, 1);
        assert.equal(idx2[0].slotId, 1);

        // recordImage
        const img = await slots.recordImage(7, 1, 'img_x', { naiConfigId: 'n1' });
        assert.equal(isOk(img), true);
        assert.equal(img.value.images.length, 1);
        assert.equal(img.value.images[0].imageRef, 'img_x');
    });
});

describe('image repo', () => {
    it('put/gc with liveRefs', async () => {
        const db = createMemoryIdb();
        const images = createImageRepo({ db });
        assert.equal(isOk(assertImageRepository(images)), true);

        const blob = new Blob(['abc'], { type: 'image/png' });
        const put1 = await images.put(blob);
        const put2 = await images.put(blob);
        assert.equal(isOk(put1) && isOk(put2), true);

        const gc = await images.gc([put1.value]);
        assert.equal(isOk(gc), true);
        assert.equal(gc.value.removed, 1);
        assert.equal((await db.getAll(IDB_STORES.IMAGES)).length, 1);
    });
});

describe('settings store', () => {
    it('migrates and drops unknown keys via mergePluginSettings', () => {
        /** @type {Record<string, any>} */
        const extensionSettings = {
            'nai-dbgen': {
                schemaVersion: 1,
                activeArtistId: 'a1',
                unknownKeyShouldDrop: true,
            },
        };
        let saved = 0;
        const store = createSettingsStore({
            getContext: () => ({
                extensionSettings,
                saveSettingsDebounced: () => { saved += 1; },
            }),
        });

        const loaded = store.load();
        assert.equal(loaded.activeArtistId, 'a1');
        assert.equal('unknownKeyShouldDrop' in loaded, false);

        store.set('autoWriteSlots', true);
        assert.equal(store.get('autoWriteSlots'), true);
        assert.equal(saved >= 1, true);
        assert.equal('unknownKeyShouldDrop' in extensionSettings['nai-dbgen'], false);
        assert.equal(extensionSettings['nai-dbgen'].autoWriteSlots, true);
    });
});
