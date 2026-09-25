import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { installFakeDom } from './fake-dom.js';
import {
    mountNestedList,
    paintNestedChildTexts,
    NESTED_CHILD_ROW_HEIGHT,
} from '../../src/ui/common/nested-list.js';
import { createMiniAction } from '../../src/ui/common/controls.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(__dirname, '../../src/ui/common/components.css'), 'utf8');
const tokens = readFileSync(join(__dirname, '../../src/ui/common/tokens.css'), 'utf8');
const nestedSrc = readFileSync(join(__dirname, '../../src/ui/common/nested-list.js'), 'utf8');
const tagPanelSrc = readFileSync(join(__dirname, '../../src/ui/panels/tag/tag-panel.js'), 'utf8');
const charPanelSrc = readFileSync(
    join(__dirname, '../../src/ui/panels/character/character-panel.js'),
    'utf8',
);

/**
 * @param {object} root
 * @param {string} className
 * @returns {object|null}
 */
function findByClass(root, className) {
    if (!root) return null;
    if (String(root.className || '').split(/\s+/).includes(className)) return root;
    for (const child of root.childNodes || []) {
        const hit = findByClass(child, className);
        if (hit) return hit;
    }
    return null;
}

/**
 * @param {object} root
 * @param {string} className
 * @returns {object[]}
 */
function findAllByClass(root, className) {
    /** @type {object[]} */
    const out = [];
    if (!root) return out;
    if (String(root.className || '').split(/\s+/).includes(className)) out.push(root);
    for (const child of root.childNodes || []) {
        out.push(...findAllByClass(child, className));
    }
    return out;
}

/**
 * 截取 remountList 内嵌套列表渲染段（避免误伤表单里的 danger 按钮）。
 * @param {string} src
 * @returns {string}
 */
function nestedListMountSlice(src) {
    const start = src.indexOf('function remountList');
    assert.ok(start >= 0);
    const end = src.indexOf('async function refresh', start);
    assert.ok(end > start);
    return src.slice(start, end);
}

