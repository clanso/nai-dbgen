/**
 * 构图 key 解析/拼接、value 小标题校验、种子规则段一致性、真实标签库 round-trip。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    parseCompositionKey,
    composeCompositionKey,
} from '../../src/domain/model/composition-key.js';
import {
    hasForbiddenValueSubtitle,
    validateTagValueWriting,
    validateTagEntryWriting,
} from '../../src/domain/model/tag-writing.js';
import { createMemoryIdb } from '../../src/adapters/storage/memory-idb.js';
import { createTagRepo } from '../../src/adapters/storage/repos/tag.repo.js';
import { isOk, isErr } from '../../src/infra/result.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const seedDir = join(root, 'assets/seed');
const realTagPath = join(
    root,
    '../ref/画师串、标签库等/转换后/标签库9.5-V5.tag.json',
);

describe('composition-key parse / compose', () => {
    it('accepts category：name', () => {
        const r = parseCompositionKey('背景：浴室');
        assert.equal(r.ok, true);
        assert.deepEqual(r.value, {
            category: '背景',
            name: '浴室',
        });
        assert.equal(composeCompositionKey(r.value).value, '背景：浴室');
    });

    it('accepts slash in name; compose from form fields', () => {
        const key = '场景·通过媒介：看手机/手机屏幕';
        const r = parseCompositionKey(key);
        assert.equal(r.ok, true);
        assert.equal(r.value.category, '场景·通过媒介');
        assert.equal(r.value.name, '看手机/手机屏幕');
        assert.equal(composeCompositionKey(r.value).value, key);

        const composed = composeCompositionKey({
            category: '背景',
            name: '浴室',
        });
        assert.equal(composed.ok, true);
        assert.equal(composed.value, '背景：浴室');
    });

    it('rejects fullwidth paren trigger form', () => {
        const r = parseCompositionKey(
            '场景·通过媒介：看手机/手机屏幕（手机；且涉及：看/屏幕/画面）',
        );
        assert.equal(r.ok, false);
        assert.match(r.error.message, /不能含全角括号/);
        assert.match(r.error.message, /应为「分类：名称」/);
        assert.doesNotMatch(r.error.message, /（触发词）/);
    });

    it('rejects missing category separator', () => {
        const r = parseCompositionKey('浴室');
        assert.equal(r.ok, false);
        assert.match(r.error.message, /缺少分类/);
        assert.match(r.error.message, /应为「分类：名称」/);
    });
});

describe('tag value subtitle writing', () => {
    it('flags Chinese subtitle heads', () => {
        assert.equal(hasForbiddenValueSubtitle('浴室：bathroom'), true);
        assert.equal(hasForbiddenValueSubtitle('- 画框/相框：frame'), true);
        assert.equal(hasForbiddenValueSubtitle('看手机/手机屏幕：phone'), true);
    });

    it('does not flag NAI / placeholder / weight forms', () => {
        assert.equal(hasForbiddenValueSubtitle('[x]  atmosphere/interior'), false);
        assert.equal(hasForbiddenValueSubtitle('2::photograph::,foo'), false);
        assert.equal(hasForbiddenValueSubtitle('transparent background（说明）'), false);
        assert.equal(hasForbiddenValueSubtitle('[用自然语言把整幅画面"讲"清楚]'), false);
        assert.equal(hasForbiddenValueSubtitle('0.4::pregnant::（早期）/later'), false);
        assert.equal(hasForbiddenValueSubtitle('{grouped}'), false);
        assert.equal(hasForbiddenValueSubtitle('bathroom, shower'), false);
    });

    it('validateTagEntryWriting enforces composition key + value', () => {
        const badKey = validateTagEntryWriting('composition', '浴室', 'ok');
        assert.equal(badKey.ok, false);
        const parenKey = validateTagEntryWriting(
            'composition',
            '背景：浴室（浴室）',
            'bathroom',
        );
        assert.equal(parenKey.ok, false);
        assert.match(parenKey.error.message, /全角括号|分类：名称/);
        const badVal = validateTagEntryWriting(
            'composition',
            '背景：浴室',
            '浴室：bathroom',
        );
        assert.equal(badVal.ok, false);
        assert.match(badVal.error.message, /小标题/);
        const ok = validateTagEntryWriting(
            'feature',
            'Alice,银发',
            'long silver hair',
        );
        assert.equal(ok.ok, true);
    });
});

describe('real tag library 9.5-V5', () => {
    it('parses all composition keys with round-trip', () => {
        const data = JSON.parse(readFileSync(realTagPath, 'utf8'));
        const libs = Object.fromEntries(data.libraries.map((l) => [l.id, l]));
        const composition = data.entries.filter(
            (e) => libs[e.libraryId]?.kind === 'composition',
        );
        assert.equal(composition.length, 64);
        /** @type {string[]} */
        const failed = [];
        for (const e of composition) {
            const parsed = parseCompositionKey(e.key);
            if (!parsed.ok) {
                failed.push(`parse: ${e.key} → ${parsed.error.message}`);
                continue;
            }
            const composed = composeCompositionKey(parsed.value);
            if (!composed.ok) {
                failed.push(`compose: ${e.key} → ${composed.error.message}`);
                continue;
            }
            if (composed.value !== e.key) {
                failed.push(`round: ${e.key} → ${composed.value}`);
            }
        }
        assert.deepEqual(failed, []);
    });

    it('flags no forbidden subtitle among tag values', () => {
        const data = JSON.parse(readFileSync(realTagPath, 'utf8'));
        assert.equal(data.entries.length, 507);
        const bad = data.entries.filter((e) => hasForbiddenValueSubtitle(e.value));
        assert.deepEqual(bad.map((e) => e.key), []);
        for (const e of data.entries) {
            assert.equal(validateTagValueWriting(e.value).ok, true);
        }
    });
});

