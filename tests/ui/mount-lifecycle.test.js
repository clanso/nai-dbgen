import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { mountVirtualList } from '../../src/ui/common/virtual-list.js';
import { mountCurrentPicker } from '../../src/ui/common/current-picker.js';
import { mountImportExport } from '../../src/ui/common/import-export.js';

describe('ui/common mount lifecycle (fake DOM)', () => {
    /** @type {ReturnType<typeof installFakeDom>|null} */
    let fake = null;

    beforeEach(() => {
        fake = installFakeDom();
    });

    afterEach(() => {
        fake?.restore();
        fake = null;
    });

    it('mountVirtualList unbinds scroll on destroy (idempotent)', () => {
        const root = document.createElement('div');
        document.body.appendChild(root);

        const handle = mountVirtualList(root, {
            getItems: () => [{ id: 1 }, { id: 2 }],
            renderRow: (item, el) => {
                el.textContent = String(item.id);
            },
            rowHeight: 36,
        });

        const host = root.childNodes[0];
        assert.ok(host);
        assert.equal(host.listenerCount('scroll'), 1);

        handle.destroy();
        assert.equal(host.listenerCount('scroll'), 0);
        assert.equal(root.childNodes.length, 0);

        handle.destroy();
        assert.equal(host.listenerCount('scroll'), 0);
    });

    it('mountCurrentPicker unbinds document.pointerdown on destroy', async () => {
        const root = document.createElement('div');
        document.body.appendChild(root);

        const handle = mountCurrentPicker(root, {
            list: async () => [{ id: 'a', name: 'A' }],
            getActiveId: () => null,
            setActiveId: () => {},
        });

        await handle.refresh();
        assert.ok(
            fake.document._docListeners.some((l) => l.type === 'pointerdown'),
            'pointerdown bound on document',
        );

        handle.destroy();
        assert.equal(
            fake.document._docListeners.filter((l) => l.type === 'pointerdown').length,
            0,
        );

        handle.destroy();
        assert.equal(
            fake.document._docListeners.filter((l) => l.type === 'pointerdown').length,
            0,
        );
    });

    it('mountImportExport unbinds five drag/file listeners on destroy', () => {
        const root = document.createElement('div');
        document.body.appendChild(root);

        const handle = mountImportExport(root, {
            importJson: async () => ({}),
            exportJson: async () => ({}),
        });

        const shell = root.childNodes[0];
        assert.ok(shell);

        /** @type {any} */
        let drop = null;
        /** @type {any} */
        let fileInput = null;

        /**
         * @param {any} node
         */
        function walk(node) {
            if (!node) return;
            if (node.className === 'nd-dropzone') drop = node;
            if (node.tagName === 'INPUT' && node.type === 'file') fileInput = node;
            for (const c of node.childNodes || []) walk(c);
        }
        walk(shell);

        assert.ok(drop, 'dropzone present');
        assert.ok(fileInput, 'file input present');

        assert.equal(drop.listenerCount('dragenter'), 1);
        assert.equal(drop.listenerCount('dragover'), 1);
        assert.equal(drop.listenerCount('dragleave'), 1);
        assert.equal(drop.listenerCount('drop'), 1);
        assert.equal(fileInput.listenerCount('change'), 1);

        handle.destroy();

        assert.equal(drop.listenerCount('dragenter'), 0);
        assert.equal(drop.listenerCount('dragover'), 0);
        assert.equal(drop.listenerCount('dragleave'), 0);
        assert.equal(drop.listenerCount('drop'), 0);
        assert.equal(fileInput.listenerCount('change'), 0);
        assert.equal(root.childNodes.length, 0);

        handle.destroy();
    });
});
