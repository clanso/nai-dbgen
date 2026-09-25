/**
 * 特征库次要关键字：校验、匹配（验收 26）、导入导出往返。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    assertSecondaryFieldsAllowed,
    createTagEntry,
    normalizeTagEntrySecondary,
    validateTagEntry,
} from '../../src/domain/model/tag.js';
import { activateFeatureEntries } from '../../src/domain/matching/feature-activation.js';
import { matchAllKeywords } from '../../src/domain/matching/keyword-matcher.js';
import { createTagRepo } from '../../src/adapters/storage/repos/tag.repo.js';
import { createMemoryIdb } from '../../src/adapters/storage/memory-idb.js';
import { isErr, isOk } from '../../src/infra/result.js';

const DEFAULTS = { caseSensitive: false, matchWholeWords: false };
const DEPS = { id: 'te-1', now: '2026-01-01T00:00:00.000Z' };

describe('normalizeTagEntrySecondary', () => {
    it('omits both when absent or secondaryKey blank', () => {
        assert.deepEqual(normalizeTagEntrySecondary({}).value, {});
        assert.deepEqual(normalizeTagEntrySecondary({ key: 'x' }).value, {});
        assert.deepEqual(normalizeTagEntrySecondary({ secondaryKey: '' }).value, {});
        assert.deepEqual(normalizeTagEntrySecondary({ secondaryKey: '  ' }).value, {});
        assert.deepEqual(
            normalizeTagEntrySecondary({ secondaryKey: '', secondaryLogic: '' }).value,
            {},
        );
    });

    it('rejects only-one side (只填其一)', () => {
        const onlyKey = normalizeTagEntrySecondary({ secondaryKey: '裸体' });
        assert.equal(onlyKey.ok, false);
        assert.match(onlyKey.error.message, /同时/);

        const onlyLogic = normalizeTagEntrySecondary({ secondaryLogic: 'any' });
        assert.equal(onlyLogic.ok, false);

        const blankKeyWithLogic = normalizeTagEntrySecondary({
            secondaryKey: '  ',
            secondaryLogic: 'any',
        });
        assert.equal(blankKeyWithLogic.ok, false);
    });

    it('accepts any/all pair and trims key', () => {
        const any = normalizeTagEntrySecondary({
            secondaryKey: ' 裸体 ',
            secondaryLogic: 'any',
        });
        assert.equal(any.ok, true);
        assert.deepEqual(any.value, { secondaryKey: '裸体', secondaryLogic: 'any' });

        const all = normalizeTagEntrySecondary({
            secondaryKey: '裸体,擂台',
            secondaryLogic: 'all',
        });
        assert.equal(all.ok, true);
        assert.equal(all.value.secondaryLogic, 'all');
    });

    it('rejects invalid logic', () => {
        const bad = normalizeTagEntrySecondary({
            secondaryKey: '裸体',
            secondaryLogic: 'xor',
        });
        assert.equal(bad.ok, false);
    });
});

describe('assertSecondaryFieldsAllowed', () => {
    it('blocks secondary fields on composition / constant', () => {
        const raw = { secondaryKey: '裸体', secondaryLogic: 'any' };
        assert.equal(assertSecondaryFieldsAllowed('feature', raw).ok, true);
        assert.equal(assertSecondaryFieldsAllowed('composition', raw).ok, false);
        assert.equal(assertSecondaryFieldsAllowed('constant', { secondaryLogic: 'all' }).ok, false);
        assert.equal(assertSecondaryFieldsAllowed('composition', { key: 'x' }).ok, true);
    });
});

describe('validateTagEntry + createTagEntry secondary', () => {
    it('round-trips secondary fields; omits empty', () => {
        const withSec = createTagEntry({
            libraryId: 'f1',
            key: '拳击',
            value: 'boxing',
            secondaryKey: '裸体',
            secondaryLogic: 'any',
        }, DEPS);
        assert.equal(withSec.secondaryKey, '裸体');
        assert.equal(withSec.secondaryLogic, 'any');
        const checked = validateTagEntry(withSec);
        assert.equal(checked.ok, true);
        assert.equal(checked.value.secondaryKey, '裸体');

        const plain = createTagEntry({
            libraryId: 'f1',
            key: '拳击',
            value: 'boxing',
        }, DEPS);
        assert.equal('secondaryKey' in plain, false);
        assert.equal('secondaryLogic' in plain, false);
    });
});

describe('activateFeatureEntries secondary (验收 26)', () => {
    const libraries = [
        { id: 'f1', name: '特征', active: true, kind: 'feature' },
    ];

    it('any: key alone misses; key+one secondary hits', () => {
        const entriesByLibrary = {
            f1: [{
                id: 'e1',
                libraryId: 'f1',
                key: '拳击',
                value: 'boxing nude',
                secondaryKey: '裸体',
                secondaryLogic: 'any',
            }],
        };
        assert.deepEqual(
            activateFeatureEntries(libraries, entriesByLibrary, '今晚有拳击比赛', DEFAULTS).map((e) => e.id),
            [],
        );
        assert.deepEqual(
            activateFeatureEntries(libraries, entriesByLibrary, '拳击场上全是裸体', DEFAULTS).map((e) => e.id),
            ['e1'],
        );
    });

    it('all: needs every secondary token', () => {
        const entriesByLibrary = {
            f1: [{
                id: 'e1',
                libraryId: 'f1',
                key: '拳击',
                value: 'boxing',
                secondaryKey: '裸体,擂台',
                secondaryLogic: 'all',
            }],
        };
        assert.equal(
            activateFeatureEntries(libraries, entriesByLibrary, '拳击 裸体', DEFAULTS).length,
            0,
        );
        assert.equal(
            activateFeatureEntries(libraries, entriesByLibrary, '拳击 裸体 擂台', DEFAULTS).length,
            1,
        );
    });

    it('regex secondary + caseSensitive', () => {
        const entriesByLibrary = {
            f1: [{
                id: 'e1',
                libraryId: 'f1',
                key: '拳击',
                value: 'v',
                secondaryKey: '/Nude|裸体/i',
                secondaryLogic: 'any',
            }],
        };
        assert.equal(
            activateFeatureEntries(libraries, entriesByLibrary, '拳击 NUDE scene', DEFAULTS).length,
            1,
        );

        const caseEntries = {
            f1: [{
                id: 'e2',
                libraryId: 'f1',
                key: 'Boxing',
                value: 'v',
                secondaryKey: 'Nude',
                secondaryLogic: 'any',
            }],
        };
        const sensitive = { caseSensitive: true, matchWholeWords: false };
        assert.equal(
            activateFeatureEntries(libraries, caseEntries, 'boxing Nude', sensitive).length,
            0,
            'key 大小写不符',
        );
        assert.equal(
            activateFeatureEntries(libraries, caseEntries, 'Boxing Nude', sensitive).length,
            1,
        );
        assert.equal(
            activateFeatureEntries(libraries, caseEntries, 'Boxing nude', sensitive).length,
            0,
            '次要关键字大小写不符',
        );
    });
});

describe('matchAllKeywords', () => {
    it('requires every usable needle', () => {
        assert.equal(matchAllKeywords('a b c', ['a', 'c'], null, DEFAULTS), true);
        assert.equal(matchAllKeywords('a b', ['a', 'c'], null, DEFAULTS), false);
        assert.equal(matchAllKeywords('a', [], null, DEFAULTS), false);
    });
});

describe('tag repo secondary import/export', () => {
    it('export→import preserves secondary; rejects non-feature secondary', async () => {
        const db = createMemoryIdb();
        const repo = createTagRepo({ db });
        await repo.putLibrary({
            schemaVersion: 1,
            id: 'f1',
            name: '特征',
            active: true,
            kind: 'feature',
            createdAt: 't',
            updatedAt: 't',
        });
        const put = await repo.put({
            schemaVersion: 1,
            id: 'e1',
            libraryId: 'f1',
            key: '拳击',
            value: 'boxing',
            secondaryKey: '裸体',
            secondaryLogic: 'any',
            createdAt: 't',
            updatedAt: 't',
        });
        assert.equal(isOk(put), true);
        assert.equal(put.value.secondaryKey, '裸体');

        const exported = await repo.exportJson();
        assert.equal(isOk(exported), true);
        const entryOut = exported.value.entries.find((e) => e.id === 'e1');
        assert.equal(entryOut.secondaryKey, '裸体');
        assert.equal(entryOut.secondaryLogic, 'any');

        const db2 = createMemoryIdb();
        const repo2 = createTagRepo({ db: db2 });
        const imp = await repo2.importJson(exported.value, { strategy: 'overwrite' });
        assert.equal(isOk(imp), true);
        const got = await repo2.get('e1');
        assert.equal(got.value.secondaryKey, '裸体');
        assert.equal(got.value.secondaryLogic, 'any');

        const bad = await repo2.importJson({
            schemaVersion: 1,
            kind: 'tag',
            libraries: [{
                schemaVersion: 1,
                id: 'c1',
                name: '构图',
                active: true,
                kind: 'composition',
                createdAt: 't',
                updatedAt: 't',
            }],
            entries: [{
                schemaVersion: 1,
                id: 'bad',
                libraryId: 'c1',
                key: '背景：浴室',
                value: 'bath',
                secondaryKey: '裸体',
                secondaryLogic: 'any',
                createdAt: 't',
                updatedAt: 't',
            }],
        }, { strategy: 'overwrite' });
        assert.equal(isErr(bad), true);
        assert.match(bad.error.message, /特征库/);
        assert.match(bad.error.message, /构图库「构图」/);
        const libs = await repo2.listLibraries();
        assert.equal(libs.value.some((l) => l.id === 'c1'), false);
    });

    it('put rejects secondary on composition library', async () => {
        const db = createMemoryIdb();
        const repo = createTagRepo({ db });
        await repo.putLibrary({
            schemaVersion: 1,
            id: 'c1',
            name: '构图',
            active: true,
            kind: 'composition',
            createdAt: 't',
            updatedAt: 't',
        });
        const r = await repo.put({
            schemaVersion: 1,
            id: 'e1',
            libraryId: 'c1',
            key: '背景：浴室',
            value: 'bath',
            secondaryKey: '裸体',
            secondaryLogic: 'any',
            createdAt: 't',
            updatedAt: 't',
        });
        assert.equal(isErr(r), true);
        assert.match(r.error.message, /特征库/);
    });
});
