import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    splitKeywordString,
    normalizeKeywords,
    createCharacter,
    createCharacterGroup,
    validateCharacter,
    validateCharacterGroup,
    migrateCharacter,
} from '../../src/domain/model/character.js';
import {
    createTagLibrary,
    createTagEntry,
    validateTagLibrary,
    validateTagEntry,
    migrateTagLibrary,
} from '../../src/domain/model/tag.js';
import {
    slotPlanFromLlmItem,
    createSlotPlan,
    createSlotRecord,
    appendSlotImage,
    latestSlotImage,
    validateSlotPlan,
    migrateSlotRecord,
} from '../../src/domain/model/slot.js';
import {
    defaultNaiParams,
    validateNaiParams,
    validateNaiCaption,
    emptyNaiCaption,
    FIXED_STRUCTURE,
    ARTIST_PREVIEW_SIZE,
    createNaiParams,
    migrateNaiParams,
} from '../../src/domain/model/nai-params.js';
import {
    createPreset,
    validatePreset,
    importFromSillyTavernPreset,
    migratePreset,
} from '../../src/domain/model/preset.js';
import {
    defaultPluginSettings,
    validatePluginSettings,
    mergePluginSettings,
    migratePluginSettings,
} from '../../src/domain/model/plugin-settings.js';
import {
    createArtist,
    validateArtist,
    migrateArtist,
} from '../../src/domain/model/artist.js';
import {
    createLlmApiConfig,
    createNaiApiConfig,
    validateLlmApiConfig,
    validateNaiApiConfig,
    migrateApiConfig,
} from '../../src/domain/model/api-config.js';

const DEPS = { id: 'id-1', now: '2026-01-01T00:00:00.000Z' };

describe('model/character keywords', () => {
    it('splitKeywordString keeps regex commas intact', () => {
        assert.deepEqual(splitKeywordString('a,b, c'), ['a', 'b', 'c']);
        assert.deepEqual(splitKeywordString('/a,b/i,plain'), ['/a,b/i', 'plain']);
        assert.deepEqual(splitKeywordString(''), []);
        assert.deepEqual(normalizeKeywords(['  x ', '', 'y']), ['x', 'y']);
        assert.deepEqual(normalizeKeywords(null), []);
    });

    it('validateCharacter / Group + create with injected deps (no Date/crypto)', () => {
        const g = createCharacterGroup({ name: '组', active: true, order: 2 }, DEPS);
        assert.equal(g.id, DEPS.id);
        assert.equal(g.createdAt, DEPS.now);
        assert.equal(validateCharacterGroup(g).ok, true);
        assert.equal(validateCharacterGroup({}).ok, false);

        const c = createCharacter({
            groupId: 'g',
            name: '张三',
            keywords: 'Alice,/a,b/i',
            fixedFeatures: 'dna',
            variableFeatures: [{ name: '衣', prompt: 'x' }],
        }, DEPS);
        assert.deepEqual(c.keywords, ['Alice', '/a,b/i']);
        assert.equal(validateCharacter(c).ok, true);
        assert.equal(validateCharacter({ id: 'x' }).ok, false);

        const migrated = migrateCharacter({ id: 'c', keywords: 'a,b' }, 0);
        assert.equal(migrated.ok, true);
        assert.deepEqual(migrated.value.keywords, ['a', 'b']);
    });
});

describe('model/tag', () => {
    it('validate library/entry; create uses deps', () => {
        const lib = createTagLibrary({ name: '库' }, DEPS);
        assert.equal(validateTagLibrary(lib).ok, true);
        assert.equal(validateTagLibrary({ id: 'x', name: '', active: true }).ok, false);

        const entry = createTagEntry({ libraryId: lib.id, key: 'k', value: 'v' }, DEPS);
        assert.equal(validateTagEntry(entry).ok, true);
        assert.equal(validateTagEntry({ id: 'e', libraryId: 'l', key: '', value: 'v' }).ok, false);
        assert.equal(migrateTagLibrary({ name: 'n', active: 1 }, 0).ok, true);
    });
});

