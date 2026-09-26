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
     * @param {boolean} checked
     */
    /**
     * @param {any} node
     * @returns {string}
     */
    function deepText(node) {
        if (!node) return '';
        const own = String(node._text || node.textContent || '');
        const kids = Array.isArray(node.childNodes)
            ? node.childNodes.map((c) => deepText(c)).join('')
            : '';
        return own + kids;
    }

    /**
     * @param {Element} root
     * @param {string} label
     * @param {boolean} checked
     */
    function setCheckboxByLabel(root, label, checked) {
        /** @type {any[]} */
        const stack = [root];
        while (stack.length) {
            const node = stack.pop();
            if (!node) continue;
            const cls = String(node.className || '');
            const isRow = /(^|\s)nd-checkbox-row(\s|$)/.test(cls)
                || /(^|\s)nd-toggle-row(\s|$)/.test(cls);
            if (isRow && deepText(node).includes(label)) {
                /** @type {any[]} */
                const inner = [node];
                let input = null;
                while (inner.length) {
                    const n = inner.pop();
                    if (!n) continue;
                    if (String(n.tagName).toUpperCase() === 'INPUT') {
                        input = n;
                        break;
                    }
                    if (Array.isArray(n.childNodes)) {
                        for (const c of n.childNodes) inner.push(c);
                    }
                }
                assert.ok(input, `checkbox input missing for ${label}`);
                input.checked = checked;
                const change = (input._listeners || []).find((l) => l.type === 'change');
                change?.fn();
                return;
            }
            if (Array.isArray(node.childNodes)) {
                for (const c of node.childNodes) stack.push(c);
            }
        }
        throw new Error(`checkbox not found: ${label}`);
    }

    /**
     * @param {Element} root
     * @param {string} label
     * @param {string|number} value
     */
    function setNumberByLabel(root, label, value) {
        /** @type {any[]} */
        const stack = [root];
        while (stack.length) {
            const node = stack.pop();
            if (!node) continue;
            if (String(node.className || '').includes('nd-field')) {
                const labelEl = (node.childNodes || []).find(
                    (c) => c && String(c.className || '').includes('nd-field__label'),
                );
                if (labelEl && String(labelEl.textContent || '') === label) {
                    const input = (node.childNodes || []).find(
                        (c) => c && String(c.tagName).toUpperCase() === 'INPUT',
                    );
                    assert.ok(input, `number input missing for ${label}`);
                    input.value = String(value);
                    const handler = (input._listeners || []).find((l) => l.type === 'input');
                    handler?.fn();
                    return;
                }
            }
            if (Array.isArray(node.childNodes)) {
                for (const c of node.childNodes) stack.push(c);
            }
        }
        throw new Error(`number field not found: ${label}`);
    }

    /**
     * @param {Element} root
     * @param {string} label
     * @param {string} value
     */
    function setSelectByLabel(root, label, value) {
        /** @type {any[]} */
        const stack = [root];
        while (stack.length) {
            const node = stack.pop();
            if (!node) continue;
            if (String(node.className || '').includes('nd-field')) {
                const labelEl = (node.childNodes || []).find(
                    (c) => c && String(c.className || '').includes('nd-field__label'),
                );
                if (labelEl && String(labelEl.textContent || '') === label) {
                    const select = (node.childNodes || []).find(
                        (c) => c && String(c.tagName).toUpperCase() === 'SELECT',
                    );
                    assert.ok(select, `select missing for ${label}`);
                    select.value = String(value);
                    const handler = (select._listeners || []).find((l) => l.type === 'change');
                    handler?.fn();
                    return;
                }
            }
            if (Array.isArray(node.childNodes)) {
                for (const c of node.childNodes) stack.push(c);
            }
        }
        throw new Error(`select not found: ${label}`);
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
        assert.match(unmatchedText, /未匹配的构图标签/);
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
        setCheckboxByLabel(ctx.root, '替换角色关键字', true);

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

    it('D47: Variety / 透明底经 readParams 透传给出图', async () => {
        const ctx = mount();
        // Variety：4.5 开关；值由程序按尺寸计算
        setCheckboxByLabel(ctx.root, 'Variety', true);
        // 透明底：仅 V5 显示
        setSelectByLabel(ctx.root, '模型', 'nai-diffusion-5-full');
        setCheckboxByLabel(ctx.root, '透明底', true);

        await clickButton(ctx.root, '出图');
        await new Promise((r) => setTimeout(r, 0));

        assert.equal(ctx.genCalls.length, 1);
        const params = ctx.genCalls[0].params;
        // 切到 V5 后 Variety 被 coerce 关掉
        assert.equal(params.skip_cfg_above_sigma, null);
        assert.equal(params.tag_hint_transparent_background, true);
        assert.equal(params.straight_alpha, true);
        assert.equal(params.n_samples, defaultNaiParams().n_samples);
        assert.equal(params.model, 'nai-diffusion-5-full');
        ctx.handle.destroy();
    });

    it('D47b: 4.5 开启 Variety 按尺寸写入 skip_cfg_above_sigma', async () => {
        const ctx = mount();
        setCheckboxByLabel(ctx.root, 'Variety', true);
        await clickButton(ctx.root, '出图');
        await new Promise((r) => setTimeout(r, 0));
        const params = ctx.genCalls[0].params;
        assert.equal(params.model, 'nai-diffusion-4-5-full');
        assert.equal(params.skip_cfg_above_sigma, 58);
        assert.equal(params.tag_hint_qt, params.qualityToggle);
        ctx.handle.destroy();
    });

    it('D52: 双实例各自出图互不串扰（无 document 级定位）', async () => {
        const a = mount();
        const b = mount();
        await clickButton(b.root, '出图');
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(a.genCalls.length, 0, '实例 A 不应被 B 的点击触发');
        assert.equal(b.genCalls.length, 1);
        a.handle.destroy();
        b.handle.destroy();
    });

    it('粘贴提示词：填充场景/角色/位置，并匹配切换画师串', async () => {
        /** @type {object[]} */
        const saved = [];
        /** @type {string[]} */
        const clipboard = [[
            '画师串',
            '正面：artist:match',
            '负面：neg-match',
            '',
            '场景',
            '正面：pasted-scene',
            '负面：pasted-neg',
            '',
            '角色1',
            '正面：char-a',
            '负面：char-a-n',
            '位置：0.42, 0.58',
        ].join('\n')];

        const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            writable: true,
            value: {
                clipboard: {
                    async readText() {
                        return clipboard[0];
                    },
                },
            },
        });

        try {
            const ctx = mount({
                deps: {
                    loadSettings: () => ({
                        naiParams: defaultNaiParams(),
                        activeArtistId: 'old',
                    }),
                    saveSettings: (s) => { saved.push(s); },
                    artistRepo: {
                        async list() {
                            return {
                                ok: true,
                                value: [
                                    {
                                        id: 'art-hit',
                                        name: '命中串',
                                        positivePrompt: 'artist:match',
                                        negativePrompt: 'neg-match',
                                    },
                                ],
                            };
                        },
                    },
                },
            });

            assert.ok(findButton(ctx.root, '粘贴提示词'));
            await clickButton(ctx.root, '粘贴提示词');
            await new Promise((r) => setTimeout(r, 0));

            const caption = readCaptionFromEditor(ctx.root);
            assert.equal(caption.v4_prompt.caption.base_caption, 'pasted-scene');
            assert.equal(caption.v4_negative_prompt.caption.base_caption, 'pasted-neg');
            assert.equal(caption.v4_prompt.caption.char_captions[0].char_caption, 'char-a');
            assert.deepEqual(
                caption.v4_prompt.caption.char_captions[0].centers,
                [{ x: 0.42, y: 0.58 }],
            );
            assert.ok(ctx.toasts.some((t) => t[0] === 'success' && t[1] === '已粘贴'));
            assert.ok(ctx.toasts.some((t) => t[0] === 'success' && String(t[1]).includes('已切换画师串：命中串')));
            assert.equal(saved[0]?.activeArtistId, 'art-hit');
            ctx.handle.destroy();
        } finally {
            if (navDesc) {
                Object.defineProperty(globalThis, 'navigator', navDesc);
            } else {
                delete globalThis.navigator;
            }
        }
    });

    it('粘贴提示词：画师串不匹配时不切换', async () => {
        /** @type {object[]} */
        const saved = [];
        const navDesc = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
        Object.defineProperty(globalThis, 'navigator', {
            configurable: true,
            writable: true,
            value: {
                clipboard: {
                    async readText() {
                        return [
                            '画师串',
                            '正面：unknown',
                            '负面：x',
                            '',
                            '场景',
                            '正面：only-scene',
                        ].join('\n');
                    },
                },
            },
        });

        try {
            const ctx = mount({
                deps: {
                    loadSettings: () => ({
                        naiParams: defaultNaiParams(),
                        activeArtistId: 'keep-me',
                    }),
                    saveSettings: (s) => { saved.push(s); },
                    artistRepo: {
                        async list() {
                            return {
                                ok: true,
                                value: [{
                                    id: 'a1',
                                    name: 'A',
                                    positivePrompt: 'p',
                                    negativePrompt: 'n',
                                }],
                            };
                        },
                    },
                },
            });
            await clickButton(ctx.root, '粘贴提示词');
            await new Promise((r) => setTimeout(r, 0));
            assert.equal(saved.length, 0);
            assert.ok(ctx.toasts.some((t) => String(t[1]).includes('画师串库里没有这一串')));
            ctx.handle.destroy();
        } finally {
            if (navDesc) {
                Object.defineProperty(globalThis, 'navigator', navDesc);
            } else {
                delete globalThis.navigator;
            }
        }
    });

    it('searches tag entries and hides the ones that do not match', async () => {
        const ctx = mount({
            deps: {
                tagRepo: {
                    async listLibraries() {
                        return {
                            ok: true,
                            value: [{ id: 'comp', name: '构图', kind: 'composition' }],
                        };
                    },
                    async listEntries() {
                        return {
                            ok: true,
                            value: [
                                { id: 'e1', key: '饮食：吃西瓜', value: 'holding a melon slice', active: true },
                                { id: 'e2', key: '饮食：吃苹果', value: 'holding an apple', active: true },
                                { id: 'e3', key: '镜头：仰视', value: 'from below', active: true },
                            ],
                        };
                    },
                },
            },
        });
        await new Promise((r) => setTimeout(r, 0));

        /**
         * @param {string} text
         * @returns {any}
         */
        function rowByLabel(text) {
            /** @type {any[]} */
            const stack = [ctx.root];
            while (stack.length) {
                const node = stack.pop();
                if (!node) continue;
                if (node.textContent === text && node.parentNode) return node.parentNode;
                if (Array.isArray(node.childNodes)) {
                    for (const child of node.childNodes) stack.push(child);
                }
            }
            return null;
        }

        /** @type {any} */
        let input = null;
        /** @type {any[]} */
        const stack = [ctx.root];
        while (stack.length) {
            const node = stack.pop();
            if (!node) continue;
            if (node.tagName === 'INPUT' && node.placeholder === '搜索名称或正文') input = node;
            if (Array.isArray(node.childNodes)) {
                for (const child of node.childNodes) stack.push(child);
            }
        }
        assert.ok(input);
        input.value = 'melon slice';
        for (const listener of input._listeners || []) {
            if (listener.type === 'input') listener.fn();
        }

        const melon = rowByLabel('吃西瓜');
        const apple = rowByLabel('吃苹果');
        const camera = rowByLabel('镜头');
        const melonText = rowByLabel('holding a melon slice');
        assert.ok(melonText);
        assert.equal(melon.parentNode.hidden, false);
        assert.equal(apple.parentNode.hidden, true);
        assert.equal(camera.parentNode.hidden, true);

        input.value = '';
        for (const listener of input._listeners || []) {
            if (listener.type === 'input') listener.fn();
        }
        assert.equal(melon.parentNode.hidden, false);
        assert.equal(apple.parentNode.hidden, false);
        assert.equal(camera.parentNode.hidden, false);
        ctx.handle.destroy();
    });
});

