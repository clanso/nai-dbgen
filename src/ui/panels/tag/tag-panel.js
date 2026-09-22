/**
 * L5 UI · 标签库（多库 → 条目） 管理面板。
 * 归属：W2-H 面板代理实现。W0 仅冻结签名。
 * 与角色库共用 mountNestedList（D7）。
 */

import { createLibraryToolbar } from '../../common/library-chrome.js';
import { createButton, createField, createToggle, createInlineError } from '../../common/controls.js';
import { mountNestedList } from '../../common/nested-list.js';
import { createStore } from '../../common/store.js';
import { createTagLibrary, createTagEntry } from '../../../domain/model/tag.js';
import { filterNestedLibrary, applyFormFields } from '../_lib/library-logic.js';
import {
    el,
    setText,
    labeledTextarea,
    idNow,
    confirmDanger,
    openImportExportModal,
    openFormModal,
    awaitRepo,
    toast,
} from '../_lib/panel-kit.js';

/**
 * @param {Element} root
 * @param {object} deps repos / services / host / bus
 * @returns {{ destroy: () => void }}
 */
export function mountTagPanel(root, deps) {
    if (!(root instanceof Element)) {
        throw new Error('mountTagPanel: root must be an Element');
    }
    const repo = deps?.repos?.tag;
    if (!repo) throw new Error('mountTagPanel: deps.repos.tag required');

    const host = deps.host;
    const ids = idNow(deps);
    const store = createStore({
        query: '',
        activeOnly: false,
        libraries: /** @type {object[]} */ ([]),
        /** @type {Map<string, object[]>} */
        byLib: new Map(),
    });

    const shell = el('div', 'nd-panel nd-panel--tag');
    const toolbar = createLibraryToolbar({
        searchPlaceholder: '搜索库或 key / value',
        onSearch: (q) => store.set((s) => ({ ...s, query: q })),
        onCreate: () => void openLibraryEditor(null),
        onImport: () => void openImport(),
        onExport: () => void openImport(),
        extra: (() => {
            const wrap = el('label', 'nd-checkbox-row');
            const input = document.createElement('input');
            input.type = 'checkbox';
            const text = el('span');
            setText(text, '仅看已激活库');
            input.addEventListener('change', () => {
                store.set((s) => ({ ...s, activeOnly: input.checked }));
            });
            wrap.append(input, text);
            return [wrap];
        })(),
    });
    const listHost = el('div', 'nd-panel__list');
    const err = createInlineError();
    shell.append(toolbar.el, err.el, listHost);
    root.appendChild(shell);

    /** @type {{ destroy: () => void, refresh: () => void }|null} */
    let nested = null;
    /** @type {(() => void)[]} */
    const cleanups = [];
    let destroyed = false;

    function visible() {
        const s = store.get();
        return filterNestedLibrary(s.libraries, s.byLib, {
            query: s.query,
            activeOnly: s.activeOnly,
            parentSearchKeys: ['name'],
            childSearchKeys: ['key', 'value'],
        });
    }

    function remountList() {
        nested?.destroy();
        nested = mountNestedList(listHost, {
            getParents: () => visible().parents,
            getChildren: (parent) => visible().childrenByParentId.get(String(parent.id)) || [],
            isParentEnabled: (p) => p.active !== false,
            onParentEnabledChange: (parent, enabled) => void toggleLibrary(parent, enabled),
            renderParentMeta: (parent, metaEl) => {
                metaEl.append(
                    createButton({
                        label: '＋条目',
                        variant: 'ghost',
                        onClick: () => void openEntryEditor(null, String(parent.id)),
                    }),
                    createButton({
                        label: '编辑库',
                        variant: 'text',
                        onClick: () => void openLibraryEditor(parent),
                    }),
                    createButton({
                        label: '删除库',
                        variant: 'danger',
                        onClick: () => void removeLibrary(parent),
                    }),
                );
            },
            renderChild: (child, row) => {
                const key = el('strong');
                setText(key, String(child.key ?? ''));
                const val = el('span', 'nd-muted');
                const preview = String(child.value ?? '');
                setText(val, preview.length > 80 ? `${preview.slice(0, 80)}…` : preview);
                const actions = el('div', 'nd-row-actions');
                actions.append(
                    createButton({
                        label: '编辑',
                        variant: 'text',
                        onClick: () => void openEntryEditor(child, String(child.libraryId)),
                    }),
                    createButton({
                        label: '删除',
                        variant: 'danger',
                        onClick: () => void removeEntry(child),
                    }),
                );
                row.append(key, val, actions);
            },
            virtualizeChildren: true,
            virtualThreshold: 48,
            childRowHeight: 40,
            virtualListHeight: 320,
        });
    }

    async function refresh() {
        if (destroyed) return;
        const libraries = await awaitRepo(host, repo.listLibraries(), '读取标签库失败');
        if (!libraries) return;
        /** @type {Map<string, object[]>} */
        const byLib = new Map();
        for (const lib of libraries) {
            const entries = await awaitRepo(host, repo.listEntries(lib.id), '读取条目失败') || [];
            byLib.set(String(lib.id), entries);
        }
        store.set((s) => ({ ...s, libraries, byLib }));
        remountList();
    }

    async function toggleLibrary(lib, enabled) {
        const next = applyFormFields(lib, {
            active: Boolean(enabled),
            updatedAt: ids.now(),
        });
        if (await awaitRepo(host, repo.putLibrary(next), '保存失败')) await refresh();
    }

    async function removeLibrary(lib) {
        const ok = await confirmDanger(deps, `删除标签库「${lib.name}」及全部条目？`);
        if (!ok) return;
        await awaitRepo(host, repo.removeLibrary(lib.id), '删除失败');
        await refresh();
    }

    async function removeEntry(entry) {
        const ok = await confirmDanger(deps, `删除条目「${entry.key}」？`);
        if (!ok) return;
        await awaitRepo(host, repo.remove(entry.id), '删除失败');
        await refresh();
    }

    /**
     * @param {object|null} lib
     */
    async function openLibraryEditor(lib) {
        const nameField = createField({ label: '库名称', value: lib?.name ?? '' });
        const activeToggle = createToggle({
            label: '激活（未激活库的 key 不进入召回）',
            checked: lib ? lib.active !== false : true,
        });
        const form = el('div', 'nd-form');
        form.append(nameField.el, activeToggle.el);
        const modal = await openFormModal(deps, lib ? '编辑标签库' : '新建标签库', form);
        const actions = el('div', 'nd-form__actions');
        actions.append(
            createButton({ label: '取消', variant: 'ghost', onClick: () => modal.destroy() }),
            createButton({
                label: '保存',
                variant: 'primary',
                onClick: async () => {
                    const name = nameField.getValue().trim();
                    if (!name) {
                        modal.setError('请填写库名称');
                        return;
                    }
                    const entity = lib
                        ? applyFormFields(lib, {
                            name,
                            active: activeToggle.getValue(),
                            updatedAt: ids.now(),
                        })
                        : createTagLibrary(
                            { name, active: activeToggle.getValue() },
                            { id: ids.id('tl'), now: ids.now() },
                        );
                    if (await awaitRepo(host, repo.putLibrary(entity), '保存失败')) {
                        modal.destroy();
                        toast(host, 'success', '已保存');
                        await refresh();
                    }
                },
            }),
        );
        form.appendChild(actions);
    }

    /**
     * @param {object|null} entry
     * @param {string} libraryId
     */
    async function openEntryEditor(entry, libraryId) {
        const keyField = createField({ label: '召回 key（模型回文原文对账）', value: entry?.key ?? '' });
        const valueField = labeledTextarea('value（生图 tag）', entry?.value ?? '', 4);
        const form = el('div', 'nd-form');
        form.append(keyField.el, valueField.el);
        const modal = await openFormModal(deps, entry ? '编辑标签条目' : '新建标签条目', form);
        const actions = el('div', 'nd-form__actions');
        actions.append(
            createButton({ label: '取消', variant: 'ghost', onClick: () => modal.destroy() }),
            createButton({
                label: '保存',
                variant: 'primary',
                onClick: async () => {
                    const key = keyField.getValue().trim();
                    if (!key) {
                        modal.setError('请填写召回 key');
                        return;
                    }
                    const entity = entry
                        ? applyFormFields(entry, {
                            key,
                            value: valueField.getValue(),
                            updatedAt: ids.now(),
                        })
                        : createTagEntry(
                            { libraryId, key, value: valueField.getValue() },
                            { id: ids.id('te'), now: ids.now() },
                        );
                    if (await awaitRepo(host, repo.put(entity), '保存失败')) {
                        modal.destroy();
                        toast(host, 'success', '已保存');
                        await refresh();
                    }
                },
            }),
        );
        form.appendChild(actions);
    }

    async function openImport() {
        await openImportExportModal(
            deps,
            '导入标签库',
            'tag',
            async (data, strategy) => {
                const r = await repo.importJson(data, { strategy });
                if (!r.ok) throw new Error(r.error?.message || '导入失败');
                return r.value;
            },
            async () => {
                const r = await repo.exportJson();
                if (!r.ok) throw new Error(r.error?.message || '导出失败');
                return r.value;
            },
            () => void refresh(),
        );
    }

    if (typeof repo.onChanged === 'function') {
        cleanups.push(repo.onChanged(() => void refresh()));
    }
    cleanups.push(store.subscribe(() => {
        if (!destroyed) remountList();
    }));

    void refresh();

    return {
        destroy() {
            if (destroyed) return;
            destroyed = true;
            for (const fn of cleanups) fn();
            nested?.destroy();
            toolbar.destroy();
            err.destroy();
            shell.remove();
        },
    };
}
