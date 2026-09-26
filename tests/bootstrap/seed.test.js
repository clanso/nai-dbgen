/**
 * 种子资产：校验、渲染变量、幂等 / 不覆盖 / 删后不复活、失败不阻断。
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validatePreset } from '../../src/domain/model/preset.js';
import { validateArtist } from '../../src/domain/model/artist.js';
import { validateLlmApiConfig, validateNaiApiConfig } from '../../src/domain/model/api-config.js';
import { createMemoryIdb } from '../../src/adapters/storage/memory-idb.js';
import { createPresetRepo } from '../../src/adapters/storage/repos/preset.repo.js';
import { createArtistRepo } from '../../src/adapters/storage/repos/artist.repo.js';
import { createLlmConfigRepo, createNaiConfigRepo } from '../../src/adapters/storage/repos/api-config.repo.js';
import { defaultPluginSettings } from '../../src/domain/model/plugin-settings.js';
import {
    installSeedAssets,
    loadSeedEnvelopeFromDisk,
    readSeedLedger,
    writeSeedLedger,
    smokeRenderSeedPreset,
    SEED_LEDGER_KEY,
    SEED_ASSET_FILES,
    SEED_LLM_DEFAULT_ID,
    SEED_NAI_DEFAULT_ID,
    SEED_LEDGER_EXTENSION_KEY,
} from '../../src/bootstrap/seed.js';

const seedDir = join(dirname(fileURLToPath(import.meta.url)), '../../assets/seed');

/**
 * @returns {{ getItem: (k: string) => string|null, setItem: (k: string, v: string) => void, _map: Map<string, string> }}
 */
function memoryStorage() {
    /** @type {Map<string, string>} */
    const map = new Map();
    return {
        _map: map,
        getItem(k) {
            return map.has(k) ? /** @type {string} */ (map.get(k)) : null;
        },
        setItem(k, v) {
            map.set(k, String(v));
        },
    };
}

/**
 * @param {object} [overrides]
 */
function makeDeps(overrides = {}) {
    const db = overrides.db || createMemoryIdb();
    const preset = createPresetRepo({ db });
    const artist = createArtistRepo({ db });
    const llmConfig = createLlmConfigRepo({ db });
    const naiConfig = createNaiConfigRepo({ db });
    /** @type {import('../../src/domain/model/plugin-settings.js').PluginSettings} */
    let settings = { ...defaultPluginSettings(), ...(overrides.settings || {}) };
    const storage = overrides.storage || memoryStorage();
    const extensionSettings = overrides.extensionSettings || {};
    const getContext = overrides.getContext || (() => ({
        extensionSettings,
        saveSettingsDebounced() {},
    }));
    return {
        db,
        storage,
        extensionSettings,
        get settings() {
            return settings;
        },
        setSettings(next) {
            settings = next;
        },
        deps: {
            repos: { preset, artist, llmConfig, naiConfig },
            loadSettings: () => settings,
            saveSettings: (s) => {
                settings = s;
            },
            storage,
            getContext,
            envelopes: overrides.envelopes,
            loadEnvelope: overrides.loadEnvelope,
        },
    };
}

