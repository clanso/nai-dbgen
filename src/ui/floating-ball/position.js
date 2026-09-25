/**
 * L5 UI · 悬浮球位置：吸边、clamp、比例⇄像素、序列化（纯函数）。
 */

/** localStorage 键（UI 偏好，不进 PluginSettings） */
export const FAB_POS_STORAGE_KEY = 'nai-dbgen:floating-ball-pos';

/** 与视口边缘的最小间距（px） */
export const FAB_EDGE_MARGIN = 8;

/**
 * @typedef {'left'|'right'} FabSide
 */

/**
 * @typedef {object} FabPixelPos
 * @property {number} x 左上角 x（px）
 * @property {number} y 左上角 y（px）
 * @property {FabSide} side
 */

/**
 * @typedef {object} FabStoredPos
 * @property {1} v
 * @property {FabSide} side
 * @property {number} yRatio 相对「可用垂直行程」的 0..1
 */

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
export function clamp(value, min, max) {
    const v = Number(value);
    const lo = Number(min);
    const hi = Number(max);
    if (!Number.isFinite(v)) return lo;
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
}

/**
 * 把球限制在视口内（保留当前 x/y，仅 clamp）。
 * @param {number} x
 * @param {number} y
 * @param {number} ballSize
 * @param {number} viewportW
 * @param {number} viewportH
 * @param {number} [margin]
 * @returns {{ x: number, y: number }}
 */
export function clampToViewport(x, y, ballSize, viewportW, viewportH, margin = FAB_EDGE_MARGIN) {
    const size = Math.max(0, Number(ballSize) || 0);
    const m = Math.max(0, Number(margin) || 0);
    const maxX = Math.max(m, Number(viewportW) - size - m);
    const maxY = Math.max(m, Number(viewportH) - size - m);
    return {
        x: clamp(x, m, maxX),
        y: clamp(y, m, maxY),
    };
}

/**
 * 吸到最近的左/右边缘，保留垂直位置并 clamp。
 * @param {number} x
 * @param {number} y
 * @param {number} ballSize
 * @param {number} viewportW
 * @param {number} viewportH
 * @param {number} [margin]
 * @returns {FabPixelPos}
 */
export function snapToNearestEdge(x, y, ballSize, viewportW, viewportH, margin = FAB_EDGE_MARGIN) {
    const size = Math.max(0, Number(ballSize) || 0);
    const m = Math.max(0, Number(margin) || 0);
    const vw = Number(viewportW);
    const vh = Number(viewportH);
    const leftDist = Number(x) - m;
    const rightDist = vw - size - m - Number(x);
    /** @type {FabSide} */
    const side = leftDist <= rightDist ? 'left' : 'right';
    const nx = side === 'left' ? m : Math.max(m, vw - size - m);
    const clamped = clampToViewport(nx, y, size, vw, vh, m);
    return { x: clamped.x, y: clamped.y, side };
}

/**
 * 像素位置 → 可持久化记录（边 + 垂直比例）。
 * @param {FabPixelPos} pos
 * @param {number} ballSize
 * @param {number} viewportH
 * @returns {FabStoredPos}
 */
export function pixelToStored(pos, ballSize, viewportH) {
    const size = Math.max(0, Number(ballSize) || 0);
    const travel = Math.max(1, Number(viewportH) - size - 2 * FAB_EDGE_MARGIN);
    const yFromTop = Number(pos.y) - FAB_EDGE_MARGIN;
    return {
        v: 1,
        side: pos.side === 'right' ? 'right' : 'left',
        yRatio: clamp(yFromTop / travel, 0, 1),
    };
}

/**
 * 持久化记录 → 像素位置；非法返回 null。
 * @param {unknown} stored
 * @param {number} ballSize
 * @param {number} viewportW
 * @param {number} viewportH
 * @returns {FabPixelPos|null}
 */
export function storedToPixel(stored, ballSize, viewportW, viewportH) {
    if (!stored || typeof stored !== 'object') return null;
    const rec = /** @type {Record<string, unknown>} */ (stored);
    if (rec.v !== 1) return null;
    if (rec.side !== 'left' && rec.side !== 'right') return null;
    const yRatio = Number(rec.yRatio);
    if (!Number.isFinite(yRatio)) return null;

    const size = Math.max(0, Number(ballSize) || 0);
    const m = FAB_EDGE_MARGIN;
    const vw = Number(viewportW);
    const vh = Number(viewportH);
    const travel = Math.max(1, vh - size - 2 * m);
    const y = m + clamp(yRatio, 0, 1) * travel;
    const x = rec.side === 'left' ? m : Math.max(m, vw - size - m);
    const clamped = clampToViewport(x, y, size, vw, vh, m);
    return { x: clamped.x, y: clamped.y, side: /** @type {FabSide} */ (rec.side) };
}

