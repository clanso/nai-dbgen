import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { activateFeatureEntries } from '../../src/domain/matching/feature-activation.js';

const DEFAULTS = { caseSensitive: false, matchWholeWords: false };

describe('activateFeatureEntries', () => {
    it('only active feature libraries; splits key commas; keeps regex commas', () => {
        const libraries = [
            { id: 'c1', name: '构图', active: true, kind: 'composition' },
            { id: 'f1', name: '特征', active: true, kind: 'feature' },
            { id: 'f2', name: '关特征', active: false, kind: 'feature' },
        ];
        const entriesByLibrary = {
            c1: [{ id: 'e0', libraryId: 'c1', key: 'garden', value: 'should-not-hit' }],
            f1: [
                { id: 'e1', libraryId: 'f1', key: '金发,blonde', value: 'blonde hair' },
                { id: 'e2', libraryId: 'f1', key: '/blue,eyes/i', value: 'blue eyes' },
                { id: 'e3', libraryId: 'f1', key: 'miss', value: 'no' },
            ],
            f2: [{ id: 'e4', libraryId: 'f2', key: '金发', value: 'inactive' }],
        };
        const hit = activateFeatureEntries(
            libraries,
            entriesByLibrary,
            '她有金发 and Blue,eyes look',
            DEFAULTS,
        );
        assert.deepEqual(hit.map((e) => e.id), ['e1', 'e2']);
    });

    it('skips entries whose own switch is off', () => {
        const libraries = [{ id: 'f1', active: true, kind: 'feature' }];
        const entriesByLibrary = {
            f1: [
                { id: 'on', libraryId: 'f1', key: '金发', value: 'blonde hair', active: true },
                { id: 'off', libraryId: 'f1', key: '金发', value: 'blonde hair', active: false },
            ],
        };
        const hit = activateFeatureEntries(libraries, entriesByLibrary, '金发', DEFAULTS);
        assert.deepEqual(hit.map((e) => e.id), ['on']);
    });

    it('accepts Map entriesByLibrary; empty / non-array → []', () => {
        const libraries = [{ id: 'f1', active: true, kind: 'feature' }];
        const map = new Map([
            ['f1', [{ id: 'e1', libraryId: 'f1', key: 'cat', value: 'cat ears' }]],
        ]);
        assert.equal(activateFeatureEntries(libraries, map, 'a cat here', DEFAULTS).length, 1);
        assert.deepEqual(activateFeatureEntries(null, map, 'cat', DEFAULTS), []);
        assert.deepEqual(activateFeatureEntries(libraries, null, 'cat', DEFAULTS), []);
    });
});
