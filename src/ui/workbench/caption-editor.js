/**
 * L5 UI · NaiCaption 结构化编辑器（D13）。
 * base 文本域 + 角色可增删列表；读写结构，绝不拍平再解析。
 */

import {
    createButton,
    createNumberField,
} from '../common/controls.js';
import {
    WORKBENCH_MAX_CHARACTERS,
    captionToEditorState,
    editorStateToCaption,
    emptyCharacterRow,
    cloneCaption,
} from './workbench-logic.js';
import { emptyNaiCaption } from '../../domain/model/nai-params.js';

/**
 * @param {string} tag
 * @param {string} [className]
 * @returns {HTMLElement}
 */
function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
}

/**
 * @param {HTMLElement} node
 * @param {string} text
 */
function setText(node, text) {
    node.textContent = text == null ? '' : String(text);
}

/**
 * @param {object} opts
 * @param {string} opts.label
 * @param {string} [opts.value]
 * @param {number} [opts.rows]
 * @param {(v: string) => void} [opts.onChange]
 * @returns {{ el: HTMLElement, getValue: () => string, setValue: (v: string) => void, destroy: () => void }}
 */
function createTextarea(opts) {
    const root = el('label', 'nd-field');
    const labelEl = el('span', 'nd-field__label');
    setText(labelEl, opts?.label != null ? String(opts.label) : '');
    /** @type {HTMLTextAreaElement} */
    const ta = /** @type {HTMLTextAreaElement} */ (el('textarea', 'nd-textarea'));
    ta.rows = opts?.rows != null ? Number(opts.rows) : 4;
    ta.value = opts?.value != null ? String(opts.value) : '';
    const onChange = typeof opts?.onChange === 'function' ? opts.onChange : () => {};
    const handler = () => onChange(ta.value);
    ta.addEventListener('input', handler);
    root.append(labelEl, ta);
    return {
        el: root,
        getValue: () => ta.value,
        setValue: (v) => {
            ta.value = v == null ? '' : String(v);
        },
        destroy: () => {
            ta.removeEventListener('input', handler);
            root.remove();
        },
    };
}

/**
 * @param {Element} root
 * @param {object} [opts]
 * @param {import('../../domain/model/nai-params.js').NaiCaption} [opts.initial]
 * @returns {{
 *   el: HTMLElement,
 *   getCaption: () => import('../../domain/model/nai-params.js').NaiCaption,
 *   setCaption: (c: unknown) => void,
 *   destroy: () => void,
 * }}
 */
export function mountCaptionEditor(root, opts) {
    const shell = el('div', 'nd-wb-caption');
    const initial = captionToEditorState(opts?.initial ?? emptyNaiCaption());

    const posBase = createTextarea({
        label: '场景 · 正面',
        value: initial.posBase,
        rows: 5,
    });
    const negBase = createTextarea({
        label: '场景 · 负面',
        value: initial.negBase,
        rows: 4,
    });

    const charsHead = el('div', 'nd-wb-caption__chars-head');
    const charsTitle = el('h4', 'nd-field-group__title');
    setText(charsTitle, '角色');
    const charsList = el('div', 'nd-wb-caption__chars');
    charsHead.appendChild(charsTitle);

    /** @type {Array<{
     *   root: HTMLElement,
     *   positive: ReturnType<typeof createTextarea>,
     *   negative: ReturnType<typeof createTextarea>,
     *   x: ReturnType<typeof createNumberField>,
     *   y: ReturnType<typeof createNumberField>,
     * }>} */
    const rows = [];

    /**
     * @param {{ positive: string, negative: string, x: number, y: number }} data
     */
    function addRow(data) {
        if (rows.length >= WORKBENCH_MAX_CHARACTERS) return;
        const card = el('div', 'nd-wb-caption__char');
        const head = el('div', 'nd-wb-caption__char-head');
        const label = el('strong');
        setText(label, `角色 ${rows.length + 1}`);
        const positive = createTextarea({
            label: '正面',
            value: data.positive,
            rows: 3,
        });
        const negative = createTextarea({
            label: '负面',
            value: data.negative,
            rows: 2,
        });
        const x = createNumberField({
            label: '位置 X',
            value: data.x,
            min: 0,
            max: 1,
            step: 0.01,
        });
        const y = createNumberField({
            label: '位置 Y',
            value: data.y,
            min: 0,
            max: 1,
            step: 0.01,
        });
        const removeBtn = createButton({
            label: '删除',
            variant: 'ghost',
            onClick: () => {
                const idx = rows.findIndex((r) => r.root === card);
                if (idx < 0) return;
                const [removed] = rows.splice(idx, 1);
                removed.positive.destroy();
                removed.negative.destroy();
                removed.x.destroy();
                removed.y.destroy();
                removed.root.remove();
                relabel();
                syncAddEnabled();
            },
        });
        head.append(label, removeBtn);
        const coords = el('div', 'nd-wb-caption__coords');
        coords.append(x.el, y.el);
        card.append(head, positive.el, negative.el, coords);
        charsList.appendChild(card);
        rows.push({ root: card, positive, negative, x, y });
        relabel();
        syncAddEnabled();
    }

    function relabel() {
        rows.forEach((row, i) => {
            const strong = row.root.childNodes[0]?.childNodes?.[0];
            if (strong) setText(/** @type {HTMLElement} */ (strong), `角色 ${i + 1}`);
        });
    }

    const addBtn = createButton({
        label: '＋添加角色',
        variant: 'ghost',
        onClick: () => addRow(emptyCharacterRow()),
    });

    function syncAddEnabled() {
        addBtn.disabled = rows.length >= WORKBENCH_MAX_CHARACTERS;
    }

    charsHead.appendChild(addBtn);

    for (const row of initial.characters) {
        addRow(row);
    }

    shell.append(posBase.el, negBase.el, charsHead, charsList);
    root.appendChild(shell);

    function readState() {
        return {
            posBase: posBase.getValue(),
            negBase: negBase.getValue(),
            characters: rows.map((r) => ({
                positive: r.positive.getValue(),
                negative: r.negative.getValue(),
                x: r.x.getValue(),
                y: r.y.getValue(),
            })),
        };
    }

    /**
     * @param {unknown} caption
     */
    function setCaption(caption) {
        const state = captionToEditorState(caption);
        posBase.setValue(state.posBase);
        negBase.setValue(state.negBase);
        while (rows.length) {
            const removed = rows.pop();
            if (!removed) break;
            removed.positive.destroy();
            removed.negative.destroy();
            removed.x.destroy();
            removed.y.destroy();
            removed.root.remove();
        }
        for (const row of state.characters) {
            addRow(row);
        }
        syncAddEnabled();
    }

    let destroyed = false;
    return {
        el: shell,
        getCaption: () => cloneCaption(editorStateToCaption(readState())),
        setCaption,
        destroy() {
            if (destroyed) return;
            destroyed = true;
            posBase.destroy();
            negBase.destroy();
            while (rows.length) {
                const removed = rows.pop();
                if (!removed) break;
                removed.positive.destroy();
                removed.negative.destroy();
                removed.x.destroy();
                removed.y.destroy();
                removed.root.remove();
            }
            shell.remove();
        },
    };
}