/**
 * 从假 DOM 的 caption 编辑器读出当前值（按 label 找 textarea / number）。
 * @param {Element} root
 * @returns {import('../../src/domain/model/nai-params.js').NaiCaption}
 */
function readCaptionFromEditor(root) {
    /**
     * @param {string} label
     * @returns {any}
     */
    function fieldByLabel(label) {
        /** @type {any[]} */
        const stack = [root];
        while (stack.length) {
            const node = stack.pop();
            if (!node) continue;
            const parts = String(node.className || '').split(/\s+/);
            if (parts.includes('nd-field')) {
                const lab = (node.childNodes || []).find((c) => {
                    const p = String(c.className || '').split(/\s+/);
                    return p.includes('nd-field__label') && c.textContent === label;
                });
                if (lab) {
                    const control = (node.childNodes || []).find((c) => (
                        c.tagName === 'TEXTAREA' || c.tagName === 'INPUT'
                    ));
                    return control;
                }
            }
            if (Array.isArray(node.childNodes)) {
                for (const c of node.childNodes) stack.push(c);
            }
        }
        return null;
    }

    const posBase = fieldByLabel('场景 · 正面');
    const negBase = fieldByLabel('场景 · 负面');
    const charPos = fieldByLabel('正面');
    const charNeg = fieldByLabel('负面');
    const x = fieldByLabel('位置 X');
    const y = fieldByLabel('位置 Y');
    return {
        v4_prompt: {
            caption: {
                base_caption: String(posBase?.value ?? ''),
                char_captions: charPos ? [{
                    char_caption: String(charPos.value ?? ''),
                    centers: [{
                        x: Number(x?.value),
                        y: Number(y?.value),
                    }],
                }] : [],
            },
        },
        v4_negative_prompt: {
            caption: {
                base_caption: String(negBase?.value ?? ''),
                char_captions: charNeg ? [{
                    char_caption: String(charNeg.value ?? ''),
                    centers: [{
                        x: Number(x?.value),
                        y: Number(y?.value),
                    }],
                }] : [],
            },
        },
    };
}
