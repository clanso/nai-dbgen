/**
 * W1-D · 存储适配层：导入导出、重复策略、对账、GC 安全、settings（假 IDB）
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
import { createPresetRepo } from '../../src/adapters/storage/repos/preset.repo.js';
import { createLlmConfigRepo, createNaiConfigRepo } from '../../src/adapters/storage/repos/api-config.repo.js';
import { createSlotRepo, reconcileSlotIndex } from '../../src/adapters/storage/repos/slot.repo.js';
import {
    createMessageExtraStore,
    normalizeNaiExtra,
    parseNaiExtra,
    MESSAGE_EXTRA_NS,
} from '../../src/adapters/storage/message-extra.store.js';
import { createImageRepo, collectLiveRefs } from '../../src/adapters/storage/image.repo.js';
import { createSettingsStore } from '../../src/adapters/storage/settings.store.js';
import {
    assertCharacterRepository,
    assertTagRepository,
    assertRepository,
    assertSlotRepository,
    assertImageRepository,
} from '../../src/ports/repository.port.js';
import { isOk, isErr } from '../../src/infra/result.js';
import { emptyNaiCaption } from '../../src/domain/model/nai-params.js';
import { defaultPluginSettings } from '../../src/domain/model/plugin-settings.js';

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

function fakeHostExtras() {
    /** @type {Record<number, object>} */
    const extras = {};
    return {
        extras,
        host: {
            readMessageExtra(messageId) {
                return extras[messageId] ? { ...extras[messageId] } : {};
            },
            async writeMessageExtra(messageId, patch) {
                extras[messageId] = { ...(extras[messageId] || {}), ...patch };
                return { ok: true, value: undefined };
            },
        },
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

        const skip = await repo.importJson(exported.value, { strategy: 'skip' });
        assert.equal(isOk(skip), true);
        assert.equal(skip.value.skipped >= 1, true);

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

    it('export→import overwrite is deep-equal lossless', async () => {
        const db = createMemoryIdb();
        const repo = createCharacterRepo({ db });
        await repo.putGroup(sampleGroup());
        await repo.put(sampleChar({
            keywords: ['alice', '/foo,bar/i'],
            variableFeatures: [{ name: '衣', prompt: 'dress' }],
        }));
        const before = await repo.exportJson();
        const db2 = createMemoryIdb();
        const repo2 = createCharacterRepo({ db: db2 });
        const imp = await repo2.importJson(before.value, { strategy: 'overwrite' });
        assert.equal(isOk(imp), true);
        const after = await repo2.exportJson();
        assert.deepEqual(after.value.groups, before.value.groups);
        assert.deepEqual(after.value.characters, before.value.characters);
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

    it('export→import overwrite is deep-equal lossless', async () => {
        const db = createMemoryIdb();
        const repo = createTagRepo({ db });
        await repo.putLibrary({
            schemaVersion: 1, id: 'l1', name: '库1', active: true, createdAt: 't', updatedAt: 't',
        });
        await repo.put({
            schemaVersion: 1, id: 'e1', libraryId: 'l1', key: 'k1', value: 'v1', createdAt: 't', updatedAt: 't',
        });
        const before = await repo.exportJson();
        const db2 = createMemoryIdb();
        const repo2 = createTagRepo({ db: db2 });
        assert.equal(isOk(await repo2.importJson(before.value, { strategy: 'overwrite' })), true);
        const after = await repo2.exportJson();
        assert.deepEqual(after.value.libraries, before.value.libraries);
        assert.deepEqual(after.value.entries, before.value.entries);
    });
});

describe('artist / preset / api-config repos', () => {
    it('artist export→import overwrite deep-equal', async () => {
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
        const before = await repo.exportJson();
        const db2 = createMemoryIdb();
        const repo2 = createArtistRepo({ db: db2 });
        assert.equal(isOk(await repo2.importJson(before.value, { strategy: 'overwrite' })), true);
        const after = await repo2.exportJson();
        assert.deepEqual(after.value.items, before.value.items);
    });

    it('preset export→import overwrite deep-equal', async () => {
        const db = createMemoryIdb();
        const repo = createPresetRepo({ db });
        const preset = {
            schemaVersion: 1,
            id: 'p1',
            name: '生图',
            kind: 'imagegen',
            prompts: [{
                identifier: 'main', name: 'Main', role: 'system', content: 'hi',
                enabled: true, injection_position: 0, injection_depth: 0, injection_order: 100,
            }],
            prompt_order: [{ identifier: 'main', enabled: true }],
            createdAt: 't',
            updatedAt: 't',
        };
        await repo.put(preset);
        const before = await repo.exportJson();
        const db2 = createMemoryIdb();
        const repo2 = createPresetRepo({ db: db2 });
        assert.equal(isOk(await repo2.importJson(before.value, { strategy: 'overwrite' })), true);
        const after = await repo2.exportJson();
        assert.deepEqual(after.value.items, before.value.items);
    });

    it('artist export/import rename', async () => {
        const db = createMemoryIdb();
        const repo = createArtistRepo({ db });
        await repo.put({
            schemaVersion: 1, id: 'a1', name: '串', positive: 'p', negative: 'n',
            previewImageRef: null, createdAt: 't', updatedAt: 't',
        });
        const exp = await repo.exportJson();
        const again = await repo.importJson(exp.value, { strategy: 'rename' });
        assert.equal(isOk(again), true);
        assert.equal(again.value.imported, 1);
        assert.equal((await repo.list()).value.length, 2);
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

describe('message-extra parse / read failure', () => {
    it('parseNaiExtra: null/empty Ok; corrupt Err', () => {
        assert.equal(isOk(parseNaiExtra(null)), true);
        assert.equal(parseNaiExtra(null).value.slots.length, 0);
        assert.equal(isOk(parseNaiExtra({})), true);
        assert.equal(isErr(parseNaiExtra('x')), true);
        assert.equal(parseNaiExtra('x').error.code, 'MESSAGE_EXTRA_CORRUPT');
        assert.equal(isErr(parseNaiExtra({ slots: 'bad' })), true);
        assert.equal(isOk(parseNaiExtra({ slots: [sampleSlot()] })), true);
    });

    it('read host throw → Err, not empty slots', () => {
        const store = createMessageExtraStore({
            host: {
                readMessageExtra() {
                    throw new Error('boom');
                },
                async writeMessageExtra() {
                    return { ok: true, value: undefined };
                },
            },
        });
        const r = store.read(1);
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'MESSAGE_EXTRA_READ_FAILED');
    });

    it('write rejects invalid slots (no silent drop)', async () => {
        const { host } = fakeHostExtras();
        const store = createMessageExtraStore({ host });
        const r = await store.write(1, {
            slots: [
                sampleSlot({ messageId: 1 }),
                { not: 'a slot' },
            ],
        });
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'MESSAGE_EXTRA_SLOT_INVALID');
        // 未落盘
        assert.equal(isOk(store.read(1)) && store.read(1).value.slots.length === 0, true);
    });

    it('authority wins reconcile; read Result', async () => {
        const { host, extras } = fakeHostExtras();
        const messageExtra = createMessageExtraStore({ host });
        const db = createMemoryIdb();
        const slots = createSlotRepo({ db, messageExtra });
        assert.equal(isOk(assertSlotRepository(slots)), true);

        const rec = sampleSlot({ slotId: 1, messageId: 7 });
        assert.equal(isOk(await slots.put(7, [rec])), true);

        const readOk = messageExtra.read(7);
        assert.equal(isOk(readOk), true);
        assert.equal(readOk.value.slots.length, 1);

        await db.put(IDB_STORES.SLOT_INDEX, {
            messageId: 7, slotId: 99, imageCount: 0, latestImageRef: null, anchorPreview: '', updatedAt: 't',
        });
        const recon = await reconcileSlotIndex({ db, messageExtra, messageId: 7 });
        assert.equal(isOk(recon), true);
        assert.equal(recon.value.removed, 1);

        const img = await slots.recordImage(7, 1, 'img_x', { naiConfigId: 'n1' });
        assert.equal(isOk(img), true);
        assert.equal(img.value.images[0].imageRef, 'img_x');
        void extras;
    });

    it('reconcile does not wipe index when read fails', async () => {
        const db = createMemoryIdb();
        await db.put(IDB_STORES.SLOT_INDEX, {
            messageId: 1, slotId: 1, imageCount: 0, latestImageRef: null, anchorPreview: '', updatedAt: 't',
        });
        const messageExtra = createMessageExtraStore({
            host: {
                readMessageExtra() {
                    throw new Error('fail');
                },
                async writeMessageExtra() {
                    return { ok: true, value: undefined };
                },
            },
        });
        const recon = await reconcileSlotIndex({ db, messageExtra, messageId: 1 });
        assert.equal(isErr(recon), true);
        assert.equal((await db.getAll(IDB_STORES.SLOT_INDEX)).length, 1);
    });
});

describe('image repo D22 / D23', () => {
    it('gc([]) and gc(undefined) return Err and keep all blobs', async () => {
        const db = createMemoryIdb();
        const images = createImageRepo({ db });
        assert.equal(isOk(assertImageRepository(images)), true);
        const blob = new Blob(['abc'], { type: 'image/png' });
        const put1 = await images.put(blob);
        const put2 = await images.put(blob);
        assert.equal(isOk(put1) && isOk(put2), true);

        const empty = await images.gc([]);
        assert.equal(isErr(empty), true);
        assert.equal(empty.error.code, 'IMAGE_GC_EMPTY_LIVE_REFS');
        assert.equal((await db.getAll(IDB_STORES.IMAGES)).length, 2);

        const bad = await images.gc(/** @type {any} */ (undefined));
        assert.equal(isErr(bad), true);
        assert.equal(bad.error.code, 'IMAGE_GC_INVALID_LIVE_REFS');
        assert.equal((await db.getAll(IDB_STORES.IMAGES)).length, 2);
    });

    it('gc([], { force: true }) clears all', async () => {
        const db = createMemoryIdb();
        const images = createImageRepo({ db });
        const blob = new Blob(['x'], { type: 'image/png' });
        await images.put(blob);
        await images.put(blob);
        const cleared = await images.gc([], { force: true });
        assert.equal(isOk(cleared), true);
        assert.equal(cleared.value.removed, 2);
        assert.equal((await db.getAll(IDB_STORES.IMAGES)).length, 0);
    });

    it('put/gc with liveRefs keeps listed', async () => {
        const db = createMemoryIdb();
        const images = createImageRepo({ db });
        const blob = new Blob(['abc'], { type: 'image/png' });
        const put1 = await images.put(blob);
        const put2 = await images.put(blob);
        const gc = await images.gc([put1.value]);
        assert.equal(isOk(gc), true);
        assert.equal(gc.value.removed, 1);
        assert.equal((await db.getAll(IDB_STORES.IMAGES)).length, 1);
        void put2;
    });

    it('collectLiveRefs scans extra + all swipe_info extras', () => {
        const message = {
            extra: {
                [MESSAGE_EXTRA_NS]: {
                    schemaVersion: 1,
                    slots: [sampleSlot({
                        images: [{ imageRef: 'img_cur', createdAt: 't', naiConfigId: null, artistId: null }],
                    })],
                },
            },
            swipe_info: [
                {
                    extra: {
                        [MESSAGE_EXTRA_NS]: {
                            schemaVersion: 1,
                            slots: [sampleSlot({
                                slotId: 2,
                                images: [
                                    { imageRef: 'img_swipe0', createdAt: 't', naiConfigId: null, artistId: null },
                                    { imageRef: 'img_cur', createdAt: 't', naiConfigId: null, artistId: null },
                                ],
                            })],
                        },
                    },
                },
                {
                    extra: {
                        [MESSAGE_EXTRA_NS]: {
                            schemaVersion: 1,
                            slots: [sampleSlot({
                                slotId: 3,
                                images: [{ imageRef: 'img_swipe1', createdAt: 't', naiConfigId: null, artistId: null }],
                            })],
                        },
                    },
                },
            ],
        };
        const refs = collectLiveRefs(message).sort();
        assert.deepEqual(refs, ['img_cur', 'img_swipe0', 'img_swipe1']);
    });

    it('gc with collectLiveRefs keeps swipe-only images', async () => {
        const db = createMemoryIdb();
        const images = createImageRepo({ db });
        const blob = new Blob(['z'], { type: 'image/png' });
        const cur = await images.put(blob);
        const swipeOnly = await images.put(blob);
        const orphan = await images.put(blob);
        assert.equal(isOk(cur) && isOk(swipeOnly) && isOk(orphan), true);

        const message = {
            extra: {
                [MESSAGE_EXTRA_NS]: {
                    schemaVersion: 1,
                    slots: [sampleSlot({
                        images: [{ imageRef: cur.value, createdAt: 't', naiConfigId: null, artistId: null }],
                    })],
                },
            },
            swipe_info: [{
                extra: {
                    [MESSAGE_EXTRA_NS]: {
                        schemaVersion: 1,
                        slots: [sampleSlot({
                            slotId: 9,
                            images: [{ imageRef: swipeOnly.value, createdAt: 't', naiConfigId: null, artistId: null }],
                        })],
                    },
                },
            }],
        };

        const live = collectLiveRefs(message);
        assert.ok(live.includes(cur.value));
        assert.ok(live.includes(swipeOnly.value));
        assert.equal(live.includes(orphan.value), false);

        const gc = await images.gc(live);
        assert.equal(isOk(gc), true);
        assert.equal(gc.value.removed, 1);
        const left = (await db.getAll(IDB_STORES.IMAGES)).map((r) => r.id).sort();
        assert.deepEqual(left.sort(), [cur.value, swipeOnly.value].sort());
    });
});

describe('settings store D15', () => {
    it('load/save via host only; merge drops unknown keys', () => {
        /** @type {ReturnType<typeof defaultPluginSettings>} */
        let stored = {
            ...defaultPluginSettings(),
            activeArtistId: 'a1',
        };
        /** @type {any} */
        stored = { ...stored, unknownKeyShouldDrop: true };

        let saveCount = 0;
        const store = createSettingsStore({
            host: {
                loadSettings() {
                    return stored;
                },
                saveSettings(settings) {
                    saveCount += 1;
                    stored = settings;
                },
            },
        });

        const loaded = store.load();
        assert.equal(loaded.activeArtistId, 'a1');
        assert.equal('unknownKeyShouldDrop' in loaded, false);

        store.set('autoWriteSlots', true);
        assert.equal(store.get('autoWriteSlots'), true);
        assert.equal(saveCount >= 1, true);
        assert.equal(stored.autoWriteSlots, true);
        assert.equal('unknownKeyShouldDrop' in stored, false);
    });

    it('rejects missing host', () => {
        assert.throws(() => createSettingsStore(/** @type {any} */ ({ getContext: () => ({}) })));
    });
});

// soft normalize still available for collectLiveRefs
describe('normalizeNaiExtra soft path', () => {
    it('soft-normalizes garbage to empty (collectLiveRefs only)', () => {
        assert.deepEqual(normalizeNaiExtra(null).slots, []);
        assert.deepEqual(normalizeNaiExtra('x').slots, []);
    });
});
