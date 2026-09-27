import { it } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { createPromptTextarea, linkTextareaHeights } from '../../src/ui/common/prompt-textarea.js';

it('copies exactly the current prompt text from its own icon button', async () => {
    const fake = installFakeDom();
    const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    const copied = [];
    Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: { clipboard: { writeText: async (text) => { copied.push(text); } } },
    });
    try {
        const field = createPromptTextarea({ label: '场景 · 正面', value: 'initial tag' });
        document.body.appendChild(field.el);
        field.input.value = 'edited tag, another tag';
        const copy = field.el.querySelector('.nd-wb-prompt-copy');
        assert.ok(copy.querySelector('svg'));
        const click = copy._listeners.find((listener) => listener.type === 'click');
        await click.fn({ preventDefault() {}, stopPropagation() {} });
        assert.deepEqual(copied, ['edited tag, another tag']);
        field.destroy();
    } finally {
        if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator);
        else delete globalThis.navigator;
        fake.restore();
    }
});

it('mirrors a dragged textarea height to its paired prompt and disconnects on cleanup', () => {
    const fake = installFakeDom();
    const previousObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
    let observer;
    class MockResizeObserver {
        constructor(callback) { this.callback = callback; this.observed = []; observer = this; }
        observe(node) { this.observed.push(node); }
        disconnect() { this.disconnected = true; }
    }
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: MockResizeObserver });
    try {
        const first = document.createElement('textarea');
        const second = document.createElement('textarea');
        first._height = second._height = 88;
        first.getBoundingClientRect = () => ({ height: first._height });
        second.getBoundingClientRect = () => ({ height: second._height });
        const unlink = linkTextareaHeights(first, second);
        assert.deepEqual(observer.observed, [first, second]);
        observer.callback([{ target: first }, { target: second }]);
        first._height = 170;
        first.style.height = '170px';
        observer.callback([{ target: first }]);
        assert.equal(second.style.height, '170px');
        second._height = 195;
        second.style.height = '195px';
        observer.callback([{ target: second }]);
        assert.equal(first.style.height, '195px');
        unlink();
        assert.equal(observer.disconnected, true);
    } finally {
        if (previousObserver) Object.defineProperty(globalThis, 'ResizeObserver', previousObserver);
        else delete globalThis.ResizeObserver;
        fake.restore();
    }
});
