import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    filterSortItems,
    filterNestedLibrary,
    parseImportJsonText,
    prepareImportCommit,
    roundTripJson,
    gateCoverUrl,
    buildArtistPreviewRequest,
    pickAllowedSettingsPatch,
    PLUGIN_SETTINGS_KEYS,
    settingsKeysUnchanged,
} from '../../src/ui/panels/_lib/library-logic.js';
import { ARTIST_PREVIEW_SIZE } from '../../src/domain/model/nai-params.js';
import { defaultPluginSettings } from '../../src/domain/model/plugin-settings.js';

describe('ui/panels library-logic', () => {
    it('filters and sorts by name / query', () => {
        const items = [
            { id: '2', name: 'Zeta', model: 'm' },
            { id: '1', name: 'Alpha', model: 'x' },
            { id: '3', name: 'Beta', model: 'alpha-hidden' },
        ];
        const asc = filterSortItems(items, { sort: 'name-asc' });
        assert.deepEqual(asc.map((i) => i.name), ['Alpha', 'Beta', 'Zeta']);

        const hit = filterSortItems(items, { query: 'alp', searchKeys: ['name', 'model'] });
        assert.equal(hit.length, 2);
        assert.ok(hit.some((i) => i.name === 'Alpha'));
        assert.ok(hit.some((i) => i.name === 'Beta'));
    });

    it('filters nested character/tag libraries together', () => {
        const parents = [
            { id: 'g1', name: '组甲', active: true, order: 1 },
            { id: 'g2', name: '组乙', active: false, order: 0 },
        ];
        const children = new Map([
            ['g1', [{ id: 'c1', name: '张三', keywords: ['zhang'] }]],
            ['g2', [{ id: 'c2', name: '李四', keywords: ['li'] }]],
        ]);
        const onlyActive = filterNestedLibrary(parents, children, { activeOnly: true });
        assert.equal(onlyActive.parents.length, 1);
        assert.equal(onlyActive.parents[0].id, 'g1');

        const q = filterNestedLibrary(parents, children, { query: '李' });
        assert.equal(q.parents.length, 1);
        assert.equal(q.parents[0].id, 'g2');
        assert.equal(q.childrenByParentId.get('g2').length, 1);
    });

    it('export → import round-trip keeps payload', () => {
        const envelope = {
            kind: 'artist',
            schemaVersion: 1,
            items: [
                { id: 'a1', name: '串A', positive: 'artist1', negative: 'bad' },
            ],
        };
        const back = roundTripJson(envelope);
        assert.deepEqual(back, envelope);
        const prepared = prepareImportCommit(back, 'artist');
        assert.equal(prepared.ok, true);
        assert.equal(prepared.value.rows.length, 1);
        assert.equal(prepared.value.rows[0].name, '串A');
    });

    it('illegal JSON import fails without producing commit payload', () => {
        const bad = parseImportJsonText('{not-json');
        assert.equal(bad.ok, false);
        assert.match(bad.error, /无法解析 JSON/);

        const prepared = prepareImportCommit('{not-json', 'artist');
        assert.equal(prepared.ok, false);

        // 模拟调用方：只有 ok 才调 import；此处证明不会进入写入路径
        let importCalled = false;
        if (prepared.ok) {
            importCalled = true;
        }
        assert.equal(importCalled, false);
    });

    it('wrong kind is rejected before write', () => {
        const prepared = prepareImportCommit(
            { kind: 'tag', libraries: [{ id: '1', name: 'L' }] },
            'artist',
        );
        assert.equal(prepared.ok, false);
        assert.match(prepared.error, /类型不匹配/);
    });

    it('blocks malicious cover URLs', () => {
        assert.equal(gateCoverUrl('javascript:alert(1)'), null);
        assert.equal(gateCoverUrl('data:text/html,hi'), null);
        assert.equal(gateCoverUrl('https://cdn.example/cover.png'), 'https://cdn.example/cover.png');
        assert.ok(gateCoverUrl('data:image/png;base64,abc'));
    });

    it('artist preview uses editing row, not activeArtistId, and fixed size', () => {
        const editing = { id: 'edit-9', name: '正在编辑', positive: 'a', negative: 'b' };
        const req = buildArtistPreviewRequest(editing, {
            promptText: 'girl',
            activeArtistId: 'global-active-1',
        });
        assert.equal(req.artistId, 'edit-9');
        assert.notEqual(req.artistId, 'global-active-1');
        assert.deepEqual(req.previewSize, {
            width: ARTIST_PREVIEW_SIZE.width,
            height: ARTIST_PREVIEW_SIZE.height,
        });
        assert.equal(req.previewSize.width, 832);
        assert.equal(req.previewSize.height, 1216);
    });

    it('settings patch only allows D8 keys; unknown keys dropped', () => {
        const keys = new Set(PLUGIN_SETTINGS_KEYS);
        assert.ok(keys.has('activeArtistId'));
        assert.ok(keys.has('recallLlmConfigId'));
        assert.ok(keys.has('naiParams'));
        assert.equal(keys.has('myCustomKey'), false);

        const patch = pickAllowedSettingsPatch({
            activeArtistId: 'a1',
            myCustomKey: 'nope',
            contextWindowSize: 7,
            matchDefaults: { caseSensitive: true, matchWholeWords: false, extra: 1 },
        });
        assert.equal(patch.activeArtistId, 'a1');
        assert.equal(patch.contextWindowSize, 7);
        assert.equal(patch.myCustomKey, undefined);
        assert.deepEqual(patch.matchDefaults, {
            caseSensitive: true,
            matchWholeWords: false,
        });

        const before = defaultPluginSettings();
        const after = { ...before, activeArtistId: before.activeArtistId };
        assert.equal(
            settingsKeysUnchanged(before, after, ['activeArtistId', 'activeNaiConfigId']),
            true,
        );
    });
});
