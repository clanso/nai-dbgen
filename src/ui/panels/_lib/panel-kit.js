/**
 * 面板共享装配（DOM + Result 解包 + 确认框 + 导入弹层）。
 * 仅被 panels/ drawer 使用；不改冻结签名。
 */

import { createButton, createInlineError, createEmptyState } from '../../common/controls.js';
import { openModal } from '../../common/modal.js';
import { mountImportExport } from '../../common/import-export.js';
import { mergePluginSettings } from '../../../domain/model/plugin-settings.js';
import { newId } from '../../../infra/id.js';
import { nowIso } from '../../../infra/clock.js';
import { prepareImportCommit, pickAllowedSettingsPatch } from './library-logic.js';

/**
 * @param {string} tag
 * @param {string} [className]
 * @returns {HTMLElement}
 */
export function el(tag, className) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
}

/**
 * @param {HTMLElement} node
 * @param {string} text
 */
export function setText(node, text) {
    node.textContent = text == null ? '' : String(text);
}

/**
 * @param {{ ok: boolean, value?: unknown, error?: { message?: string } }} result
 * @returns {unknown}
 */
export function unwrapOrThrow(result) {
    if (result && result.ok) return result.value;
    const msg = result?.error?.message != null
        ? String(result.error.message)
        : '操作失败';
    throw new Error(msg);
}

/**
 * @param {object} [host]
 * @param {'info'|'success'|'warning'|'error'} level
 * @param {string} message
 */
export function toast(host, level, message) {
    if (host && typeof host.toast === 'function') {
        host.toast(level, message);
    }
}

/**
 * @param {object} deps
 * @param {() => object} [deps.loadSettings]
 * @param {(s: object) => void} [deps.saveSettings]
 * @param {object} [deps.host]
 * @returns {{ load: () => object, save: (s: object) => void, patch: (partial: object) => object }}
 */
export function settingsApi(deps) {
    const load = () => {
        if (typeof deps?.loadSettings === 'function') return deps.loadSettings();
        if (deps?.host && typeof deps.host.loadSettings === 'function') {
            return deps.host.loadSettings();
        }
        return {};
    };
    const save = (s) => {
        if (typeof deps?.saveSettings === 'function') {
            deps.saveSettings(s);
            return;
        }
        if (deps?.host && typeof deps.host.saveSettings === 'function') {
            deps.host.saveSettings(s);
        }
    };
    return {
        load,
        save,
        patch(partial) {
            const allowed = pickAllowedSettingsPatch(partial);
            const next = mergePluginSettings(load(), /** @type {any} */ (allowed));
            save(next);
            return next;
        },
    };
}

/**
 * @param {object} deps
 * @returns {{ id: (prefix?: string) => string, now: () => string }}
 */
export function idNow(deps) {
    return {
        id: (prefix) => (typeof deps?.newId === 'function' ? deps.newId(prefix) : newId(prefix)),
        now: () => (typeof deps?.nowIso === 'function' ? deps.nowIso() : nowIso()),
    };
}

/**
 * 删除二次确认。
 * @param {object} deps
 * @param {object} [deps.host]
 * @param {string} message
 * @returns {Promise<boolean>}
 */
export async function confirmDanger(deps, message) {
    const host = deps?.host;
    const body = el('div', 'nd-confirm');
    const p = el('p');
    setText(p, message);
    const actions = el('div', 'nd-confirm__actions');
    let resolved = false;
    /** @type {(v: boolean) => void} */
    let settle = () => {};
    const done = new Promise((resolve) => {
        settle = (v) => {
            if (resolved) return;
            resolved = true;
            resolve(v);
        };
    });

    const cancel = createButton({
        label: '取消',
        variant: 'ghost',
        onClick: () => settle(false),
    });
    const ok = createButton({
        label: '确认删除',
        variant: 'danger',
        onClick: () => settle(true),
    });
    actions.append(cancel, ok);
    body.append(p, actions);

    /** @type {{ destroy: () => void }|null} */
    let modal = null;
    try {
        modal = await openModal(
            { host },
            { title: '确认删除', element: body },
        );
        const result = await Promise.race([
            done,
            new Promise((resolve) => {
                // 若宿主关掉弹窗且未点按钮，视为取消
                setTimeout(() => resolve(false), 120000);
            }),
        ]);
        return Boolean(result);
    } finally {
        modal?.destroy();
    }
}

