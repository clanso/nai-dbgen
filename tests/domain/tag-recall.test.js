import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileRecalledKeys } from '../../src/domain/matching/tag-recall.js';

/**
 * @param {string} id
 * @param {string} key
 * @param {string} [libraryId]
 * @param {string} [value]
 */
function entry(id, key, libraryId = 'lib1', value = `v:${key}`) {
    return {
        schemaVersion: 1,
        id,
        libraryId,
        key,
        value,
        createdAt: '',
        updatedAt: '',
    };
}

describe('reconcileRecalledKeys', () => {
    it('exact match (case-sensitive); returns matched + unmatched', () => {
        const catalog = [entry('1', '红发'), entry('2', '校服')];
        const r = reconcileRecalledKeys(['红发', '编造的', '校服'], catalog);
        assert.deepEqual(r.matched.map((e) => e.id), ['1', '2']);
        assert.deepEqual(r.unmatched, ['编造的']);
        assert.equal(r.matched[0].value, 'v:红发');
    });

    it('empty recall / empty catalog', () => {
        assert.deepEqual(reconcileRecalledKeys([], [entry('1', 'a')]), {
            matched: [],
            unmatched: [],
        });
        assert.deepEqual(reconcileRecalledKeys(['a', 'b'], []), {
            matched: [],
            unmatched: ['a', 'b'],
        });
        assert.deepEqual(reconcileRecalledKeys(null, null), {
            matched: [],
            unmatched: [],
        });
    });

    it('all unmatched', () => {
        const r = reconcileRecalledKeys(['x', 'y'], [entry('1', 'a')]);
        assert.deepEqual(r.matched, []);
        assert.deepEqual(r.unmatched, ['x', 'y']);
    });

    it('trims recalled keys only; catalog key kept as stored', () => {
        const catalog = [entry('1', 'school')];
        const r = reconcileRecalledKeys(['  school  ', '\nschool\n'], catalog);
        assert.equal(r.matched.length, 1);
        assert.equal(r.matched[0].id, '1');
        // 第二次 trim 后同 key → 去重，不进 unmatched
        assert.deepEqual(r.unmatched, []);

        // 目录 key 带空格时，回文 trim 后对不上「带空格的存盘 key」
        const spaced = [entry('2', ' school ')];
        const r2 = reconcileRecalledKeys(['school'], spaced);
        assert.deepEqual(r2.matched, []);
        assert.deepEqual(r2.unmatched, ['school']);
    });

    it('case difference is unmatched (no folding)', () => {
        const r = reconcileRecalledKeys(['School'], [entry('1', 'school')]);
        assert.deepEqual(r.matched, []);
        assert.deepEqual(r.unmatched, ['School']);
    });

    it('duplicate recalled key hits once', () => {
        const r = reconcileRecalledKeys(['a', 'a', 'a'], [entry('1', 'a')]);
        assert.equal(r.matched.length, 1);
        assert.deepEqual(r.unmatched, []);
    });

    it('multi-library same key: first in activeEntries wins', () => {
        const catalog = [
            entry('from-lib-a', '同名', 'libA', 'value-A'),
            entry('from-lib-b', '同名', 'libB', 'value-B'),
        ];
        const r = reconcileRecalledKeys(['同名'], catalog);
        assert.equal(r.matched.length, 1);
        assert.equal(r.matched[0].id, 'from-lib-a');
        assert.equal(r.matched[0].value, 'value-A');
    });

    it('empty / whitespace-only recalled keys go to unmatched (observable)', () => {
        const r = reconcileRecalledKeys(['', '  ', '\t', 'ok'], [entry('1', 'ok')]);
        assert.deepEqual(r.matched.map((e) => e.id), ['1']);
        assert.deepEqual(r.unmatched, ['', '  ', '\t']);
    });

    it('does not mutate inputs', () => {
        const keys = ['a'];
        const catalog = [entry('1', 'a')];
        const snap = JSON.stringify(catalog);
        reconcileRecalledKeys(keys, catalog);
        assert.deepEqual(keys, ['a']);
        assert.equal(JSON.stringify(catalog), snap);
    });

    it('Chinese keys exact; non-string coerced then compared', () => {
        const r = reconcileRecalledKeys(['黑丝', 123], [entry('1', '黑丝'), entry('2', '123')]);
        assert.deepEqual(r.matched.map((e) => e.id), ['1', '2']);
        assert.deepEqual(r.unmatched, []);
    });
});
