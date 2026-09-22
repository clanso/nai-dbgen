import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { openModal } from '../../src/ui/common/modal.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

describe('ui/common/modal nd-root (D52)', () => {
    /** @type {ReturnType<typeof installFakeDom>|null} */
    let fake = null;

    beforeEach(() => {
        fake = installFakeDom();
    });

    afterEach(() => {
        fake?.restore();
        fake = null;
    });

    it('buildRoot / native path mounts .nd-root without id', async () => {
        const content = document.createElement('div');
        content.textContent = 'body';
        const handle = await openModal({ host: null }, {
            title: 'T',
            element: content,
        });
        assert.ok(handle.destroy);

        /** @type {any[]} */
        const roots = [];
        /**
         * @param {any} node
         */
        function walk(node) {
            if (!node) return;
            if (typeof node.className === 'string' && node.className.split(/\s+/).includes('nd-root')) {
                roots.push(node);
            }
            for (const c of node.childNodes || []) walk(c);
        }
        walk(document.body);

        assert.ok(roots.length >= 1, 'at least one .nd-root');
        for (const r of roots) {
            assert.notEqual(r.id, 'nai-dbgen-root');
            assert.ok(r.classList.contains('nd-root'));
        }
        handle.destroy();
    });

    it('with multiple .nd-root in document, destroy targets the dialog that owns element', async () => {
        // decoy: earlier shell-like root (would be first for getElementById)
        const decoy = document.createElement('div');
        decoy.id = 'nai-dbgen-root';
        decoy.className = 'nd-root';
        document.body.appendChild(decoy);

        const content = document.createElement('div');
        content.dataset.marker = 'mine';
        const handle = await openModal({ host: null }, {
            title: 'Mine',
            element: content,
        });

        // content should live under a dialog that is NOT the decoy
        const dlg = content.closest('dialog');
        assert.ok(dlg, 'element lives in a dialog');
        assert.notEqual(dlg, decoy);
        assert.ok(dlg.contains(content) || content.parentNode);

        // destroy should remove the owned native dialog, leave decoy
        handle.destroy();
        assert.ok(
            document.body.childNodes.includes(decoy),
            'decoy root still on body',
        );
        assert.equal(
            document.body.childNodes.includes(dlg),
            false,
            'owned dialog removed from body',
        );
    });

    it('host openModal path resolves dialog via element.closest, not id lookup', async () => {
        const decoy = document.createElement('div');
        decoy.id = 'nai-dbgen-root';
        decoy.className = 'nd-root';
        const decoyDlg = document.createElement('dialog');
        decoyDlg.setAttribute('open', '');
        decoyDlg.appendChild(decoy);
        document.body.appendChild(decoyDlg);

        const content = document.createElement('div');
        content.textContent = 'payload';

        const realDlg = document.createElement('dialog');
        realDlg.setAttribute('open', '');
        const hostWrap = document.createElement('div');
        hostWrap.className = 'nd-root';
        // host may still set id (adapter); decoy already has same id
        hostWrap.id = 'nai-dbgen-root';
        hostWrap.appendChild(content);
        realDlg.appendChild(hostWrap);

        const host = {
            openModal: async () => {
                document.body.appendChild(realDlg);
            },
        };

        const handle = await openModal({ host }, {
            title: 'X',
            element: content,
        });

        // If we wrongly used getElementById, we'd get decoyDlg
        assert.equal(content.closest('dialog'), realDlg);

        let closed = null;
        realDlg.querySelector = () => null;
        const origClose = realDlg.close;
        realDlg.close = () => {
            closed = realDlg;
            if (typeof origClose === 'function') origClose.call(realDlg);
        };

        handle.destroy();
        assert.equal(closed, realDlg);
    });

    it('source has no getElementById call for nai-dbgen-root', () => {
        const src = readFileSync(join(here, '../../src/ui/common/modal.js'), 'utf8');
        // strip block comments then assert
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        assert.equal(/getElementById\s*\(\s*['"]nai-dbgen-root['"]\s*\)/.test(code), false);
        assert.equal(/\.id\s*=\s*['"]nai-dbgen-root['"]/.test(code), false);
    });
});
