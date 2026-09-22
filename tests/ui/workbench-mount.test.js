/**
 * W2-I · mountWorkbench：解耦接线、开关透传、禁连点、Abort、dispose。
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { mountWorkbench } from '../../src/ui/workbench/workbench.js';
import { defaultNaiParams, emptyNaiCaption } from '../../src/domain/model/nai-params.js';

describe('ui/workbench mountWorkbench', () => {
    /** @type {ReturnType<typeof installFakeDom>|null} */
    let fake = null;

    beforeEach(() => {
        fake = installFakeDom();
    });

    afterEach(() => {
        fake?.restore();
        fake = null;
    });

    /**
     * @param {object} [overrides]
     */
    function mount(overrides = {}) {
        const root = document.createElement('div');
        document.body.appendChild(root);

        /** @type {object[]} */
        const writeCalls = [];
        /** @type {object[]} */
        const genCalls = [];
        /** @type {Array<[string, string]>} */
        const toasts = [];

        let writeResolve;
        /** @type {Promise<any>|null} */
        let writeGate = null;
        let genResolve;
        /** @type {Promise<any>|null} */
        let genGate = null;

        const workbenchService = {
            async writePrompt(input) {
                writeCalls.push(input);
                if (writeGate) await writeGate;
                return {
                    ok: true,
                    value: {
                        caption: {
                            v4_prompt: {
                                caption: {
                                    base_caption: 'llm-base',
                                    char_captions: [
                                        {
                                            char_caption: 'char-pos',
                                            centers: [{ x: 0.3, y: 0.7 }],
                                        },
                                    ],
                                },
                            },
                            v4_negative_prompt: {
                                caption: {
                                    base_caption: 'llm-neg',
                                    char_captions: [
                                        {
                                            char_caption: 'char-neg',
                                            centers: [{ x: 0.3, y: 0.7 }],
                                        },
                                    ],
                                },
                            },
                        },
                        unmatchedKeys: ['fabricated-key'],
                    },
                };
            },
            async generateImage(input) {
                genCalls.push(input);
                if (genGate) await genGate;
                return {
                    ok: true,
                    value: [{
                        blob: typeof Blob !== 'undefined'
                            ? new Blob(['png'], { type: 'image/png' })
                            : /** @type {any} */ ({}),
                        mimeType: 'image/png',
                    }],
                };
            },
        };

        Object.assign(workbenchService, overrides.service || {});

        const handle = mountWorkbench(root, {
            workbenchService,
            loadSettings: () => ({
                naiParams: defaultNaiParams(),
            }),
            host: {
                toast(level, message) {
                    toasts.push([level, message]);
                },
            },
            tagRepo: {
                async listLibraries() {
                    return {
                        ok: true,
                        value: [
                            { id: 'lib1', name: '风景', active: true },
                            { id: 'lib2', name: '服饰', active: false },
                        ],
                    };
                },
            },
            ...overrides.deps,
        });

        return {
            root,
            handle,
            writeCalls,
            genCalls,
            toasts,
            holdWrite() {
                writeGate = new Promise((r) => { writeResolve = r; });
            },
            releaseWrite() {
                writeResolve?.();
                writeGate = null;
            },
            holdGen() {
                genGate = new Promise((r) => { genResolve = r; });
            },
            releaseGen() {
                genResolve?.();
                genGate = null;
            },
        };
    }

    /**
     * 在假 DOM 上按按钮文案找按钮并点它。
     * @param {Element} root
     * @param {string} label
     */
    async function clickButton(root, label) {
        /** @type {any[]} */
        const stack = [root];
        while (stack.length) {
            const node = stack.pop();
            if (!node) continue;
            if (String(node.tagName).toUpperCase() === 'BUTTON'
                && node.textContent === label) {
                const listeners = (node._listeners || []).filter((l) => l.type === 'click');
                assert.ok(listeners.length >= 1, `no click listener on ${label}`);
                for (const l of listeners) {
                    await l.fn({ preventDefault() {} });
                }
                return node;
            }
            if (Array.isArray(node.childNodes)) {
                for (const c of node.childNodes) stack.push(c);
            }
        }
        throw new Error(`button not found: ${label}`);
    }

    /**
     * @param {Element} root
     * @param {string} label
     * @returns {any}
     */
    function findButton(root, label) {
        /** @type {any[]} */
        const stack = [root];
        while (stack.length) {
            const node = stack.pop();
            if (!node) continue;
            if (String(node.tagName).toUpperCase() === 'BUTTON'
                && node.textContent === label) {
                return node;
            }
            if (Array.isArray(node.childNodes)) {
                for (const c of node.childNodes) stack.push(c);
            }
        }
        return null;
    }

    it('写提示词只调 writePrompt，不调 generateImage；展示 unmatchedKeys', async () => {
        const ctx = mount();
        await new Promise((r) => setTimeout(r, 0)); // 等库列表
        await clickButton(ctx.root, '写提示词');
        await new Promise((r) => setTimeout(r, 0));

        assert.equal(ctx.writeCalls.length, 1);
        assert.equal(ctx.genCalls.length, 0);

        // unmatchedKeys 可见
        /** @type {any[]} */
        const stack = [ctx.root];
        let unmatchedText = '';
        while (stack.length) {
            const node = stack.pop();
            if (!node) continue;
            if (String(node.className || '').includes('nd-wb-unmatched')) {
                unmatchedText = String(node.textContent || '');
            }
            if (Array.isArray(node.childNodes)) {
                for (const c of node.childNodes) stack.push(c);
            }
        }
        assert.match(unmatchedText, /fabricated-key/);
        assert.match(unmatchedText, /未命中标签 key/);
        ctx.handle.destroy();
    });

    it('出图只调 generateImage；replaceCharacterKeywords 来自开关', async () => {
        const ctx = mount();
        await clickButton(ctx.root, '出图');
        await new Promise((r) => setTimeout(r, 0));

        assert.equal(ctx.genCalls.length, 1);
        assert.equal(ctx.writeCalls.length, 0);
        assert.equal(ctx.genCalls[0].replaceCharacterKeywords, false);
        assert.ok(ctx.genCalls[0].caption);
        assert.equal(
            ctx.genCalls[0].params.model,
            defaultNaiParams().model,
            '参数默认来自 domain',
        );
        ctx.handle.destroy();
    });

    it('开关拨开后，无论 caption 如何，透传 true', async () => {
        const ctx = mount();
        // 找到「是否替换角色关键字」toggle 的 checkbox 并勾上
        /** @type {any[]} */
        const stack = [ctx.root];
        let toggleInput = null;
        while (stack.length) {
            const node = stack.pop();
            if (!node) continue;
            if (String(node.className || '').includes('nd-toggle-row')) {
                const input = (node.childNodes || []).find(
                    (c) => c && String(c.tagName).toUpperCase() === 'INPUT',
                );
                if (input) {
                    toggleInput = input;
                    break;
                }
            }
            if (Array.isArray(node.childNodes)) {
                for (const c of node.childNodes) stack.push(c);
            }
        }
        assert.ok(toggleInput);
        toggleInput.checked = true;
        const change = (toggleInput._listeners || []).find((l) => l.type === 'change');
        change?.fn();

        await clickButton(ctx.root, '出图');
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(ctx.genCalls[0].replaceCharacterKeywords, true);
        ctx.handle.destroy();
    });

    it('出图进行中禁按钮，重复点击不重复计费', async () => {
        const ctx = mount();
        ctx.holdGen();

        const p1 = clickButton(ctx.root, '出图');
        await new Promise((r) => setTimeout(r, 0));

        const btn = findButton(ctx.root, '出图');
        assert.ok(btn);
        assert.equal(btn.disabled, true, '进行中必须禁用');

        // 再点一次应被门禁吞掉
        await clickButton(ctx.root, '出图');
        assert.equal(ctx.genCalls.length, 1, '不得连点连发');

        ctx.releaseGen();
        await p1;
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(btn.disabled, false);
        ctx.handle.destroy();
    });

    it('Abort 出图不弹错误 toast', async () => {
        /** @type {object[]} */
        const genCalls = [];
        /** @type {Array<[string, string]>} */
        const toasts = [];
        const root = document.createElement('div');
        document.body.appendChild(root);
        const handle = mountWorkbench(root, {
            workbenchService: {
                async writePrompt() {
                    return { ok: true, value: { caption: emptyNaiCaption(), unmatchedKeys: [] } };
                },
                async generateImage(input) {
                    genCalls.push(input);
                    return {
                        ok: false,
                        error: { code: 'UPSTREAM_ABORTED', message: '请求已取消' },
                    };
                },
            },
            loadSettings: () => ({ naiParams: defaultNaiParams() }),
            host: {
                toast(level, message) {
                    toasts.push([level, message]);
                },
            },
        });

        await clickButton(root, '出图');
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(genCalls.length, 1);
        assert.equal(toasts.filter((t) => t[0] === 'error').length, 0);
        handle.destroy();
    });

    it('dispose 后可再次挂载，无残留监听泄漏（按钮可销毁）', () => {
        const ctx = mount();
        ctx.handle.destroy();
        assert.equal(ctx.root.childNodes.length, 0);
        const ctx2 = mount();
        assert.ok(findButton(ctx2.root, '写提示词'));
        assert.ok(findButton(ctx2.root, '出图'));
        ctx2.handle.destroy();
    });
});
