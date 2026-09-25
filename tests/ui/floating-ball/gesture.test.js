/**
 * 悬浮球手势识别器单测（假时钟 / 假定时器）。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    createGestureRecognizer,
    GESTURE_DOUBLE_TAP_MS,
    GESTURE_LONG_PRESS_MS,
    GESTURE_TAP_SLOP,
} from '../../../src/ui/floating-ball/gesture.js';

/**
 * @returns {{
 *   now: () => number,
 *   advance: (ms: number) => void,
 *   setTimer: (fn: () => void, ms: number) => number,
 *   clearTimer: (id: number) => void,
 * }}
 */
function createFakeClock() {
    let nowMs = 0;
    let nextId = 1;
    /** @type {Map<number, { due: number, fn: () => void }>} */
    const timers = new Map();

    return {
        now: () => nowMs,
        setTimer(fn, ms) {
            const id = nextId++;
            timers.set(id, { due: nowMs + Number(ms), fn });
            return id;
        },
        clearTimer(id) {
            timers.delete(/** @type {number} */ (id));
        },
        advance(ms) {
            nowMs += Number(ms);
            const due = [...timers.entries()]
                .filter(([, t]) => t.due <= nowMs)
                .sort((a, b) => a[1].due - b[1].due);
            for (const [id, t] of due) {
                if (!timers.has(id)) continue;
                timers.delete(id);
                t.fn();
            }
        },
    };
}

describe('ui/floating-ball/gesture', () => {
    it('exports threshold constants', () => {
        assert.equal(GESTURE_TAP_SLOP, 6);
        assert.equal(GESTURE_LONG_PRESS_MS, 500);
        assert.equal(GESTURE_DOUBLE_TAP_MS, 280);
    });

    it('单击：双击窗口过后触发 onTap', () => {
        const clock = createFakeClock();
        /** @type {string[]} */
        const log = [];
        const g = createGestureRecognizer({
            now: clock.now,
            setTimer: clock.setTimer,
            clearTimer: clock.clearTimer,
            onTap: () => log.push('tap'),
            onDoubleTap: () => log.push('dbl'),
            onLongPress: () => log.push('long'),
        });

        g.pointerDown(10, 10);
        g.pointerUp(10, 10);
        assert.deepEqual(log, []);
        clock.advance(GESTURE_DOUBLE_TAP_MS);
        assert.deepEqual(log, ['tap']);
    });

    it('双击：触发 onDoubleTap，不触发 onTap', () => {
        const clock = createFakeClock();
        /** @type {string[]} */
        const log = [];
        const g = createGestureRecognizer({
            now: clock.now,
            setTimer: clock.setTimer,
            clearTimer: clock.clearTimer,
            onTap: () => log.push('tap'),
            onDoubleTap: () => log.push('dbl'),
            onLongPress: () => log.push('long'),
        });

        g.pointerDown(0, 0);
        g.pointerUp(0, 0);
        clock.advance(100);
        g.pointerDown(0, 0);
        g.pointerUp(0, 0);
        clock.advance(GESTURE_DOUBLE_TAP_MS);
        assert.deepEqual(log, ['dbl']);
    });

    it('长按：触发 onLongPress，不触发 onTap', () => {
        const clock = createFakeClock();
        /** @type {string[]} */
        const log = [];
        const g = createGestureRecognizer({
            now: clock.now,
            setTimer: clock.setTimer,
            clearTimer: clock.clearTimer,
            onTap: () => log.push('tap'),
            onDoubleTap: () => log.push('dbl'),
            onLongPress: () => log.push('long'),
        });

        g.pointerDown(5, 5);
        clock.advance(GESTURE_LONG_PRESS_MS);
        assert.deepEqual(log, ['long']);
        g.pointerUp(5, 5);
        clock.advance(GESTURE_DOUBLE_TAP_MS);
        assert.deepEqual(log, ['long']);
    });

    it('按下后移动超阈值 → 拖动，不触发单击/长按', () => {
        const clock = createFakeClock();
        /** @type {string[]} */
        const log = [];
        const g = createGestureRecognizer({
            now: clock.now,
            setTimer: clock.setTimer,
            clearTimer: clock.clearTimer,
            onTap: () => log.push('tap'),
            onDoubleTap: () => log.push('dbl'),
            onLongPress: () => log.push('long'),
            onDragStart: (x, y) => log.push(`dragStart:${x},${y}`),
            onDragMove: (x, y) => log.push(`dragMove:${x},${y}`),
            onDragEnd: (x, y) => log.push(`dragEnd:${x},${y}`),
        });

        g.pointerDown(0, 0);
        g.pointerMove(GESTURE_TAP_SLOP + 1, 0);
        assert.ok(log[0].startsWith('dragStart:'));
        g.pointerMove(20, 4);
        g.pointerUp(20, 4);
        clock.advance(GESTURE_LONG_PRESS_MS + GESTURE_DOUBLE_TAP_MS);
        assert.ok(!log.includes('tap'));
        assert.ok(!log.includes('long'));
        assert.ok(log.some((x) => x.startsWith('dragEnd:')));
    });

    it('长按后移动：不再触发单击或拖动', () => {
        const clock = createFakeClock();
        /** @type {string[]} */
        const log = [];
        const g = createGestureRecognizer({
            now: clock.now,
            setTimer: clock.setTimer,
            clearTimer: clock.clearTimer,
            onTap: () => log.push('tap'),
            onLongPress: () => log.push('long'),
            onDragStart: () => log.push('dragStart'),
            onDragMove: () => log.push('dragMove'),
        });

        g.pointerDown(0, 0);
        clock.advance(GESTURE_LONG_PRESS_MS);
        assert.deepEqual(log, ['long']);
        g.pointerMove(40, 40);
        g.pointerUp(40, 40);
        clock.advance(GESTURE_DOUBLE_TAP_MS);
        assert.deepEqual(log, ['long']);
    });

    it('pointerCancel 取消当前跟踪，不触发单击', () => {
        const clock = createFakeClock();
        /** @type {string[]} */
        const log = [];
        const g = createGestureRecognizer({
            now: clock.now,
            setTimer: clock.setTimer,
            clearTimer: clock.clearTimer,
            onTap: () => log.push('tap'),
            onLongPress: () => log.push('long'),
        });

        g.pointerDown(1, 1);
        g.pointerCancel();
        clock.advance(GESTURE_LONG_PRESS_MS + GESTURE_DOUBLE_TAP_MS);
        assert.deepEqual(log, []);
    });

    it('destroy 后不再回调', () => {
        const clock = createFakeClock();
        /** @type {string[]} */
        const log = [];
        const g = createGestureRecognizer({
            now: clock.now,
            setTimer: clock.setTimer,
            clearTimer: clock.clearTimer,
            onTap: () => log.push('tap'),
            onLongPress: () => log.push('long'),
            onDragStart: () => log.push('drag'),
        });

        g.pointerDown(0, 0);
        g.destroy();
        clock.advance(GESTURE_LONG_PRESS_MS);
        g.pointerUp(0, 0);
        g.pointerMove(50, 0);
        clock.advance(GESTURE_DOUBLE_TAP_MS);
        assert.deepEqual(log, []);
    });
});