describe('tag-rules.json is single source for seed presets', () => {
    it('four presets embed matching 标签库用法 content', () => {
        const rules = JSON.parse(readFileSync(join(seedDir, 'tag-rules.json'), 'utf8'));
        assert.ok(rules.recall && rules.singleRecall && rules.imagegen && rules.singleImagegen);

        /** @type {[string, string][]} */
        const pairs = [
            ['preset-recall.json', 'recall'],
            ['preset-single-recall.json', 'singleRecall'],
            ['preset-imagegen.json', 'imagegen'],
            ['preset-single-imagegen.json', 'singleImagegen'],
        ];
        for (const [file, key] of pairs) {
            const env = JSON.parse(readFileSync(join(seedDir, file), 'utf8'));
            const item = env.items[0];
            const seg = item.prompts.find((p) => p.identifier === 'tag-rules');
            assert.ok(seg, file);
            assert.equal(seg.name, '标签库用法');
            assert.equal(seg.role, 'system');
            assert.equal(seg.content, rules[key], file);

            const order = item.prompt_order.map((p) => p.identifier);
            const ti = order.indexOf('tag-rules');
            assert.ok(ti > 0, file);
            assert.equal(order[ti - 1], 'main', file);
            if (key === 'recall' || key === 'singleRecall') {
                assert.equal(order[ti + 1], 'payload', file);
            } else {
                assert.equal(order[ti + 1], 'blocks', file);
            }
        }
    });
});

describe('tag repo save / import writing rules', () => {
    it('put rejects bad composition key and subtitle value', async () => {
        const db = createMemoryIdb();
        const repo = createTagRepo({ db });
        await repo.putLibrary({
            schemaVersion: 1,
            id: 'l1',
            name: '构图',
            active: true,
            kind: 'composition',
            createdAt: 't',
            updatedAt: 't',
        });
        const badKey = await repo.put({
            schemaVersion: 1,
            id: 'e1',
            libraryId: 'l1',
            key: '浴室',
            value: 'bathroom',
            createdAt: 't',
            updatedAt: 't',
        });
        assert.equal(isErr(badKey), true);
        assert.match(badKey.error.message, /构图 key/);

        const parenKey = await repo.put({
            schemaVersion: 1,
            id: 'e1b',
            libraryId: 'l1',
            key: '背景：浴室（浴室/洗澡）',
            value: 'bathroom, shower',
            createdAt: 't',
            updatedAt: 't',
        });
        assert.equal(isErr(parenKey), true);
        assert.match(parenKey.error.message, /全角括号|分类：名称/);

        const badVal = await repo.put({
            schemaVersion: 1,
            id: 'e2',
            libraryId: 'l1',
            key: '背景：浴室',
            value: '浴室：bathroom',
            createdAt: 't',
            updatedAt: 't',
        });
        assert.equal(isErr(badVal), true);
        assert.match(badVal.error.message, /小标题/);

        const ok = await repo.put({
            schemaVersion: 1,
            id: 'e3',
            libraryId: 'l1',
            key: '背景：浴室',
            value: 'bathroom, shower',
            createdAt: 't',
            updatedAt: 't',
        });
        assert.equal(isOk(ok), true);
    });

    it('import fails entirely when any entry is invalid', async () => {
        const db = createMemoryIdb();
        const repo = createTagRepo({ db });
        const payload = {
            schemaVersion: 1,
            kind: 'tag',
            libraries: [{
                schemaVersion: 1,
                id: 'l1',
                name: '构图',
                active: true,
                kind: 'composition',
                createdAt: 't',
                updatedAt: 't',
            }],
            entries: [
                {
                    schemaVersion: 1,
                    id: 'good',
                    libraryId: 'l1',
                    key: '背景：卧室',
                    value: 'bedroom',
                    createdAt: 't',
                    updatedAt: 't',
                },
                {
                    schemaVersion: 1,
                    id: 'bad',
                    libraryId: 'l1',
                    key: '浴室',
                    value: 'x',
                    createdAt: 't',
                    updatedAt: 't',
                },
            ],
        };
        const r = await repo.importJson(payload, { strategy: 'overwrite' });
        assert.equal(isErr(r), true);
        assert.match(r.error.message, /浴室/);
        assert.match(r.error.message, /未写入/);
        const listed = await repo.listLibraries();
        assert.equal(listed.value.length, 0);
        const entries = await repo.listEntries();
        assert.equal(entries.value.length, 0);
    });

    it('import rejects legacy paren trigger keys and points at that entry', async () => {
        const db = createMemoryIdb();
        const repo = createTagRepo({ db });
        const legacy = '背景：浴室（浴室/洗澡）';
        const r = await repo.importJson({
            schemaVersion: 1,
            kind: 'tag',
            libraries: [{
                schemaVersion: 1,
                id: 'l1',
                name: '构图',
                active: true,
                kind: 'composition',
                createdAt: 't',
                updatedAt: 't',
            }],
            entries: [{
                schemaVersion: 1,
                id: 'legacy',
                libraryId: 'l1',
                key: legacy,
                value: 'bathroom',
                createdAt: 't',
                updatedAt: 't',
            }],
        }, { strategy: 'overwrite' });
        assert.equal(isErr(r), true);
        assert.match(r.error.message, /浴室/);
        assert.match(r.error.message, /全角括号|分类：名称/);
        assert.match(r.error.message, /未写入/);
    });
});