describe('nested-list child row (two-line + actions)', () => {
    it('CSS uses fixed child height, ellipsis, and overflow hidden', () => {
        assert.match(tokens, /--nd-nested-child-h:\s*44px/);
        assert.match(
            css,
            /\.nd-nested-list__child\s*\{[^}]*height:\s*var\(--nd-nested-child-h\)/s,
        );
        assert.match(
            css,
            /\.nd-nested-list__child\s*\{[^}]*overflow:\s*hidden/s,
        );
        assert.match(
            css,
            /\.nd-nested-list__child-key[^}]*text-overflow:\s*ellipsis/s,
        );
        assert.match(
            css,
            /\.nd-nested-list__child-value[^}]*text-overflow:\s*ellipsis/s,
        );
        assert.match(
            css,
            /\.nd-nested-list__child-key[^}]*white-space:\s*nowrap/s,
        );
        assert.match(
            css,
            /\.nd-nested-list__child-value[^}]*white-space:\s*nowrap/s,
        );
        assert.match(
            css,
            /\.nd-nested-list__child\s*>\s*\.nd-row-actions\s*\{[^}]*flex-wrap:\s*nowrap/s,
        );
        assert.equal(NESTED_CHILD_ROW_HEIGHT, 44);
        assert.match(nestedSrc, /NESTED_CHILD_ROW_HEIGHT\s*=\s*44/);
    });

    it('shared nd-mini-action styles (28px bar, danger = red text only)', () => {
        assert.match(css, /\.nd-mini-action\s*\{[^}]*height:\s*28px\s*!important/s);
        assert.match(css, /\.nd-mini-action\s*\{[^}]*background:\s*#fff6fa\s*!important/s);
        assert.match(css, /\.nd-mini-action\s*\{[^}]*border-radius:\s*var\(--nd-radius-xs\)/s);
        assert.match(css, /\.nd-mini-action--danger\s*\{[^}]*color:\s*#aa455f\s*!important/s);
        assert.match(
            css,
            /\.nd-mini-action--danger:hover:not\(:disabled\)\s*\{[^}]*background:\s*#fff0f3/s,
        );
    });

    it('createMiniAction uses shared classes; danger is not solid nd-button--danger', () => {
        const { restore } = installFakeDom();
        try {
            const edit = createMiniAction({ label: '编辑' });
            const del = createMiniAction({ label: '删除', danger: true });
            assert.ok(String(edit.className).includes('nd-mini-action'));
            assert.ok(String(edit.className).includes('nd-button--ghost'));
            assert.ok(!String(edit.className).includes('nd-mini-action--danger'));
            assert.ok(!String(edit.className).includes('nd-button--danger'));
            assert.ok(String(del.className).includes('nd-mini-action'));
            assert.ok(String(del.className).includes('nd-mini-action--danger'));
            assert.ok(!String(del.className).includes('nd-button--danger'));
        } finally {
            restore();
        }
    });

    it('tag/character nest list remount uses createMiniAction; no solid danger in list', () => {
        for (const slice of [nestedListMountSlice(tagPanelSrc), nestedListMountSlice(charPanelSrc)]) {
            assert.match(slice, /createMiniAction\s*\(/);
            assert.doesNotMatch(slice, /variant:\s*['"]danger['"]/);
            assert.doesNotMatch(slice, /variant:\s*['"]text['"]/);
            assert.match(slice, /danger:\s*true/);
        }
    });

    it('paintNestedChildTexts builds two lines with full title; newlines become spaces', () => {
        const { document, restore } = installFakeDom();
        try {
            const row = document.createElement('div');
            const longKey = '场景·通过媒介：看手机/手机屏幕/远景长名称用于测行高折行';
            const rawValue = 'from outside,close-up';
            paintNestedChildTexts(row, { primary: longKey, secondary: rawValue });

            const main = findByClass(row, 'nd-nested-list__child-main');
            const keyEl = findByClass(row, 'nd-nested-list__child-key');
            const valEl = findByClass(row, 'nd-nested-list__child-value');
            assert.ok(main);
            assert.ok(keyEl);
            assert.ok(valEl);
            assert.equal(keyEl.textContent, longKey);
            assert.equal(keyEl.title, longKey);
            assert.equal(valEl.textContent, 'from outside,close-up');
            assert.equal(valEl.title, rawValue);
            assert.equal(main.childNodes.length, 2);
        } finally {
            restore();
        }
    });

    it('non-virtual and virtual modes use the same row height and two-line + actions structure', () => {
        const { document, restore } = installFakeDom();
        try {
            const parents = [{ id: 'p1', name: 'Lib', active: true }];
            const few = Array.from({ length: 3 }, (_, i) => ({
                id: `c${i}`,
                key: `k${i}`,
                value: `v${i}\nline2`,
            }));
            const many = Array.from({ length: 50 }, (_, i) => ({
                id: `c${i}`,
                key: `k${i}`,
                value: `v${i}`,
            }));

            /** @type {object[]} */
            let children = few;
            const root = document.createElement('div');
            document.body.appendChild(root);

            const list = mountNestedList(root, {
                getParents: () => parents,
                getChildren: () => children,
                isExpanded: () => true,
                renderChild: (child, row) => {
                    paintNestedChildTexts(row, {
                        primary: String(child.key ?? ''),
                        secondary: String(child.value ?? ''),
                    });
                    const actions = document.createElement('div');
                    actions.className = 'nd-row-actions';
                    actions.append(
                        createMiniAction({ label: '编辑' }),
                        createMiniAction({ label: '删除', danger: true }),
                    );
                    row.appendChild(actions);
                },
                virtualizeChildren: true,
                virtualThreshold: 48,
                childRowHeight: NESTED_CHILD_ROW_HEIGHT,
            });

            const childRows = findAllByClass(root, 'nd-nested-list__child');
            assert.equal(childRows.length, 3);
            for (const row of childRows) {
                assert.equal(row.style.height, `${NESTED_CHILD_ROW_HEIGHT}px`);
                assert.equal(row.style.overflow, 'hidden');
                assert.ok(findByClass(row, 'nd-nested-list__child-main'));
                assert.ok(findByClass(row, 'nd-nested-list__child-key'));
                assert.ok(findByClass(row, 'nd-nested-list__child-value'));
                const actions = findByClass(row, 'nd-row-actions');
                assert.ok(actions);
                const btns = findAllByClass(actions, 'nd-mini-action');
                assert.equal(btns.length, 2);
                assert.ok(String(btns[1].className).includes('nd-mini-action--danger'));
                assert.equal(findAllByClass(actions, 'nd-button--danger').length, 0);
            }

            children = many;
            list.refresh();
            const virtualHost = findByClass(root, 'nd-nested-list__virtual');
            assert.ok(virtualHost);
            const virtualRows = findAllByClass(root, 'nd-nested-list__child');
            assert.ok(virtualRows.length > 0);
            for (const row of virtualRows) {
                assert.equal(row.style.height, `${NESTED_CHILD_ROW_HEIGHT}px`);
                assert.ok(findByClass(row, 'nd-nested-list__child-main'));
                assert.ok(findByClass(row, 'nd-row-actions'));
                assert.equal(findAllByClass(row, 'nd-button--danger').length, 0);
            }

            list.destroy();
        } finally {
            restore();
        }
    });
});
