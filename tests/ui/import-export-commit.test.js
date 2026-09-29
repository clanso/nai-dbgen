import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { mountImportExport } from '../../src/ui/common/import-export.js';

describe('ui/common/import-export commitImport (D44)', () => {
    /** @type {ReturnType<typeof installFakeDom>|null} */
    let fake = null;
    /** @type {((...args: any[]) => boolean)|undefined} */
    let prevConfirm;

    beforeEach(() => {
        fake = installFakeDom();
        prevConfirm = globalThis.confirm;
    });

    afterEach(() => {
        if (prevConfirm === undefined) delete globalThis.confirm;
        else globalThis.confirm = prevConfirm;
        fake?.restore();
        fake = null;
    });

    /**
     * @param {any} root
     * @returns {{ paste: any, parseBtn: any, commitBtn: any, strategySelect: any }}
     */
    function findControls(root) {
        /** @type {any} */
        let paste = null;
        /** @type {any} */
        let parseBtn = null;
        /** @type {any} */
        let commitBtn = null;
        /** @type {any} */
        let strategySelect = null;
        /**
         * @param {any} node
         */
        function walk(node) {
            if (!node) return;
            if (node.tagName === 'TEXTAREA') paste = node;
            if (node.tagName === 'SELECT') strategySelect = node;
            if (node.tagName === 'BUTTON') {
                const label = node.textContent || '';
                if (label.includes('解析')) parseBtn = node;
                if (label.includes('导入已勾选')) commitBtn = node;
            }
            for (const c of node.childNodes || []) walk(c);
        }
        walk(root);
        return { paste, parseBtn, commitBtn, strategySelect };
    }

    /**
     * @param {any} root
     * @param {number} index
     * @param {boolean} checked
     */
    function setRowChecked(root, index, checked) {
        /** @type {any[]} */
        const checks = [];
        /**
         * @param {any} node
         */
        function walk(node) {
            if (!node) return;
            if (node.tagName === 'INPUT' && node.type === 'checkbox') checks.push(node);
            for (const c of node.childNodes || []) walk(c);
        }
        walk(root);
        const box = checks[index];
        assert.ok(box, `checkbox ${index}`);
        box.checked = checked;
        for (const l of box._listeners.filter((x) => x.type === 'change')) {
            l.fn();
        }
    }

    /**
     * @param {any} btn
     */
    async function click(btn) {
        for (const l of btn._listeners.filter((x) => x.type === 'click')) {
            l.fn({ preventDefault() {} });
        }
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 0));
    }

    it('passes only checked items to importJson', async () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        /** @type {any[]} */
        const calls = [];
        const handle = mountImportExport(root, {
            importJson: async (data, strategy) => {
                calls.push({ data, strategy });
                return {};
            },
            exportJson: async () => ({}),
            confirmOverwrite: async () => true,
        });

        const { paste, parseBtn, commitBtn } = findControls(root);
        paste.value = JSON.stringify({
            kind: 'artist',
            items: [
                { id: 'a1', name: 'keep' },
                { id: 'a2', name: 'drop' },
            ],
        });
        await click(parseBtn);
        setRowChecked(root, 1, false);
        await click(commitBtn);

        assert.equal(calls.length, 1);
        assert.deepEqual(calls[0].data.items.map((x) => x.id), ['a1']);
        assert.equal(calls[0].strategy, 'overwrite');
        handle.destroy();
    });

    it('does not call importJson when all unchecked', async () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        let called = 0;
        const handle = mountImportExport(root, {
            importJson: async () => {
                called += 1;
                return {};
            },
            exportJson: async () => ({}),
        });

        const { paste, parseBtn, commitBtn } = findControls(root);
        paste.value = JSON.stringify({ items: [{ id: 'x' }] });
        await click(parseBtn);
        setRowChecked(root, 0, false);
        await click(commitBtn);

        assert.equal(called, 0);
        handle.destroy();
    });

    it('overwrite without confirmOverwrite callback refuses only real id collisions', async () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        let called = 0;
        let winConfirm = 0;
        globalThis.confirm = () => {
            winConfirm += 1;
            return true;
        };

        const handle = mountImportExport(root, {
            importJson: async () => {
                called += 1;
                return {};
            },
            exportJson: async () => ({}),
        });

        const { paste, parseBtn, commitBtn, strategySelect } = findControls(root);
        paste.value = JSON.stringify({ items: [{ id: 'x' }, { id: 'y' }] });
        await click(parseBtn);
        strategySelect.value = 'overwrite';
        await click(commitBtn);

        assert.equal(called, 1);
        assert.equal(winConfirm, 0);
        handle.destroy();

        const rootHit = document.createElement('div');
        document.body.appendChild(rootHit);
        let calledHit = 0;
        const handleHit = mountImportExport(rootHit, {
            importJson: async () => {
                calledHit += 1;
                return {};
            },
            exportJson: async () => ({ items: [{ id: 'x', name: '已有' }] }),
        });
        const hit = findControls(rootHit);
        hit.paste.value = JSON.stringify({ items: [{ id: 'x' }, { id: 'y' }] });
        await click(hit.parseBtn);
        hit.strategySelect.value = 'overwrite';
        await click(hit.commitBtn);
        assert.equal(calledHit, 0);
        handleHit.destroy();
    });

    it('confirmOverwrite callback false skips; no window.confirm', async () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        let called = 0;
        let winConfirm = 0;
        globalThis.confirm = () => {
            winConfirm += 1;
            return true;
        };
        let cbCount = 0;

        const handle = mountImportExport(root, {
            importJson: async () => {
                called += 1;
                return {};
            },
            exportJson: async () => ({ items: [{ id: 'a', name: '已有' }] }),
            confirmOverwrite: async (count) => {
                cbCount = count;
                return false;
            },
        });

        const { paste, parseBtn, commitBtn, strategySelect } = findControls(root);
        paste.value = JSON.stringify({ items: [{ id: 'a' }, { id: 'b' }] });
        await click(parseBtn);
        strategySelect.value = 'overwrite';
        await click(commitBtn);

        assert.equal(cbCount, 1);
        assert.equal(winConfirm, 0);
        assert.equal(called, 0);

        // flip callback to allow
        handle.destroy();
        const root2 = document.createElement('div');
        document.body.appendChild(root2);
        const handle2 = mountImportExport(root2, {
            importJson: async () => {
                called += 1;
                return {};
            },
            exportJson: async () => ({}),
            confirmOverwrite: async () => true,
        });
        const c2 = findControls(root2);
        c2.paste.value = JSON.stringify({ items: [{ id: 'a' }] });
        await click(c2.parseBtn);
        c2.strategySelect.value = 'overwrite';
        await click(c2.commitBtn);
        assert.equal(called, 1);
        assert.equal(winConfirm, 0);
        handle2.destroy();
    });

    function allText(root) {
        const parts = [];
        /**
         * @param {any} node
         */
        function walk(node) {
            if (!node) return;
            if (node._text) parts.push(String(node._text));
            for (const c of node.childNodes || []) walk(c);
        }
        walk(root);
        return parts.join('\n');
    }

    it('import mode has no export controls', () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        const handle = mountImportExport(root, {
            importJson: async () => ({}),
            exportJson: async () => ({}),
        });
        const text = allText(root);
        assert.match(text, /拖入资料文件/);
        assert.match(text, /导入已勾选/);
        assert.equal(text.includes('导出已勾选'), false);
        assert.equal(text.includes('载入当前库'), false);
        handle.destroy();
    });

    it('export mode lists the current library and has no import controls', async () => {
        const root = document.createElement('div');
        document.body.appendChild(root);
        const handle = mountImportExport(root, {
            mode: 'export',
            importJson: async () => ({}),
            exportJson: async () => ({
                presets: [
                    { id: 'a', name: '一', kind: 'imagegen' },
                    { id: 'b', name: '二', kind: 'imagegen' },
                ],
            }),
        });
        await new Promise((r) => setTimeout(r, 0));
        const text = allText(root);
        assert.match(text, /当前库 2 条/);
        assert.match(text, /导出已勾选/);
        assert.equal(text.includes('导入已勾选'), false);
        assert.equal(text.includes('拖入资料文件'), false);
        assert.equal(text.includes('覆盖已有'), false);
        handle.destroy();
    });
});