describe('model/slot Chinese keys', () => {
    it('slotPlanFromLlmItem reads slotid / 生成点 / 生图内容', () => {
        const item = {
            slotid: 2,
            生成点: '最后一句。',
            生图内容: emptyNaiCaption(),
        };
        const r = slotPlanFromLlmItem(item);
        assert.equal(r.ok, true);
        assert.equal(r.value.slotId, 2);
        assert.equal(r.value.anchorSentence, '最后一句。');
        assert.equal(slotPlanFromLlmItem(null).ok, false);
        assert.equal(validateSlotPlan({ slotId: 0, anchorSentence: 'a', caption: emptyNaiCaption() }).ok, false);
    });

    it('appendSlotImage / latestSlotImage immutable', () => {
        const rec = createSlotRecord({
            messageId: 1,
            slotId: 1,
            caption: emptyNaiCaption(),
            images: [],
        }, { now: DEPS.now });
        const next = appendSlotImage(rec, {
            imageRef: 'img1',
            createdAt: DEPS.now,
            naiConfigId: null,
            artistId: null,
        });
        assert.equal(rec.images.length, 0);
        assert.equal(latestSlotImage(next)?.imageRef, 'img1');
        assert.equal(latestSlotImage(rec), null);
        assert.equal(migrateSlotRecord(next, 0).ok, true);
    });
});

describe('model/nai-params', () => {
    it('defaults + FIXED_STRUCTURE + validate edges', () => {
        const d = defaultNaiParams();
        assert.equal(d.n_samples, 1);
        assert.equal(d.skip_cfg_above_sigma, null);
        assert.equal(FIXED_STRUCTURE.v4_prompt.use_coords, true);
        assert.equal(FIXED_STRUCTURE.v4_negative_prompt.use_coords, false);
        assert.equal(ARTIST_PREVIEW_SIZE.width, 832);

        assert.equal(validateNaiParams(d).ok, true);
        assert.equal(validateNaiParams({ ...d, steps: 99 }).ok, false);
        assert.equal(validateNaiParams(null).ok, false);

        const cap = validateNaiCaption({
            v4_prompt: { caption: { base_caption: 'a', char_captions: [] } },
            v4_negative_prompt: { caption: { base_caption: '', char_captions: null } },
        });
        assert.equal(cap.ok, true);
        assert.deepEqual(cap.value.v4_negative_prompt.caption.char_captions, []);

        const created = createNaiParams({ width: 640 }, {});
        assert.equal(created.width, 640);
        assert.equal(migrateNaiParams(d, 0).ok, true);
    });

    it('ucPreset / skip_cfg_above_sigma null handling', () => {
        const n = validateNaiParams({
            ...defaultNaiParams(),
            ucPreset: 2,
            skip_cfg_above_sigma: null,
        });
        assert.equal(n.ok, true);
        assert.equal(n.value.skip_cfg_above_sigma, null);
        assert.equal(n.value.ucPreset, 2);
    });
});

describe('model/preset', () => {
    it('validate + importFromSillyTavernPreset', () => {
        const st = {
            name: 'ST',
            temperature: 0.9,
            prompts: [
                {
                    identifier: 'main',
                    name: 'Main',
                    role: 'system',
                    content: '{{世界书}}',
                    enabled: true,
                },
            ],
            prompt_order: [{ character_id: 100000, order: [{ identifier: 'main', enabled: true }] }],
        };
        const imported = importFromSillyTavernPreset(st, { kind: 'imagegen' }, DEPS);
        assert.equal(imported.ok, true);
        assert.equal(imported.value.prompts[0].content, '{{世界书}}');
        assert.equal(imported.value.prompt_order[0].identifier, 'main');
        // 丢弃采样键
        assert.equal('temperature' in imported.value, false);

        const p = createPreset({ name: 'p', kind: 'recall', prompts: [] }, DEPS);
        assert.equal(validatePreset(p).ok, true);
        assert.equal(validatePreset({ id: 'x', name: 'n', kind: 'nope', prompts: [] }).ok, false);
        assert.equal(migratePreset(p, 0).ok, true);
    });
});

