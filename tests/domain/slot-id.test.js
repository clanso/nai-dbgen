/**
 * 需求 4.7 · 会话内 slotId 分配纯函数。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    allocateSlotIdsAfterMax,
    findLatestFloorMaxSlotId,
    maxSlotIdInTexts,
} from '../../src/domain/slot/slot-id.js';
import {
    retainedAiMessageIds,
    trimRecordsByMessageIds,
} from '../../src/domain/slot/session-retain.js';

describe('domain/slot-id', () => {
    it('全无从 1 起', () => {
        assert.equal(findLatestFloorMaxSlotId([]), 0);
        assert.deepEqual(allocateSlotIdsAfterMax(0, 3), [1, 2, 3]);
    });

    it('最新楼无 token 往前找', () => {
        const floors = [
            { texts: ['no slots here'] },
            { texts: ['has <IMG>\n4\n</IMG> and <IMG>2</IMG>'] },
            { texts: ['older <IMG>99</IMG>'] },
        ];
        assert.equal(findLatestFloorMaxSlotId(floors), 4);
        assert.deepEqual(allocateSlotIdsAfterMax(4, 2), [5, 6]);
    });

    it('swipe 里的更大值', () => {
        const max = maxSlotIdInTexts([
            'current <IMG>3</IMG>',
            'other swipe <IMG>\n12\n</IMG>',
        ]);
        assert.equal(max, 12);
        assert.equal(findLatestFloorMaxSlotId([
            { texts: ['a <IMG>3</IMG>', 'b <IMG>12</IMG>'] },
        ]), 12);
    });

    it('正在生图的这一楼本身已有 slot', () => {
        const floors = [
            { texts: ['floor being generated <IMG>7</IMG> <IMG>8</IMG>'] },
            { texts: ['older <IMG>1</IMG>'] },
        ];
        assert.equal(findLatestFloorMaxSlotId(floors), 8);
        assert.deepEqual(allocateSlotIdsAfterMax(8, 2), [9, 10]);
    });
});

describe('domain/session-retain', () => {
    it('保留最近 N 条 AI 楼的 messageId', () => {
        const messages = [
            { messageId: 0, isUser: true },
            { messageId: 1, isUser: false },
            { messageId: 2, isUser: false },
            { messageId: 3, isUser: true },
            { messageId: 4, isUser: false },
        ];
        const keep = retainedAiMessageIds(messages, 2);
        assert.deepEqual([...keep].sort(), [2, 4]);
        const { kept, removed } = trimRecordsByMessageIds(
            [
                { messageId: 1, slotId: 1 },
                { messageId: 4, slotId: 2 },
            ],
            keep,
        );
        assert.equal(kept.length, 1);
        assert.equal(kept[0].slotId, 2);
        assert.equal(removed.length, 1);
    });
});
