import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    SLOT_TOKEN_PATTERN_SOURCE,
    createSlotTokenRegex,
    formatSlotToken,
    parseSlotIds,
    stripSlotTokens,
    slotWidgetReplaceTemplate,
} from '../../src/domain/slot/slot-token.js';
import { placeSlots, findAnchorInsertIndex } from '../../src/domain/slot/slot-placer.js';

describe('slot-token', () => {
    it('format / parse / strip round-trip', () => {
        const token = formatSlotToken(3);
        assert.equal(token, '<IMG>\n3\n</IMG>');
        const text = `hello ${token} world <IMG> 7 </IMG>`;
        assert.deepEqual(parseSlotIds(text), [3, 7]);
        assert.equal(stripSlotTokens(text).replace(/\s+/g, ' ').trim(), 'hello world');
        assert.ok(createSlotTokenRegex().test(token));
        assert.ok(SLOT_TOKEN_PATTERN_SOURCE.includes('IMG'));
        const widget = slotWidgetReplaceTemplate();
        assert.ok(widget.includes('data-slot="$1"'));
        assert.equal(widget.startsWith('```html\n<!DOCTYPE html>\n'), true);
        assert.equal(widget.endsWith('\n```'), true);
    });

    it('rejects invalid slotId', () => {
        assert.throws(() => formatSlotToken(0));
        assert.throws(() => formatSlotToken(1.5));
    });
});

describe('slot-placer', () => {
    it('exact match inserts after anchor', () => {
        const text = '第一句。最后一句话。下一句。';
        const found = findAnchorInsertIndex(text, '最后一句话。');
        assert.equal(found.mode, 'exact');
        assert.equal(text.slice(0, found.index), '第一句。最后一句话。');
    });

    it('normalized match ignores extra spaces / punctuation', () => {
        const text = '他说：你好世界！然后走了。';
        const found = findAnchorInsertIndex(text, '你好 世界');
        assert.equal(found.mode, 'normalized');
        assert.ok(found.index > 0);
    });

    it('lcs match when paraphrased but shares long substring', () => {
        const text = '阳光洒在长廊尽头的石阶上，微风轻拂。';
        const found = findAnchorInsertIndex(text, '完全不同的开场，长廊尽头的石阶上，结尾也改了');
        assert.equal(found.mode, 'lcs');
        assert.ok(found.index > 0);
    });

    it('fail → placeSlots appends with append-warn', () => {
        const { text, placements } = placeSlots('正文只有这些。', [
            { slotId: 1, anchorSentence: '完全对不上的生成点XYZ', caption: {} },
        ]);
        assert.equal(placements[0].mode, 'append-warn');
        assert.equal(placements[0].placed, false);
        assert.ok(text.endsWith('<IMG>\n1\n</IMG>'));
    });

    it('places multiple plans sequentially', () => {
        const { text, placements } = placeSlots('AAA。BBB。', [
            { slotId: 1, anchorSentence: 'AAA。' },
            { slotId: 2, anchorSentence: 'BBB。' },
        ]);
        assert.equal(placements.every((p) => p.placed && p.mode === 'exact'), true);
        assert.ok(text.includes('<IMG>\n1\n</IMG>'));
        assert.ok(text.includes('<IMG>\n2\n</IMG>'));
    });
});
