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

describe('block-set', () => {
    it('create / set immutable / get missing as empty / toRecord', () => {
        const a = createBlockSet([['世界书', 'wi']]);
        const b = setBlock(a, '角色库', 'chars');
        assert.equal(getBlock(a, '角色库'), '');
        assert.equal(getBlock(b, '角色库'), 'chars');
        assert.equal(getBlock(b, '标签库'), '');
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