describe('assets/seed envelopes', () => {
    it('SEED_ASSET_FILES 均可从磁盘加载且 kind 正确', async () => {
        for (const name of SEED_ASSET_FILES) {
            const env = await loadSeedEnvelopeFromDisk(name);
            assert.equal(typeof env.schemaVersion, 'number');
            assert.ok(
                ['preset', 'artist', 'llm-config', 'nai-config'].includes(String(env.kind)),
                name,
            );
            assert.ok(Array.isArray(env.items), name);
        }
    });

    it('preset-imagegen / preset-recall / single-* 通过 validatePreset', () => {
        const imagegen = JSON.parse(readFileSync(join(seedDir, 'preset-imagegen.json'), 'utf8'));
        const recall = JSON.parse(readFileSync(join(seedDir, 'preset-recall.json'), 'utf8'));
        const singleRecall = JSON.parse(readFileSync(join(seedDir, 'preset-single-recall.json'), 'utf8'));
        const singleImagegen = JSON.parse(readFileSync(join(seedDir, 'preset-single-imagegen.json'), 'utf8'));
        assert.equal(imagegen.kind, 'preset');
        assert.equal(recall.kind, 'preset');
        for (const item of imagegen.items) {
            const r = validatePreset(item);
            assert.equal(r.ok, true, r.error?.message);
            assert.equal(r.value.kind, 'imagegen');
        }
        for (const item of recall.items) {
            const r = validatePreset(item);
            assert.equal(r.ok, true, r.error?.message);
            assert.equal(r.value.kind, 'recall');
        }
        for (const item of singleRecall.items) {
            const r = validatePreset(item);
            assert.equal(r.ok, true, r.error?.message);
            assert.equal(r.value.kind, 'single-recall');
        }
        for (const item of singleImagegen.items) {
            const r = validatePreset(item);
            assert.equal(r.ok, true, r.error?.message);
            assert.equal(r.value.kind, 'single-imagegen');
        }
    });

    it('artists 信封为空数组（对齐 app builtin-styles.json 空白分发）', () => {
        const artists = JSON.parse(readFileSync(join(seedDir, 'artists.json'), 'utf8'));
        assert.equal(artists.kind, 'artist');
        assert.equal(artists.items.length, 0);
    });

    it('默认 LLM / NAI 信封通过校验', () => {
        const llm = JSON.parse(readFileSync(join(seedDir, 'llm-default.json'), 'utf8'));
        const nai = JSON.parse(readFileSync(join(seedDir, 'nai-default.json'), 'utf8'));
        assert.equal(llm.kind, 'llm-config');
        assert.equal(nai.kind, 'nai-config');
        assert.equal(llm.items.length, 1);
        assert.equal(nai.items.length, 1);
        const lr = validateLlmApiConfig(llm.items[0]);
        const nr = validateNaiApiConfig(nai.items[0]);
        assert.equal(lr.ok, true, lr.error?.message);
        assert.equal(nr.ok, true, nr.error?.message);
        assert.equal(lr.value.id, SEED_LLM_DEFAULT_ID);
        assert.equal(lr.value.name, '默认 LLM');
        assert.equal(lr.value.baseUrl, '');
        assert.equal(lr.value.secretId, null);
        assert.equal(nr.value.id, SEED_NAI_DEFAULT_ID);
        assert.equal(nr.value.name, '默认 NAI');
        assert.equal(nr.value.baseUrl, 'https://image.novelai.net');
        assert.equal(nr.value.apiKey, '');
    });

    it('渲染后注入块 / 候选 key 变量被替换，无残留', () => {
        const imagegen = JSON.parse(readFileSync(join(seedDir, 'preset-imagegen.json'), 'utf8'));
        const recall = JSON.parse(readFileSync(join(seedDir, 'preset-recall.json'), 'utf8'));
        const singleRecall = JSON.parse(readFileSync(join(seedDir, 'preset-single-recall.json'), 'utf8'));
        const singleImagegen = JSON.parse(readFileSync(join(seedDir, 'preset-single-imagegen.json'), 'utf8'));
        const ig = validatePreset(imagegen.items[0]);
        const rc = validatePreset(recall.items[0]);
        const sr = validatePreset(singleRecall.items[0]);
        const si = validatePreset(singleImagegen.items[0]);
        assert.equal(ig.ok, true);
        assert.equal(rc.ok, true);
        assert.equal(sr.ok, true);
        assert.equal(si.ok, true);
        const smokeIg = smokeRenderSeedPreset(ig.value);
        const smokeRc = smokeRenderSeedPreset(rc.value);
        const smokeSr = smokeRenderSeedPreset(sr.value);
        const smokeSi = smokeRenderSeedPreset(si.value);
        assert.equal(smokeIg.ok, true, JSON.stringify(smokeIg.leftovers));
        assert.equal(smokeRc.ok, true, JSON.stringify(smokeRc.leftovers));
        assert.equal(smokeSr.ok, true, JSON.stringify(smokeSr.leftovers));
        assert.equal(smokeSi.ok, true, JSON.stringify(smokeSi.leftovers));
        const igText = smokeIg.messages.map((m) => m.content).join('\n');
        assert.ok(igText.includes('WORLD_INFO_SAMPLE'));
        assert.ok(igText.includes('CONTEXT_SAMPLE'));
        assert.ok(igText.includes('CHARACTER_SAMPLE'));
        assert.ok(igText.includes('TAG_SAMPLE'));
        assert.ok(igText.includes('CONSTANT_SAMPLE'));
        assert.ok(igText.includes('RECENT_SLOTS_SAMPLE'));
        const rcText = smokeRc.messages.map((m) => m.content).join('\n');
        assert.ok(rcText.includes('CONTEXT_SAMPLE'));
        assert.ok(rcText.includes('key_a'));
        const siText = smokeSi.messages.map((m) => m.content).join('\n');
        assert.ok(siText.includes('USER_DESC_SAMPLE'));
        assert.ok(siText.includes('FEATURE_SAMPLE'));
        assert.ok(siText.includes('CONSTANT_SAMPLE'));
        assert.ok(siText.includes('RECENT_SLOTS_SAMPLE'));
    });
});
describe('installSeedAssets', () => {
    it('首次安装导入生图/召回预设与默认 API 并自动选中', async () => {
        const ctx = makeDeps();
        const r1 = await installSeedAssets(ctx.deps);
        assert.equal(r1.ok, true, r1.errors.join('; '));
        assert.ok(r1.imported.includes('seed-preset-imagegen-v1'));
        assert.ok(r1.imported.includes('seed-preset-recall-v1'));
        assert.equal(r1.imported.includes('seed-preset-single-recall-v1'), false);
        assert.equal(r1.imported.includes('seed-preset-single-imagegen-v1'), false);
        assert.ok(r1.imported.includes(SEED_LLM_DEFAULT_ID));
        assert.ok(r1.imported.includes(SEED_NAI_DEFAULT_ID));

        const ig = await ctx.deps.repos.preset.get('seed-preset-imagegen-v1');
        const rc = await ctx.deps.repos.preset.get('seed-preset-recall-v1');
        const llm = await ctx.deps.repos.llmConfig.get(SEED_LLM_DEFAULT_ID);
        const nai = await ctx.deps.repos.naiConfig.get(SEED_NAI_DEFAULT_ID);
        assert.equal(ig.ok && !!ig.value, true);
        assert.equal(rc.ok && !!rc.value, true);
        assert.equal(llm.ok && !!llm.value, true);
        assert.equal(nai.ok && !!nai.value, true);
        assert.equal(llm.value.secretId, null);
        assert.equal(nai.value.baseUrl, 'https://image.novelai.net');
        assert.equal(ctx.settings.activeImagegenPresetId, 'seed-preset-imagegen-v1');
        assert.equal(ctx.settings.activeRecallPresetId, 'seed-preset-recall-v1');
        assert.equal(ctx.settings.activeSingleRecallPresetId, null);
        assert.equal(ctx.settings.activeSingleImagegenPresetId, null);
        assert.equal(ctx.settings.recallLlmConfigId, SEED_LLM_DEFAULT_ID);
        assert.equal(ctx.settings.promptGenLlmConfigId, SEED_LLM_DEFAULT_ID);
        assert.equal(ctx.settings.activeNaiConfigId, SEED_NAI_DEFAULT_ID);
    });

    it('已有 API 选择不被种子覆盖', async () => {
        const ctx = makeDeps({
            settings: {
                ...defaultPluginSettings(),
                recallLlmConfigId: 'user-llm',
                promptGenLlmConfigId: 'user-llm-2',
                activeNaiConfigId: 'user-nai',
            },
        });
        const r = await installSeedAssets(ctx.deps);
        assert.equal(r.ok, true, r.errors.join('; '));
        assert.ok(r.imported.includes(SEED_LLM_DEFAULT_ID));
        assert.ok(r.imported.includes(SEED_NAI_DEFAULT_ID));
        assert.equal(ctx.settings.recallLlmConfigId, 'user-llm');
        assert.equal(ctx.settings.promptGenLlmConfigId, 'user-llm-2');
        assert.equal(ctx.settings.activeNaiConfigId, 'user-nai');
    });

    it('账本尚无 API 种子且未选择 → 再安装补上默认并选中', async () => {
        const ctx = makeDeps();
        // 先装全量，再删掉 API 实体；账本去掉 API id，模拟「只提供过预设种子」
        await installSeedAssets(ctx.deps);
        await ctx.deps.repos.llmConfig.remove(SEED_LLM_DEFAULT_ID);
        await ctx.deps.repos.naiConfig.remove(SEED_NAI_DEFAULT_ID);
        ctx.setSettings({
            ...ctx.settings,
            recallLlmConfigId: null,
            promptGenLlmConfigId: null,
            activeNaiConfigId: null,
        });
        // 从账本去掉 API 种子 id，使下次 install 视为首次提供
        const ledger = readSeedLedger(ctx.storage);
        writeSeedLedger(ctx.storage, {
            version: 1,
            offeredIds: ledger.offeredIds.filter(
                (id) => id !== SEED_LLM_DEFAULT_ID && id !== SEED_NAI_DEFAULT_ID,
            ),
        });
        ctx.extensionSettings[SEED_LEDGER_EXTENSION_KEY] = {
            version: 1,
            offeredIds: ledger.offeredIds.filter(
                (id) => id !== SEED_LLM_DEFAULT_ID && id !== SEED_NAI_DEFAULT_ID,
            ),
        };

        const r2 = await installSeedAssets(ctx.deps);
        assert.equal(r2.ok, true, r2.errors.join('; '));
        assert.ok(r2.imported.includes(SEED_LLM_DEFAULT_ID));
        assert.ok(r2.imported.includes(SEED_NAI_DEFAULT_ID));
        assert.equal(ctx.settings.recallLlmConfigId, SEED_LLM_DEFAULT_ID);
        assert.equal(ctx.settings.promptGenLlmConfigId, SEED_LLM_DEFAULT_ID);
        assert.equal(ctx.settings.activeNaiConfigId, SEED_NAI_DEFAULT_ID);
    });

    it('用户删掉默认 LLM/NAI → 再安装不复活', async () => {
        const ctx = makeDeps();
        await installSeedAssets(ctx.deps);
        await ctx.deps.repos.llmConfig.remove(SEED_LLM_DEFAULT_ID);
        await ctx.deps.repos.naiConfig.remove(SEED_NAI_DEFAULT_ID);
        const r2 = await installSeedAssets(ctx.deps);
        assert.equal(r2.imported.includes(SEED_LLM_DEFAULT_ID), false);
        assert.equal(r2.imported.includes(SEED_NAI_DEFAULT_ID), false);
        const llm = await ctx.deps.repos.llmConfig.get(SEED_LLM_DEFAULT_ID);
        const nai = await ctx.deps.repos.naiConfig.get(SEED_NAI_DEFAULT_ID);
        assert.equal(llm.value, null);
        assert.equal(nai.value, null);
    });

    it('连续两次安装不重复导入（幂等）', async () => {
        const ctx = makeDeps();
        const r1 = await installSeedAssets(ctx.deps);
        const r2 = await installSeedAssets(ctx.deps);
        assert.equal(r1.ok, true);
        assert.equal(r2.ok, true);
        assert.equal(r2.imported.length, 0);
        assert.ok(r2.skipped.includes('seed-preset-imagegen-v1'));
        assert.ok(r2.skipped.includes('seed-preset-recall-v1'));
        const list = await ctx.deps.repos.preset.list();
        assert.equal(list.value.length, 2);
    });

    it('用户改过种子预设 → 再安装修改仍在（不覆盖）', async () => {
        const ctx = makeDeps();
        await installSeedAssets(ctx.deps);
        const got = await ctx.deps.repos.preset.get('seed-preset-imagegen-v1');
        const edited = {
            ...got.value,
            name: '用户改过的名字',
            prompts: got.value.prompts.map((p, i) => (
                i === 0 ? { ...p, content: `${p.content}\n\n【用户附加】` } : p
            )),
            updatedAt: '2026-09-22T12:00:00.000Z',
        };
        await ctx.deps.repos.preset.put(edited);
        const r2 = await installSeedAssets(ctx.deps);
        assert.equal(r2.imported.length, 0);
        const after = await ctx.deps.repos.preset.get('seed-preset-imagegen-v1');
        assert.equal(after.value.name, '用户改过的名字');
        assert.ok(after.value.prompts[0].content.includes('【用户附加】'));
    });


    it('用户删掉种子预设 → 再安装不复活', async () => {
        const ctx = makeDeps();
        await installSeedAssets(ctx.deps);
        await ctx.deps.repos.preset.remove('seed-preset-imagegen-v1');
        const gone = await ctx.deps.repos.preset.get('seed-preset-imagegen-v1');
        assert.equal(gone.value, null);

        const r2 = await installSeedAssets(ctx.deps);
        assert.equal(r2.imported.includes('seed-preset-imagegen-v1'), false);
        const stillGone = await ctx.deps.repos.preset.get('seed-preset-imagegen-v1');
        assert.equal(stillGone.value, null);
        const ledger = readSeedLedger(ctx.storage);
        assert.ok(ledger.offeredIds.includes('seed-preset-imagegen-v1'));
    });

    it('用户删掉种子预设 → 清掉 storage 账本后，仍靠 extensionSettings 不复活', async () => {
        const ctx = makeDeps();
        await installSeedAssets(ctx.deps);
        await ctx.deps.repos.preset.remove('seed-preset-imagegen-v1');
        // 模拟只清了 localStorage，但 ST extensionSettings 还在
        ctx.storage._map.clear();
        const r2 = await installSeedAssets({
            ...ctx.deps,
            storage: memoryStorage(),
        });
        assert.equal(r2.imported.includes('seed-preset-imagegen-v1'), false);
        const stillGone = await ctx.deps.repos.preset.get('seed-preset-imagegen-v1');
        assert.equal(stillGone.value, null);
    });

    it('导入失败不抛，返回 errors，且不阻断后续调用', async () => {
        const ctx = makeDeps({
            loadEnvelope: async () => {
                throw new Error('磁盘炸了');
            },
        });
        // envelopes 优先；这里清掉并用坏 loadEnvelope——需不传 envelopes
        const deps = {
            ...ctx.deps,
            envelopes: undefined,
            loadEnvelope: async () => {
                throw new Error('磁盘炸了');
            },
        };
        const r = await installSeedAssets(deps);
        assert.equal(r.ok, false);
        assert.ok(r.errors.some((e) => /磁盘炸了/.test(e)));
    });

    it('校验失败的条目记入 errors，不写入', async () => {
        const ctx = makeDeps({
            envelopes: {
                'preset-imagegen.json': {
                    schemaVersion: 1,
                    kind: 'preset',
                    items: [{
                        schemaVersion: 1,
                        id: 'bad-preset',
                        name: '',
                        kind: 'imagegen',
                        prompts: [],
                        prompt_order: [],
                        createdAt: '',
                        updatedAt: '',
                    }],
                },
                'preset-recall.json': { schemaVersion: 1, kind: 'preset', items: [] },
                'artists.json': { schemaVersion: 1, kind: 'artist', items: [] },
            },
        });
        const r = await installSeedAssets(ctx.deps);
        assert.equal(r.imported.length, 0);
        assert.ok(r.errors.length >= 1);
        const got = await ctx.deps.repos.preset.get('bad-preset');
        assert.equal(got.value, null);
    });

    it('已有用户选中的预设时，不覆盖 active*PresetId', async () => {
        const ctx = makeDeps({
            settings: {
                ...defaultPluginSettings(),
                activeImagegenPresetId: 'user-ig',
                activeRecallPresetId: 'user-rc',
            },
        });
        await installSeedAssets(ctx.deps);
        assert.equal(ctx.settings.activeImagegenPresetId, 'user-ig');
        assert.equal(ctx.settings.activeRecallPresetId, 'user-rc');
    });

    it('ledger 读写往返', () => {
        const storage = memoryStorage();
        writeSeedLedger(storage, { version: 1, offeredIds: ['a', 'b', 'a'] });
        const raw = storage.getItem(SEED_LEDGER_KEY);
        assert.ok(raw);
        const ledger = readSeedLedger(storage);
        assert.deepEqual(ledger.offeredIds.sort(), ['a', 'b']);
    });

    it('artist 条目能过 validateArtist（若信封非空）', () => {
        const sample = {
            schemaVersion: 1,
            id: 'seed-artist-demo',
            name: 'demo',
            sequence: 0,
            positivePrompt: 'artist:foo',
            negativePrompt: 'lowres',
            referenceImageRef: null,
            cardImageRef: null,
            createdAt: 't',
            updatedAt: 't',
        };
        assert.equal(validateArtist(sample).ok, true);
    });
});
