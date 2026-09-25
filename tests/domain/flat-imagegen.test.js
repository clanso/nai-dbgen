import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFlatSlotPlans, parseFlatSingleCaption } from '../../src/domain/model/flat-imagegen.js';
import { slotCaptionFromLlmItem } from '../../src/domain/model/slot.js';

describe('flat imagegen fields', () => {
    it('builds a caption tree from flat lines', () => {
        const text = [
            'slotid: 2',
            'size: 832x1216',
            'analysis: ①选抓腰后入',
            '第二行仍算解析',
            'scene: sex from behind, on bed',
            'scene_uc: censored',
            'char: 0.4,0.6 | 1girl, looking back',
            'char_uc: open eyes',
            'char: 1boy, hands on hips',
            '---',
            'slotid: 3',
            'scene: hotel room',
        ].join('\n');
        const items = parseFlatSlotPlans(text);
        assert.equal(items.length, 2);
        const parsed = slotCaptionFromLlmItem(items[0]);
        assert.equal(parsed.ok, true);
        assert.equal(parsed.value.slotId, 2);
        assert.equal(parsed.value.size, '832x1216');
        assert.match(parsed.value.analysis, /第二行/);
        const pos = parsed.value.caption.v4_prompt.caption;
        assert.equal(pos.base_caption, 'sex from behind, on bed');
        assert.equal(pos.char_captions[0].centers[0].x, 0.4);
        assert.equal(pos.char_captions[1].centers[0].x, 0.5);
        assert.equal(parsed.value.caption.v4_negative_prompt.caption.char_captions[0].char_caption, 'open eyes');
    });

    it('ignores compact JSON so the old path still applies', () => {
        assert.equal(parseFlatSlotPlans('{"slots":[{"slotid":2}]}').length, 0);
    });

    it('parses a single image without slotid', () => {
        const one = parseFlatSingleCaption('scene: park\nchar: 1girl\nchar_uc: nude');
        assert.equal(one.caption.v4_prompt.caption.base_caption, 'park');
        assert.equal(one.caption.v4_negative_prompt.caption.char_captions[0].char_caption, 'nude');
    });
});
