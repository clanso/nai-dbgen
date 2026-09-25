/**
 * L5 UI · 悬浮球手势识别器（纯状态机，不碰 DOM / 真实定时器）。
 */

/** 按下后移动超过此像素视为拖动（取消单击/长按） */
export const GESTURE_TAP_SLOP = 6;

/** 长按阈值（ms） */
export const GESTURE_LONG_PRESS_MS = 500;

/** 单击等待双击窗口（ms）；窗口内第二次抬起判为双击 */
export const GESTURE_DOUBLE_TAP_MS = 280;

/**
 * @typedef {object} GestureRecognizerOptions
 * @property {number} [tapSlop]
 * @property {number} [longPressMs]
 * @property {number} [doubleTapMs]
 */

/**
 * @typedef {object} GestureRecognizerDeps
 * @property {() => number} now
 * @property {(fn: () => void, ms: number) => unknown} setTimer
 * @property {(id: unknown) => void} clearTimer
 * @property {() => void} [onTap]
 * @property {() => void} [onDoubleTap]
 * @property {() => void} [onLongPress]
 * @property {(x: number, y: number) => void} [onDragStart]
 * @property {(x: number, y: number) => void} [onDragMove]
 * @property {(x: number, y: number) => void} [onDragEnd]
 * @property {GestureRecognizerOptions} [options]
 */

/**
 * @typedef {object} GestureRecognizer
 * @property {(x: number, y: number) => void} pointerDown
 * @property {(x: number, y: number) => void} pointerMove
 * @property {(x: number, y: number) => void} pointerUp
 * @property {() => void} pointerCancel
 * @property {() => void} destroy
 */

/**
 * 创建指针手势识别器。时间与定时器必须注入，便于单测。
 * @param {GestureRecognizerDeps} deps
 * @returns {GestureRecognizer}
 */
export function createGestureRecognizer(deps) {
    if (typeof deps?.now !== 'function') {
        throw new Error('createGestureRecognizer: now required');
    }
    if (typeof deps?.setTimer !== 'function' || typeof deps?.clearTimer !== 'function') {
        throw new Error('createGestureRecognizer: setTimer/clearTimer required');
    }

    const tapSlop = Number(deps.options?.tapSlop ?? GESTURE_TAP_SLOP);
    const longPressMs = Number(deps.options?.longPressMs ?? GESTURE_LONG_PRESS_MS);
    const doubleTapMs = Number(deps.options?.doubleTapMs ?? GESTURE_DOUBLE_TAP_MS);

    /** @type {'idle'|'down'|'dragging'|'longPressed'} */
    let phase = 'idle';
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastY = 0;
    /** @type {unknown} */
    let longPressTimer = null;
    /** @type {unknown} */
    let tapTimer = null;
    let destroyed = false;

    /**
     * @returns {void}
     */
    function clearLongPressTimer() {
        if (longPressTimer != null) {
            deps.clearTimer(longPressTimer);
            longPressTimer = null;
        }
    }

    /**
     * @returns {void}
     */
    function clearTapTimer() {
        if (tapTimer != null) {
            deps.clearTimer(tapTimer);
            tapTimer = null;
        }
    }

    /**
     * @returns {void}
     */
    function resetTracking() {
        clearLongPressTimer();
        phase = 'idle';
    }

    /**
     * @param {number} x
     * @param {number} y
     * @returns {void}
     */
    function pointerDown(x, y) {
        if (destroyed) return;
        // 新按下打断未完成的单击等待（双击窗口内第二次按下由 pointerUp 判双击）
        startX = Number(x);
        startY = Number(y);
        lastX = startX;
        lastY = startY;
        phase = 'down';
        clearLongPressTimer();
        longPressTimer = deps.setTimer(() => {
            longPressTimer = null;
            if (destroyed || phase !== 'down') return;
            phase = 'longPressed';
            clearTapTimer();
            if (typeof deps.onLongPress === 'function') {
                deps.onLongPress();
            }
        }, longPressMs);
    }

    /**
     * @param {number} x
     * @param {number} y
     * @returns {void}
     */
    function pointerMove(x, y) {
        if (destroyed) return;
        if (phase !== 'down' && phase !== 'dragging') return;
        lastX = Number(x);
        lastY = Number(y);
        if (phase === 'down') {
            const dx = lastX - startX;
            const dy = lastY - startY;
            if (dx * dx + dy * dy >= tapSlop * tapSlop) {
                clearLongPressTimer();
                clearTapTimer();
                phase = 'dragging';
                if (typeof deps.onDragStart === 'function') {
                    deps.onDragStart(lastX, lastY);
                }
            }
            return;
        }
        if (typeof deps.onDragMove === 'function') {
            deps.onDragMove(lastX, lastY);
        }
    }

    /**
     * @param {number} x
     * @param {number} y
     * @returns {void}
     */
    function pointerUp(x, y) {
        if (destroyed) return;
        lastX = Number(x);
        lastY = Number(y);
        const was = phase;
        clearLongPressTimer();

        if (was === 'dragging') {
            phase = 'idle';
            if (typeof deps.onDragEnd === 'function') {
                deps.onDragEnd(lastX, lastY);
            }
            return;
        }

        if (was === 'longPressed') {
            phase = 'idle';
            return;
        }

        if (was !== 'down') {
            phase = 'idle';
            return;
        }

        phase = 'idle';

        // 双击窗口内已有待发单击 → 本次为双击
        if (tapTimer != null) {
            clearTapTimer();
            if (typeof deps.onDoubleTap === 'function') {
                deps.onDoubleTap();
            }
            return;
        }

        tapTimer = deps.setTimer(() => {
            tapTimer = null;
            if (destroyed) return;
            if (typeof deps.onTap === 'function') {
                deps.onTap();
            }
        }, doubleTapMs);
    }

    /**
     * @returns {void}
     */
    function pointerCancel() {
        if (destroyed) return;
        clearLongPressTimer();
        // 取消当前触点；已排队的单击仍可在窗口到期后触发（与常见移动端一致：
        // cancel 打断本次手势，但不把「等待中的单击」吞掉——除非仍在 down/drag）。
        // 此处：若正在跟踪，清除；tapTimer 保留。
        if (phase === 'dragging') {
            phase = 'idle';
            if (typeof deps.onDragEnd === 'function') {
                deps.onDragEnd(lastX, lastY);
            }
            return;
        }
        resetTracking();
    }

    /**
     * @returns {void}
     */
    function destroy() {
        if (destroyed) return;
        destroyed = true;
        clearLongPressTimer();
        clearTapTimer();
        phase = 'idle';
    }

    return {
        pointerDown,
        pointerMove,
        pointerUp,
        pointerCancel,
        destroy,
    };
}
