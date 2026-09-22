import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeVisibleRange } from '../../src/ui/common/virtual-list.js';

describe('ui/common/virtual-list computeVisibleRange', () => {
    it('returns empty range for zero items', () => {
        assert.deepEqual(
            computeVisibleRange({
                scrollTop: 0,
                viewHeight: 200,
                rowHeight: 36,
                total: 0,
            }),
            { start: 0, end: 0 },
        );
    });

    it('computes first window with overscan', () => {
        assert.deepEqual(
            computeVisibleRange({
                scrollTop: 0,
                viewHeight: 100,
                rowHeight: 20,
                total: 100,
                overscan: 2,
            }),
            { start: 0, end: 9 },
        );
    });

    it('computes mid-list window', () => {
        // scrollTop 200 → index 10; overscan 4 → start 6
        // visible ceil(100/20)=5 + 8 = 13 → end 19
        assert.deepEqual(
            computeVisibleRange({
                scrollTop: 200,
                viewHeight: 100,
                rowHeight: 20,
                total: 50,
                overscan: 4,
            }),
            { start: 6, end: 19 },
        );
    });

    it('clamps to total at the bottom', () => {
        assert.deepEqual(
            computeVisibleRange({
                scrollTop: 900,
                viewHeight: 100,
                rowHeight: 20,
                total: 50,
                overscan: 4,
            }),
            { start: 41, end: 50 },
        );
    });

    it('guards against invalid sizes', () => {
        assert.deepEqual(
            computeVisibleRange({
                scrollTop: -10,
                viewHeight: 0,
                rowHeight: 0,
                total: 5,
                overscan: -1,
            }),
            { start: 0, end: 1 },
        );
    });
});