/**
 * 打开导入导出弹层；import 前必经 prepareImportCommit。
 * @param {object} deps
 * @param {object} [deps.host]
 * @param {string} title
 * @param {string} expectedKind
 * @param {(data: object, strategy: string) => Promise<object>} importJson
 * @param {() => Promise<object>} exportJson
 * @param {() => void} [onDone]
 * @returns {Promise<{ destroy: () => void }>}
 */
export async function openImportExportModal(deps, title, expectedKind, importJson, exportJson, onDone) {
    const root = el('div', 'nd-import-modal');
    const err = createInlineError();
    root.appendChild(err.el);

    const handle = mountImportExport(root, {
        exportJson,
        async importJson(data, strategy) {
            const prepared = prepareImportCommit(data, expectedKind);
            if (!prepared.ok) {
                err.setMessage(prepared.error);
                throw new Error(prepared.error);
            }
            try {
                const result = await importJson(prepared.value.data, strategy);
                err.clear();
                if (typeof onDone === 'function') onDone();
                toast(deps?.host, 'success', '导入完成');
                return result;
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                err.setMessage(msg);
                throw e;
            }
        },
    });

    const modal = await openModal(
        { host: deps?.host },
        {
            title,
            element: root,
            wide: true,
            allowVerticalScrolling: true,
        },
    );

    return {
        destroy() {
            handle.destroy();
            err.destroy();
            modal.destroy();
        },
    };
}

/**
 * 编辑表单弹层：挂 body，返回 { destroy, body }。
 * @param {object} deps
 * @param {string} title
 * @param {HTMLElement} formEl
 * @returns {Promise<{ destroy: () => void, setError: (msg: string) => void }>}
 */
export async function openFormModal(deps, title, formEl) {
    const wrap = el('div', 'nd-form-modal');
    const err = createInlineError();
    wrap.append(err.el, formEl);
    const modal = await openModal(
        { host: deps?.host },
        {
            title,
            element: wrap,
            wide: true,
            allowVerticalScrolling: true,
        },
    );
    return {
        destroy() {
            err.destroy();
            modal.destroy();
        },
        setError(msg) {
            err.setMessage(msg);
        },
    };
}

/**
 * @param {HTMLElement} host
 * @param {string} title
 * @param {string} [description]
 */
export function paintEmpty(host, title, description) {
    host.replaceChildren();
    const empty = createEmptyState({ title, description });
    host.appendChild(empty.el);
}

/**
 * Result 仓储调用 → 失败 toast。
 * @param {object} [host]
 * @param {Promise<{ ok: boolean, value?: any, error?: { message?: string } }>} promise
 * @param {string} [fallback]
 * @returns {Promise<any|null>}
 */
export async function awaitRepo(host, promise, fallback = '操作失败') {
    try {
        const r = await promise;
        if (r && r.ok) return r.value;
        const msg = r?.error?.message != null ? String(r.error.message) : fallback;
        toast(host, 'error', msg);
        return null;
    } catch (e) {
        toast(host, 'error', e instanceof Error ? e.message : String(e));
        return null;
    }
}

/**
 * @param {string} label
 * @param {string} [value]
 * @param {number} [rows]
 * @returns {{ el: HTMLElement, getValue: () => string, setValue: (v: string) => void, destroy: () => void }}
 */
export function labeledTextarea(label, value = '', rows = 4) {
    const root = el('label', 'nd-field');
    const title = el('span', 'nd-field__label');
    setText(title, label);
    const ta = /** @type {HTMLTextAreaElement} */ (el('textarea', 'nd-textarea'));
    ta.rows = rows;
    ta.value = value == null ? '' : String(value);
    root.append(title, ta);
    return {
        el: root,
        getValue: () => ta.value,
        setValue: (v) => {
            ta.value = v == null ? '' : String(v);
        },
        destroy: () => {
            root.remove();
        },
    };
}
