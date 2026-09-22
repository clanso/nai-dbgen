/**
 * L5 UI · 角色库（组 → 角色） 管理面板。
 * 归属：W2-H 面板代理实现。W0 仅冻结签名。
 */

import { createLibraryToolbar } from '../../common/library-chrome.js';
import { createButton, createField, createToggle, createCheckbox, createFieldGroup, createInlineError } from '../../common/controls.js';
import { mountNestedList } from '../../common/nested-list.js';
import { createStore } from '../../common/store.js';
import {
    createCharacter,
    createCharacterGroup,
    normalizeKeywords,
} from '../../../domain/model/character.js';
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
export function mountCharacterPanel(root, deps) {
    if (!(root instanceof Element)) {
        throw new Error('mountCharacterPanel: root must be an Element');
    }
    const repo = deps?.repos?.character;
    if (!repo) throw new Error('mountCharacterPanel: deps.repos.character required');

    const host = deps.host;
    const ids = idNow(deps);
    const store = createStore({
        query: '',
        activeOnly: false,
        groups: /** @type {object[]} */ ([]),
        /** @type {Map<string, object[]>} */
        byGroup: new Map(),
    });

    const shell = el('div', 'nd-panel nd-panel--character');
    const toolbar = createLibraryToolbar({
        searchPlaceholder: '搜索组或角色',
        onSearch: (q) => store.set((s) => ({ ...s, query: q })),
        onCreate: () => void openGroupEditor(null),
        onImport: () => void openImport(),
        onExport: () => void doExport(),
        extra: (() => {
            const wrap = el('label', 'nd-checkbox-row');
            const input = document.createElement('input');
            input.type = 'checkbox';
            const text = el('span');
            setText(text, '仅看已激活组');
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
        return filterNestedLibrary(s.groups, s.byGroup, {
            query: s.query,
            activeOnly: s.activeOnly,
            parentSearchKeys: ['name'],
            childSearchKeys: ['name', 'keywords', 'fixedFeatures'],
        });
    }

    function remountList() {
        nested?.destroy();
        nested = mountNestedList(listHost, {
            getParents: () => visible().parents,
            getChildren: (parent) => visible().childrenByParentId.get(String(parent.id)) || [],
            isParentEnabled: (p) => p.active !== false,
            onParentEnabledChange: (parent, enabled) => void toggleGroup(parent, enabled),
            renderParentMeta: (parent, metaEl) => {
                const add = createButton({
                    label: '＋角色',
                    variant: 'ghost',
                    onClick: () => void openCharacterEditor(null, String(parent.id)),
                });
                const edit = createButton({
                    label: '编辑组',
                    variant: 'text',
                    onClick: () => void openGroupEditor(parent),
                });
                const del = createButton({
                    label: '删除组',
                    variant: 'danger',
                    onClick: () => void removeGroup(parent),
                });
                metaEl.append(add, edit, del);
            },
            renderChild: (child, row) => {
                const name = el('strong');
                setText(name, String(child.name ?? ''));
                const kw = el('span', 'nd-muted');
                setText(kw, (child.keywords || []).join(', '));
                const actions = el('div', 'nd-row-actions');
                actions.append(
                    createButton({
                        label: '编辑',
                        variant: 'text',
                        onClick: () => void openCharacterEditor(child, String(child.groupId)),
                    }),
                    createButton({
                        label: '删除',
                        variant: 'danger',
                        onClick: () => void removeCharacter(child),
                    }),
                );
                row.append(name, kw, actions);
            },
            virtualizeChildren: true,
            virtualThreshold: 48,
        });
    }

    async function refresh() {
        if (destroyed) return;
        const groups = await awaitRepo(host, repo.listGroups(), '读取角色组失败');
        if (!groups) return;
        /** @type {Map<string, object[]>} */
        const byGroup = new Map();
        for (const g of groups) {
            const chars = await awaitRepo(host, repo.listByGroup(g.id), '读取角色失败') || [];
            byGroup.set(String(g.id), chars);
        }
        store.set((s) => ({ ...s, groups, byGroup }));
        remountList();
    }

    async function toggleGroup(group, enabled) {
        const next = applyFormFields(group, {
            active: Boolean(enabled),
            updatedAt: ids.now(),
        });
        const saved = await awaitRepo(host, repo.putGroup(next), '保存组失败');
        if (saved) await refresh();
    }

    async function removeGroup(group) {
        const ok = await confirmDanger(deps, `删除组「${group.name}」及其全部角色？此操作不可撤销。`);
        if (!ok) return;
        await awaitRepo(host, repo.removeGroup(group.id), '删除组失败');
        await refresh();
    }

    async function removeCharacter(ch) {
        const ok = await confirmDanger(deps, `删除角色「${ch.name}」？`);
        if (!ok) return;
        await awaitRepo(host, repo.remove(ch.id), '删除角色失败');
        await refresh();
    }

    /**
     * @param {object|null} group
     */
    async function openGroupEditor(group) {
        const nameField = createField({
            label: '组名称',
            value: group?.name ?? '',
        });
        const activeToggle = createToggle({
            label: '激活（未激活组不参与关键字计算）',
            checked: group ? group.active !== false : true,
        });
        const form = el('div', 'nd-form');
        form.append(nameField.el, activeToggle.el);
        const actions = el('div', 'nd-form__actions');
        const modal = await openFormModal(deps, group ? '编辑角色组' : '新建角色组', form);

        const saveBtn = createButton({
            label: '保存',
            variant: 'primary',
            onClick: async () => {
                const name = nameField.getValue().trim();
                if (!name) {
                    modal.setError('请填写组名称');
                    return;
                }
                const entity = group
                    ? applyFormFields(group, {
                        name,
                        active: activeToggle.getValue(),
                        updatedAt: ids.now(),
                    })
                    : createCharacterGroup(
                        { name, active: activeToggle.getValue() },
                        { id: ids.id('cg'), now: ids.now() },
                    );
                const saved = await awaitRepo(host, repo.putGroup(entity), '保存失败');
                if (saved) {
                    modal.destroy();
                    toast(host, 'success', '已保存');
                    await refresh();
                }
            },
        });
        actions.append(
            createButton({ label: '取消', variant: 'ghost', onClick: () => modal.destroy() }),
            saveBtn,
        );
        form.appendChild(actions);
    }

    /**
     * @param {object|null} character
     * @param {string} groupId
     */
    async function openCharacterEditor(character, groupId) {
        const nameField = createField({ label: '名称（注入标题，不参与匹配）', value: character?.name ?? '' });
        const kwField = createField({
            label: '关键字（英文逗号分隔；/regex/flags 整段保留）',
            value: Array.isArray(character?.keywords)
                ? character.keywords.join(', ')
                : '',
        });
        const dna = labeledTextarea('固定特征（DNA）', character?.fixedFeatures ?? '', 5);
        /** @type {object[]} */
        let varFeatures = Array.isArray(character?.variableFeatures)
            ? character.variableFeatures.map((v) => ({ ...v }))
            : [];

        const varHost = el('div', 'nd-var-features');
        const varTitle = el('h4', 'nd-field-group__title');
        setText(varTitle, '非固定特征');
        /** @type {{ name: ReturnType<typeof createField>, prompt: ReturnType<typeof labeledTextarea> }[]} */
        let varControls = [];

        function paintVars() {
            varHost.replaceChildren(varTitle);
            varControls = [];
            varFeatures.forEach((feat, index) => {
                const row = el('div', 'nd-var-feature');
                const n = createField({
                    label: '条目名',
                    value: feat.name != null ? String(feat.name) : '',
                });
                const p = labeledTextarea(
                    '提示词',
                    feat.prompt != null ? String(feat.prompt) : '',
                    2,
                );
                varControls.push({ name: n, prompt: p });
                row.append(n.el, p.el);
                row.appendChild(createButton({
                    label: '移除',
                    variant: 'danger',
                    onClick: () => {
                        varFeatures = readVars().filter((_, i) => i !== index);
                        paintVars();
                    },
                }));
                varHost.appendChild(row);
            });
            varHost.appendChild(createButton({
                label: '＋非固定特征',
                variant: 'ghost',
                onClick: () => {
                    varFeatures = [...readVars(), { name: '', prompt: '' }];
                    paintVars();
                },
            }));
        }

        function readVars() {
            return varControls.map((c, i) => applyFormFields(varFeatures[i] || {}, {
                name: c.name.getValue(),
                prompt: c.prompt.getValue(),
            }));
        }
        paintVars();

        const overrideCase = createCheckbox({
            label: '覆盖：区分大小写',
            checked: character?.matchOverrides?.caseSensitive === true,
        });
        const overrideWhole = createCheckbox({
            label: '覆盖：全词匹配',
            checked: character?.matchOverrides?.matchWholeWords === true,
        });
        const useOverride = createCheckbox({
            label: '为本角色单独覆盖匹配规则',
            checked: Boolean(character?.matchOverrides),
        });

        const form = el('div', 'nd-form');
        const group = createFieldGroup({
            title: '基本信息',
            children: [nameField.el, kwField.el, dna.el],
        });
        form.append(group.el, varHost, useOverride.el, overrideCase.el, overrideWhole.el);

        const modal = await openFormModal(deps, character ? '编辑角色' : '新建角色', form);
        const actions = el('div', 'nd-form__actions');
        actions.append(
            createButton({ label: '取消', variant: 'ghost', onClick: () => modal.destroy() }),
            createButton({
                label: '保存',
                variant: 'primary',
                onClick: async () => {
                    const name = nameField.getValue().trim();
                    if (!name) {
                        modal.setError('请填写角色名称');
                        return;
                    }
                    varFeatures = readVars();
                    /** @type {object|null} */
                    let matchOverrides = null;
                    if (useOverride.getValue()) {
                        matchOverrides = applyFormFields(character?.matchOverrides || {}, {
                            caseSensitive: overrideCase.getValue(),
                            matchWholeWords: overrideWhole.getValue(),
                        });
                    }
                    const entity = character
                        ? applyFormFields(character, {
                            name,
                            keywords: normalizeKeywords(kwField.getValue()),
                            fixedFeatures: dna.getValue(),
                            variableFeatures: varFeatures,
                            matchOverrides,
                            updatedAt: ids.now(),
                        })
                        : createCharacter(
                            {
                                groupId,
                                name,
                                keywords: kwField.getValue(),
                                fixedFeatures: dna.getValue(),
                                variableFeatures: varFeatures,
                                matchOverrides,
                            },
                            { id: ids.id('ch'), now: ids.now() },
                        );
                    const saved = await awaitRepo(host, repo.put(entity), '保存角色失败');
                    if (saved) {
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
            '导入角色库',
            'character',
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

    async function doExport() {
        await openImport();
    }

    if (typeof repo.onChanged === 'function') {
        cleanups.push(repo.onChanged(() => {
            void refresh();
        }));
    }

    const unsub = store.subscribe(() => {
        if (!destroyed) remountList();
    });
    cleanups.push(unsub);

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
