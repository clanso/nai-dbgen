/**
 * 悬浮球位置纯函数单测。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    FAB_EDGE_MARGIN,
    FAB_POS_STORAGE_KEY,
    PANEL_VIEW_MARGIN,
    clamp,
    clampToViewport,
    computePanelPlacement,
    defaultFabPos,
    deserializeFabPos,
    pixelToStored,
    serializeFabPos,
    snapToNearestEdge,
    storedToPixel,
} from '../../../src/ui/floating-ball/position.js';

describe('ui/floating-ball/position', () => {
    it('storage key is stable', () => {
        assert.equal(FAB_POS_STORAGE_KEY, 'nai-dbgen:floating-ball-pos');
    });

    it('clamp', () => {
        assert.equal(clamp(5, 0, 10), 5);
        assert.equal(clamp(-1, 0, 10), 0);
        assert.equal(clamp(99, 0, 10), 10);
        assert.equal(clamp(Number.NaN, 0, 10), 0);
    });

    it('吸边：更靠近左边 → left', () => {
        const r = snapToNearestEdge(20, 100, 48, 400, 800);
        assert.equal(r.side, 'left');
        assert.equal(r.x, FAB_EDGE_MARGIN);
        assert.ok(r.y >= FAB_EDGE_MARGIN);
    });

    it('吸边：更靠近右边 → right，垂直位置保留并 clamp', () => {
        const r = snapToNearestEdge(350, 10, 48, 400, 200);
        assert.equal(r.side, 'right');
        assert.equal(r.x, 400 - 48 - FAB_EDGE_MARGIN);
        assert.equal(r.y, 10);
        const clamped = snapToNearestEdge(350, 2, 48, 400, 200);
        assert.equal(clamped.y, FAB_EDGE_MARGIN);
    });

    it('clampToViewport 限制在视口内', () => {
        const r = clampToViewport(-50, 9999, 48, 320, 500);
        assert.equal(r.x, FAB_EDGE_MARGIN);
        assert.equal(r.y, 500 - 48 - FAB_EDGE_MARGIN);
    });

    it('非法反序列化返回 null', () => {
        assert.equal(deserializeFabPos(null), null);
        assert.equal(deserializeFabPos(''), null);
        assert.equal(deserializeFabPos('{'), null);
        assert.equal(deserializeFabPos('{"v":2,"side":"left","yRatio":0.5}'), null);
        assert.equal(deserializeFabPos('{"v":1,"side":"up","yRatio":0.5}'), null);
        assert.equal(deserializeFabPos('{"v":1,"side":"left","yRatio":"x"}'), null);
        assert.equal(deserializeFabPos({ v: 1, side: 'left' }), null);
    });

    it('比例换算往返', () => {
        const ball = 48;
        const vw = 900;
        const vh = 700;
        const snapped = snapToNearestEdge(880, 210, ball, vw, vh);
        const stored = pixelToStored(snapped, ball, vh);
        const json = serializeFabPos(stored);
        const parsed = deserializeFabPos(json);
        assert.ok(parsed);
        const back = storedToPixel(parsed, ball, vw, vh);
        assert.ok(back);
        assert.equal(back.side, snapped.side);
        assert.ok(Math.abs(back.y - snapped.y) < 1.5);
        assert.equal(back.x, snapped.x);
    });

    it('defaultFabPos 落在右侧并在视口内', () => {
        const p = defaultFabPos(48, 500, 800);
        assert.equal(p.side, 'right');
        assert.equal(p.x, 500 - 48 - FAB_EDGE_MARGIN);
        assert.ok(p.y >= FAB_EDGE_MARGIN);
        assert.ok(p.y <= 800 - 48 - FAB_EDGE_MARGIN);
    });

    it('computePanelPlacement：top + maxHeight 不越出视口', () => {
        const cases = [
            // 球在右下（1280×800）
            {
                ballLeft: 1224,
                ballTop: 700,
                ballRight: 1272,
                ballBottom: 748,
                side: /** @type {'right'} */ ('right'),
                viewportW: 1280,
                viewportH: 800,
            },
            // 球在右上
            {
                ballLeft: 1224,
                ballTop: 20,
                ballRight: 1272,
                ballBottom: 68,
                side: /** @type {'right'} */ ('right'),
                viewportW: 1280,
                viewportH: 800,
            },
            // 窄屏 390×844，球在底部
            {
                ballLeft: 334,
                ballTop: 760,
                ballRight: 382,
                ballBottom: 808,
                side: /** @type {'right'} */ ('right'),
                viewportW: 390,
                viewportH: 844,
            },
        ];
        for (const c of cases) {
            const p = computePanelPlacement(c);
            assert.ok(p.top >= PANEL_VIEW_MARGIN, `top too small: ${p.top}`);
            assert.ok(
                p.top + p.maxHeight <= c.viewportH - PANEL_VIEW_MARGIN + 0.5,
                `bottom overflow: top=${p.top} maxH=${p.maxHeight} vh=${c.viewportH}`,
            );
            assert.ok(p.left >= PANEL_VIEW_MARGIN);
            assert.ok(p.left + p.width <= c.viewportW - PANEL_VIEW_MARGIN + 0.5);
            assert.ok(p.maxHeight <= c.viewportH - 2 * PANEL_VIEW_MARGIN + 0.5);
        }
    });
});
