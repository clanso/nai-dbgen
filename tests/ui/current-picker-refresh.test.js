import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { mountCurrentPicker } from '../../src/ui/common/current-picker.js';

describe('D60 mountCurrentPicker.refresh', () => {
    /** @type {ReturnType<typeof installFakeDom>|null} */
    let fake = null;

    beforeEach(() => {
        fake = installFakeDom();
    });

    afterEach(() => {
        fake?.restore();
        fake = null;
    });

    it('exposes refresh(): Promise<void> and re-syncs active label after external change', async () => {
        const root = document.createElement('div');
        document.body.appendChild(root);

        /** @type {{ id: string, name: string }[]} */
        let items = [
            { id: 'a', name: 'Alpha' },
            { id: 'b', name: 'Beta' },
        ];
        /** @type {string|null} */
        let activeId = 'a';

        const api = mountCurrentPicker(root, {
            list: async () => items,
            getActiveId: () => activeId,
            setActiveId: (id) => {
                activeId = id;
            },
        });

        assert.equal(typeof api.refresh, 'function');
        assert.equal(typeof api.destroy, 'function');

        await api.refresh();

        /** @type {any} */
        let search = null;
        /**
         * @param {any} node
         */
        function walk(node) {
            if (!node) return;
            if (node.tagName === 'INPUT' && node.type === 'search') search = node;
            for (const c of node.childNodes || []) walk(c);
        }
        walk(root);
        assert.ok(search);
        assert.equal(search.value, 'Alpha');

        // 外部改激活项（管理台 / 空配置）后不重挂，只调 refresh
        activeId = null;
        items = [];
        await api.refresh();
        assert.equal(search.value, '');

        items = [{ id: 'b', name: 'Beta' }];
        activeId = 'b';
        await api.refresh();
        assert.equal(search.value, 'Beta');

        api.destroy();
    });
});
