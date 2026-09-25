import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    createBlockSet,
    setBlock,
    getBlock,
    blockSetToRecord,
} from '../../src/domain/blocks/block-set.js';
import { formatCharacterBlock } from '../../src/domain/blocks/character.block.js';
import { formatContextBlock } from '../../src/domain/blocks/context.block.js';
import { formatTagBlock } from '../../src/domain/blocks/tag.block.js';
import { formatWorldInfoBlock } from '../../src/domain/blocks/worldinfo.block.js';
import {
    formatCompositionBlock,
    formatSingleCompositionBlock,
} from '../../src/domain/blocks/composition.block.js';
import { formatFeatureBlock } from '../../src/domain/blocks/feature.block.js';
import {
    collectConstantEntries,
    formatConstantBlock,
} from '../../src/domain/blocks/constant.block.js';

describe('block-set', () => {
    it('create / set immutable / get missing as empty / toRecord', () => {
        const a = createBlockSet([['世界书', 'wi']]);
        const b = setBlock(a, '角色库', 'chars');
        assert.equal(getBlock(a, '角色库'), '');
        assert.equal(getBlock(b, '角色库'), 'chars');
        assert.equal(getBlock(b, '构图标签'), '');
        assert.deepEqual(blockSetToRecord(b), { '世界书': 'wi', '角色库': 'chars' });
    });

    it('rejects bad setBlock args', () => {
        assert.throws(() => setBlock({}, 'a', 'b'));
    });
});

describe('formatCharacterBlock', () => {
    it('marks fixed/variable; omits empty variable section', () => {
        const text = formatCharacterBlock([
            {
                name: '张三',
                fixedFeatures: '黑发',
                variableFeatures: [
                    { name: '日常服饰', prompt: '校服' },
                    { name: '非日常服饰', prompt: '礼服' },
                ],
            },
            {
                name: '李四',
                fixedFeatures: '蓝瞳',
                variableFeatures: [],
            },
        ]);
        assert.equal(
            text,
            [
                '张三：',
                '固定特征：黑发',
                '非固定特征：',
                '   日常服饰：校服',
                '   非日常服饰：礼服',
                '',
                '李四：',
                '固定特征：蓝瞳',
            ].join('\n'),
        );
    });

    it('empty list → empty string', () => {
        assert.equal(formatCharacterBlock([]), '');
        assert.equal(formatCharacterBlock(null), '');
    });
});

describe('formatContextBlock', () => {
    it('joins in given order; optional names', () => {
        const msgs = [
            { name: 'A', text: 'one' },
            { name: 'B', text: 'two' },
        ];
        assert.equal(formatContextBlock(msgs), 'one\n\ntwo');
        assert.equal(formatContextBlock(msgs, { includeNames: true }), 'A: one\n\nB: two');
    });
});

describe('formatTagBlock', () => {
    it('writes values only, skips empty', () => {
        assert.equal(
            formatTagBlock([
                { key: 'k1', value: 'red hair' },
                { key: 'k2', value: '' },
                { key: 'k3', value: 'school' },
            ]),
            'red hair\nschool',
        );
        assert.equal(formatTagBlock([]), '');
    });
});

describe('formatWorldInfoBlock', () => {
    it('trims; null → empty', () => {
        assert.equal(formatWorldInfoBlock('  hello  '), 'hello');
        assert.equal(formatWorldInfoBlock(null), '');
    });
});

describe('formatCompositionBlock', () => {
    it('lists slotid, anchor, kv per position', () => {
        const text = formatCompositionBlock([
            {
                slotId: 1,
                anchorSentence: '她走进花园。',
                entries: [
                    { key: 'garden', value: 'flower garden' },
                    { key: 'close-up', value: 'close up' },
                ],
            },
            {
                slotId: 2,
                anchorSentence: '雨停了。',
                entries: [{ key: 'rain', value: 'wet street' }],
            },
        ]);
        assert.equal(
            text,
            [
                'slotid: 1',
                '生成点: 她走进花园。',
                'garden: flower garden',
                'close-up: close up',
                '',
                'slotid: 2',
                '生成点: 雨停了。',
                'rain: wet street',
            ].join('\n'),
        );
        assert.equal(formatCompositionBlock([]), '');
    });
});

describe('formatSingleCompositionBlock', () => {
    it('lists key: value only', () => {
        assert.equal(
            formatSingleCompositionBlock([
                { key: 'a', value: '1' },
                { key: 'b', value: '2' },
            ]),
            'a: 1\nb: 2',
        );
        assert.equal(formatSingleCompositionBlock([]), '');
    });
});

describe('formatFeatureBlock', () => {
    it('lists key: value', () => {
        assert.equal(
            formatFeatureBlock([
                { key: '金发', value: 'blonde hair' },
                { key: '蓝瞳', value: 'blue eyes' },
            ]),
            '金发: blonde hair\n蓝瞳: blue eyes',
        );
        assert.equal(formatFeatureBlock([]), '');
    });
});

describe('constant block', () => {
    it('format matches feature (key: value)', () => {
        assert.equal(
            formatConstantBlock([
                { key: '杂项A', value: 'misc a' },
                { key: '杂项B', value: 'misc b' },
            ]),
            '杂项A: misc a\n杂项B: misc b',
        );
        assert.equal(formatConstantBlock([]), '');
    });

    it('collects active constant libs in list order; inactive skipped', () => {
        const libraries = [
            {
                id: 'c2', name: '常驻乙', active: true, kind: 'constant',
            },
            {
                id: 'f1', name: '特征', active: true, kind: 'feature',
            },
            {
                id: 'c1', name: '常驻甲', active: true, kind: 'constant',
            },
            {
                id: 'c0', name: '停用', active: false, kind: 'constant',
            },
        ];
        const byLib = new Map([
            ['c1', [
                { id: 'e1', key: '甲1', value: 'a1' },
                { id: 'e2', key: '甲2', value: 'a2' },
            ]],
            ['c2', [
                { id: 'e3', key: '乙1', value: 'b1' },
            ]],
            ['c0', [
                { id: 'e4', key: '停', value: 'off' },
            ]],
        ]);
        const entries = collectConstantEntries(libraries, byLib);
        assert.deepEqual(
            entries.map((e) => e.key),
            ['乙1', '甲1', '甲2'],
        );
        assert.equal(
            formatConstantBlock(entries),
            '乙1: b1\n甲1: a1\n甲2: a2',
        );
    });
});