describe('model/plugin-settings', () => {
    it('defaults matchDefaults; validate; merge drops unknown keys', () => {
        const d = defaultPluginSettings();
        assert.equal(d.contextWindowSize, 5);
        assert.equal(d.matchDefaults.caseSensitive, false);
        assert.equal(d.autoWriteSlots, false);
        assert.equal(validatePluginSettings(d).ok, true);
        assert.equal(validatePluginSettings({ contextWindowSize: 0 }).ok, false);

        const merged = mergePluginSettings(d, {
            contextWindowSize: 8,
            unknownKey: 'drop',
            matchDefaults: { caseSensitive: true },
        });
        assert.equal(merged.contextWindowSize, 8);
        assert.equal(merged.matchDefaults.caseSensitive, true);
        assert.equal('unknownKey' in merged, false);

        const mig = migratePluginSettings({
            autoGenerateSlots: true,
            activeImagePresetId: 'p1',
            naiParams: defaultNaiParams(),
        }, 0);
        assert.equal(mig.ok, true);
        assert.equal(mig.value.autoWriteSlots, true);
        assert.equal(mig.value.activeImagegenPresetId, 'p1');
    });
});

describe('model/artist + api-config', () => {
    it('validate and create with deps injection', () => {
        const artist = createArtist({ name: 'a', positive: 'p', negative: 'n' }, DEPS);
        assert.equal(validateArtist(artist).ok, true);
        assert.equal(validateArtist({ id: 'x', name: '', positive: '', negative: '' }).ok, false);
        assert.equal(migrateArtist(artist, 0).ok, true);

        const llm = createLlmApiConfig({
            name: 'L',
            baseUrl: 'https://x',
            apiKey: 'k',
            model: 'm',
        }, DEPS);
        assert.equal(validateLlmApiConfig(llm).ok, true);
        assert.equal(validateLlmApiConfig({ ...llm, baseUrl: '' }).ok, false);

        const nai = createNaiApiConfig({
            name: 'N',
            baseUrl: 'https://y',
            apiKey: 'k',
            transport: 'direct',
            decoder: 'auto',
        }, DEPS);
        assert.equal(validateNaiApiConfig(nai).ok, true);
        assert.equal(migrateApiConfig(nai, 0).ok, true);
    });
});

describe('model create* purity (no Date / crypto)', () => {
    it('create* only use deps.id / deps.now', () => {
        const RealDate = globalThis.Date;
        let touched = false;
        globalThis.Date = new Proxy(RealDate, {
            apply() { touched = true; return RealDate.apply(this, arguments); },
            construct() { touched = true; return new RealDate(...arguments); },
            get(t, p) {
                if (p === 'now') {
                    return () => { touched = true; return 0; };
                }
                return t[p];
            },
        });
        const cryptoDesc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
        const realRandomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
        if (realRandomUUID && globalThis.crypto) {
            Object.defineProperty(globalThis.crypto, 'randomUUID', {
                configurable: true,
                value() {
                    touched = true;
                    return 'uuid';
                },
            });
        }
        try {
            createCharacterGroup({ name: 'g' }, DEPS);
            createCharacter({ groupId: 'g', name: 'c', fixedFeatures: '' }, DEPS);
            createTagLibrary({ name: 't' }, DEPS);
            createTagEntry({ libraryId: 't', key: 'k', value: 'v' }, DEPS);
            createArtist({ name: 'a', positive: '', negative: '' }, DEPS);
            createPreset({ name: 'p' }, DEPS);
            createLlmApiConfig({ name: 'l', baseUrl: 'u', model: 'm' }, DEPS);
            createNaiApiConfig({ name: 'n', baseUrl: 'u' }, DEPS);
            createSlotRecord({ messageId: 0, slotId: 1 }, { now: DEPS.now });
            createNaiParams({}, {});
            defaultPluginSettings();
        } finally {
            globalThis.Date = RealDate;
            if (realRandomUUID && globalThis.crypto) {
                Object.defineProperty(globalThis.crypto, 'randomUUID', {
                    configurable: true,
                    value: realRandomUUID,
                });
            }
            void cryptoDesc;
        }
        assert.equal(touched, false);
    });
});