/**
 * @param {FabStoredPos} stored
 * @returns {string}
 */
export function serializeFabPos(stored) {
    return JSON.stringify(stored);
}

/**
 * 反序列化；非法数据返回 null（不抛）。
 * @param {unknown} raw
 * @returns {FabStoredPos|null}
 */
export function deserializeFabPos(raw) {
    if (raw == null) return null;
    let parsed = raw;
    if (typeof raw === 'string') {
        const s = raw.trim();
        if (!s) return null;
        try {
            parsed = JSON.parse(s);
        } catch {
            return null;
        }
    }
    if (!parsed || typeof parsed !== 'object') return null;
    const rec = /** @type {Record<string, unknown>} */ (parsed);
    if (rec.v !== 1) return null;
    if (rec.side !== 'left' && rec.side !== 'right') return null;
    const yRatio = Number(rec.yRatio);
    if (!Number.isFinite(yRatio)) return null;
    return {
        v: 1,
        side: /** @type {FabSide} */ (rec.side),
        yRatio: clamp(yRatio, 0, 1),
    };
}

/**
 * 默认落点：右下偏中。
 * @param {number} ballSize
 * @param {number} viewportW
 * @param {number} viewportH
 * @returns {FabPixelPos}
 */
export function defaultFabPos(ballSize, viewportW, viewportH) {
    const size = Math.max(0, Number(ballSize) || 0);
    const m = FAB_EDGE_MARGIN;
    const x = Math.max(m, Number(viewportW) - size - m);
    const y = Math.max(m, Number(viewportH) * 0.62 - size / 2);
    return snapToNearestEdge(x, y, size, viewportW, viewportH, m);
}

/** 浮层面板与视口边缘间距 */
export const PANEL_VIEW_MARGIN = 12;

/** 浮层与球的间距 */
export const PANEL_BALL_GAP = 10;

/**
 * @typedef {object} PanelPlacementInput
 * @property {number} ballLeft
 * @property {number} ballTop
 * @property {number} ballRight
 * @property {number} ballBottom
 * @property {FabSide} side 球吸附边
 * @property {number} viewportW
 * @property {number} viewportH
 * @property {number} [panelWidth] 期望宽度（会再 clamp）
 * @property {number} [margin]
 * @property {number} [gap]
 */

/**
 * @typedef {object} PanelPlacement
 * @property {number} left
 * @property {number} top
 * @property {number} width
 * @property {number} maxHeight 保证 top + maxHeight ≤ viewportH - margin
 */

/**
 * 按球位置与视口计算浮层 left/top/width/maxHeight，保证不越出视口。
 * @param {PanelPlacementInput} input
 * @returns {PanelPlacement}
 */
export function computePanelPlacement(input) {
    const margin = Number(input.margin ?? PANEL_VIEW_MARGIN);
    const gap = Number(input.gap ?? PANEL_BALL_GAP);
    const vw = Number(input.viewportW);
    const vh = Number(input.viewportH);
    const m = Number.isFinite(margin) && margin >= 0 ? margin : PANEL_VIEW_MARGIN;

    const maxHeight = Math.max(160, vh - 2 * m);
    const wantW = Number(input.panelWidth ?? 360);
    const width = clamp(wantW, 160, Math.max(160, vw - 2 * m));

    const preferRight = input.side === 'left';
    let left = preferRight
        ? Number(input.ballRight) + gap
        : Number(input.ballLeft) - width - gap;
    left = clamp(left, m, Math.max(m, vw - m - width));

    const midY = (Number(input.ballTop) + Number(input.ballBottom)) / 2;
    const preferBelow = midY < vh / 2;
    let top = preferBelow ? Number(input.ballTop) : Number(input.ballBottom) - maxHeight;
    top = clamp(top, m, Math.max(m, vh - m - maxHeight));

    return { left, top, width, maxHeight };
}
