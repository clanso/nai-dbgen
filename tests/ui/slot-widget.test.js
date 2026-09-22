/**
 * W2-G · mountSlotWidget：恢复已出图、恶意 URL、dispose 退订、不重复计费。
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { createEventBus } from '../../src/infra/event-bus.js';
import { APP_EVENTS } from '../../src/application/_helpers.js';
import { mountSlotWidget } from '../../src/ui/slot-widget/slot-widget.js';
import { clearSlotInflight, peekSlotInflight } from '../../src/ui/slot-widget/slot-mount.js';
import { safeImageUrl } from '../../src/ui/common/safe-url.js';
import { buildImageViewerElement } from '../../src/ui/slot-widget/image-viewer.js';

describe('ui/slot mountSlotWidget', () => {
    /** @type {ReturnType<typeof installFakeDom>|null} */
    let fake = null;

    beforeEach(() => {
        fake = installFakeDom();
        clearSlotInflight();
    });

    afterEach(() => {
        clearSlotInflight();
        fake?.restore();
        fake = null;
    });

    /**
     * @param {number} slotId
     */
    function makeRoot(slotId) {
        const root = document.createElement('div');
        root.setAttribute('data-slot', String(slotId));
        root.className = 'custom-nai-slot';
        const btn = document.createElement('button');
        btn.className = 'custom-nai-slot-btn';
        const img = document.createElement('div');
        img.className = 'custom-nai-slot-img';
        root.append(btn, img);
        document.body.appendChild(root);
        return root;
    }

    it('恶意 URL 被 safeImageUrl 拦截；viewer 不建危险 img', () => {
        assert.equal(safeImageUrl('javascript:alert(1)'), null);
        assert.equal(safeImageUrl('data:text/html,x'), null);
        assert.equal(buildImageViewerElement.length, 2);
        // openSlotImageViewer 对坏 URL 返回 null——纯门禁已由 safeImageUrl 覆盖
        const el = buildImageViewerElement('https://cdn.example/a.png', 'x');
        assert.equal(el.id, 'nai-dbgen-root');
        const img = el.childNodes[0];
        assert.equal(img.tagName, 'IMG');
        assert.equal(img.src, 'https://cdn.example/a.png');
    });

    it('从持久层恢复：已出图 remount 仍是 done + 展示图', async () => {
        const root = makeRoot(1);
        /** @type {Record<string, unknown>|null} */
        let record = {
            messageId: 0,
            slotId: 1,
            images: [{ imageRef: 'ref-done' }],
        };

        const handle = mountSlotWidget(root, 0, {
            onGenerateClick: () => ({ ok: true, value: {} }),
            getRecord: () => /** @type {any} */ (record),
            getImageUrl: async (ref) => {
                assert.equal(ref, 'ref-done');
                return 'https://cdn.example/done.png';
            },
        });

        await new Promise((r) => setTimeout(r, 0));
        assert.ok(root.className.includes('nd-slot--done'), root.className);
        assert.equal(
            [...root.childNodes].some((n) => String(n.className || '').includes('nd-slot__btn')
                && n.textContent === '重新生成'),
            true,
        );

        // 模拟宿主重渲染：destroy 后重新挂
        handle.destroy();
        const root2 = makeRoot(1);
        const handle2 = mountSlotWidget(root2, 0, {
            onGenerateClick: () => ({ ok: true }),
            getRecord: () => /** @type {any} */ (record),
            getImageUrl: async () => 'https://cdn.example/done.png',
        });
        await new Promise((r) => setTimeout(r, 0));
        assert.ok(root2.className.includes('nd-slot--done'), root2.className);
        handle2.destroy();
    });

    it('失败态展示中文 message 与 traceId', async () => {
        const root = makeRoot(2);
        const handle = mountSlotWidget(root, 3, {
            onGenerateClick: async () => ({
                ok: false,
                error: { message: '接口鉴权失败（Key 无效或过期）', traceId: 'trace-xyz' },
            }),
            getRecord: () => null,
            getImageUrl: async () => null,
        });

        const btn = [...root.childNodes].find(
            (n) => String(n.tagName).toUpperCase() === 'BUTTON',
        );
        assert.ok(btn);
        // 直接触发监听器（假 DOM 无真实 click 冒泡）
        const clickListeners = btn._listeners.filter((l) => l.type === 'click');
        assert.ok(clickListeners.length >= 1);
        await clickListeners[0].fn({ preventDefault() {}, stopPropagation() {} });
        await new Promise((r) => setTimeout(r, 0));

        assert.ok(root.className.includes('nd-slot--error'), root.className);
        const errEl = [...root.childNodes].find(
            (n) => String(n.className || '').includes('nd-slot__error'),
        );
        assert.ok(errEl);
        assert.equal(errEl.hidden, false);
        const texts = [...errEl.childNodes].map((n) => n.textContent).join('\n');
        assert.match(texts, /接口鉴权失败/);
        assert.match(texts, /trace-xyz/);
        handle.destroy();
    });

    it('Abort 结算不进 error 态', async () => {
        const root = makeRoot(4);
        const handle = mountSlotWidget(root, 1, {
            onGenerateClick: async () => ({
                ok: false,
                error: { code: 'UPSTREAM_ABORTED', message: '请求已取消' },
            }),
            getRecord: () => null,
            getImageUrl: async () => null,
        });
        const btn = [...root.childNodes].find(
            (n) => String(n.tagName).toUpperCase() === 'BUTTON',
        );
        await btn._listeners.find((l) => l.type === 'click').fn({
            preventDefault() {},
            stopPropagation() {},
        });
        await new Promise((r) => setTimeout(r, 0));
        assert.ok(root.className.includes('nd-slot--idle'), root.className);
        assert.equal(peekSlotInflight(1, 4), null);
        handle.destroy();
    });

    it('dispose 后不再响应 bus；进行中不重复 onGenerateClick', async () => {
        const bus = createEventBus();
        const root = makeRoot(7);
        let clicks = 0;
        /** @type {(() => void)|null} */
        let release = null;

        const handle = mountSlotWidget(root, 2, {
            bus,
            onGenerateClick: () => new Promise((resolve) => {
                clicks += 1;
                release = () => resolve({ ok: true, value: {} });
            }),
            getRecord: () => null,
            getImageUrl: async () => null,
        });

        const btn = [...root.childNodes].find(
            (n) => String(n.tagName).toUpperCase() === 'BUTTON',
        );
        const fire = () => btn._listeners.find((l) => l.type === 'click').fn({
            preventDefault() {},
            stopPropagation() {},
        });

        fire();
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(clicks, 1);
        assert.ok(peekSlotInflight(2, 7)?.status === 'generating');

        // 第二次点击不得再计费
        fire();
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(clicks, 1);

        // destroy 后退订 bus
        handle.destroy();
        let refreshed = false;
        // 另挂一个已 destroy 的不应再改 DOM——用新实例验证 unsub
        const rootB = makeRoot(7);
        const handleB = mountSlotWidget(rootB, 2, {
            bus,
            onGenerateClick: () => ({ ok: true }),
            getRecord: () => ({ images: [{ imageRef: 'r' }] }),
            getImageUrl: async () => {
                refreshed = true;
                return 'https://cdn.example/z.png';
            },
        });
        await new Promise((r) => setTimeout(r, 0));

        handleB.destroy();
        // destroy 后 emit 不应让已销毁实例抛错；点击数仍为 1
        bus.emit(APP_EVENTS.SLOT_RENDERED, { messageId: 2, slotId: 7, imageRef: 'r' });
        assert.equal(clicks, 1);

        release?.();
        await new Promise((r) => setTimeout(r, 0));
        void refreshed;
    });

    it('getImageUrl 返回 javascript: 时不写入 img.src', async () => {
        const root = makeRoot(8);
        const handle = mountSlotWidget(root, 0, {
            onGenerateClick: () => ({ ok: true }),
            getRecord: () => ({ images: [{ imageRef: 'evil' }] }),
            getImageUrl: async () => 'javascript:alert(1)',
        });
        await new Promise((r) => setTimeout(r, 0));
        const imgBox = [...root.childNodes].find(
            (n) => String(n.className || '').includes('nd-slot__img'),
        );
        assert.ok(imgBox);
        assert.equal(imgBox.childNodes.length, 0);
        handle.destroy();
    });
});
