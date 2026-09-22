/**
 * L5 UI · 生图/召回预设 管理面板。
 * 归属：W2-H 面板代理实现。W0 仅冻结签名。
 */

import { createButton, createField, createSelect, createCheckbox } from '../../common/controls.js';
import { createPreset, importFromSillyTavernPreset } from '../../../domain/model/preset.js';
import { mountLibraryView } from '../library-view.js';
import {
    el,
    setText,
    labeledTextarea,
    idNow,
    settingsApi,
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
export function mountPresetPanel(root, deps) {
    if (!(root instanceof Element)) {
        throw new Error('mountPresetPanel: root must be an Element');
    }
    const repo = deps?.repos?.preset;
    if (!repo) throw new Error('mountPresetPanel: deps.repos.preset required');

    const host = deps.host;
    const ids = idNow(deps);
    const settings = settingsApi(deps);

    const shell = el('div', 'nd-panel nd-panel--preset');
    root.appendChild(shell);

    /** @type {(() => void)[]} */
    const cleanups = [];
    let destroyed = false;

    const view = mountLibraryView(shell, {
        list: async () => {
            const items = await awaitRepo(host, repo.list(), '读取预设失败') || [];
            const s = settings.load();
            return items.map((item) => ({
                ...item,
                __active:
                    (item.kind === 'imagegen'
                        && s.activeImagegenPresetId != null
                        && String(s.activeImagegenPresetId) === String(item.id))
                    || (item.kind === 'recall'
                        && s.activeRecallPresetId != null
                        && String(s.activeRecallPresetId) === String(item.id)),
            }));
        },
        onCreate: () => void openEditor(null),
        onEdit: (item) => void openEditor(item),
        onDelete: (idList) => void removeItems(idList),
        onImport: () => void openImport(),
        onExport: () => void openImport(),
    }, {
        searchKeys: ['name', 'kind'],
        columns: [
            { key: 'name', label: '名称' },
            {
                key: 'kind',
                label: '类型',
                render: (item) => (item.kind === 'recall' ? '召回预设' : '生图预设'),
            },
            {
                key: 'prompts',
                label: '段数',
                render: (item) => `${Array.isArray(item.prompts) ? item.prompts.length : 0} 段`,
            },
        ],
    });

    /**
     * @param {string[]} idList
     */
    async function removeItems(idList) {
        const ok = await confirmDanger(deps, `删除 ${idList.length} 条预设？`);
        if (!ok) return;
        for (const id of idList) {
            const existing = await awaitRepo(host, repo.get(id));
            await awaitRepo(host, repo.remove(id), '删除失败');
            if (!existing) continue;
            if (existing.kind === 'imagegen'
                && settings.load().activeImagegenPresetId != null
                && String(settings.load().activeImagegenPresetId) === String(id)) {
                settings.patch({ activeImagegenPresetId: null });
            }
            if (existing.kind === 'recall'
                && settings.load().activeRecallPresetId != null
                && String(settings.load().activeRecallPresetId) === String(id)) {
                settings.patch({ activeRecallPresetId: null });
            }
        }
        await view.refresh();
    }

    /**
     * @param {object|null} item
     */
    async function openEditor(item) {
        const nameField = createField({ label: '名称', value: item?.name ?? '' });
        const kindSelect = createSelect({
            label: '类型',
            value: item?.kind === 'recall' ? 'recall' : 'imagegen',
            options: [
                { value: 'imagegen', label: '生图预设（引用世界书/上下文/角色库/标签库）' },
                { value: 'recall', label: '召回预设（上下文 + 候选 key）' },
            ],
        });

        /** @type {{ identifier: string, name: string, role: string, content: string, enabled: boolean }[]} */
        let prompts = Array.isArray(item?.prompts)
            ? item.prompts.map((p) => ({
                identifier: String(p.identifier ?? ''),
                name: String(p.name ?? ''),
                role: p.role === 'user' || p.role === 'assistant' ? p.role : 'system',
                content: String(p.content ?? ''),
                enabled: p.enabled !== false,
            }))
            : [{
                identifier: 'main',
                name: '主提示',
                role: 'system',
                content: '',
                enabled: true,
            }];

        const promptsHost = el('div', 'nd-preset-prompts');
        /** @type {{ name: ReturnType<typeof createField>, content: ReturnType<typeof labeledTextarea>, enabled: ReturnType<typeof createCheckbox>, role: ReturnType<typeof createSelect> }[]} */
        let promptControls = [];

        function paintPrompts() {
            promptsHost.replaceChildren();
            const title = el('h4', 'nd-field-group__title');
            setText(title, '提示词段（对齐酒馆 prompts）');
            promptsHost.appendChild(title);
            promptControls = [];
            prompts.forEach((p, index) => {
                const block = el('div', 'nd-preset-prompt');
                const name = createField({ label: '段名', value: p.name });
                const role = createSelect({
                    label: 'role',
                    value: p.role,
                    options: [
                        { value: 'system', label: 'system' },
                        { value: 'user', label: 'user' },
                        { value: 'assistant', label: 'assistant' },
                    ],
                });
                const enabled = createCheckbox({ label: '启用', checked: p.enabled !== false });
                const content = labeledTextarea('内容', p.content, 6);
                promptControls.push({ name, content, enabled, role });
                block.append(name.el, role.el, enabled.el, content.el);
                block.appendChild(createButton({
                    label: '删除段',
                    variant: 'danger',
                    onClick: () => {
                        prompts = readPrompts().filter((_, i) => i !== index);
                        if (!prompts.length) {
                            prompts = [{
                                identifier: 'main',
                                name: '主提示',
                                role: 'system',
                                content: '',
                                enabled: true,
                            }];
                        }
                        paintPrompts();
                    },
                }));
                promptsHost.appendChild(block);
            });
            promptsHost.appendChild(createButton({
                label: '＋添加段',
                variant: 'ghost',
                onClick: () => {
                    prompts = [
                        ...readPrompts(),
                        {
                            identifier: ids.id('pp'),
                            name: '新段',
                            role: 'system',
                            content: '',
                            enabled: true,
                        },
                    ];
                    paintPrompts();
                },
            }));
        }

        function readPrompts() {
            return promptControls.map((c, i) => ({
                identifier: prompts[i]?.identifier || ids.id('pp'),
                name: c.name.getValue(),
                role: c.role.getValue(),
                content: c.content.getValue(),
                enabled: c.enabled.getValue(),
                injection_position: 0,
                injection_depth: 0,
                injection_order: 100 + i,
            }));
        }
        paintPrompts();

        const stPaste = labeledTextarea('从酒馆预设 JSON 粘贴导入（可选）', '', 4);
        const form = el('div', 'nd-form');
        form.append(nameField.el, kindSelect.el, promptsHost, stPaste.el);
        const modal = await openFormModal(deps, item ? '编辑预设' : '新建预设', form);

        const actions = el('div', 'nd-form__actions');
        actions.append(
            createButton({ label: '取消', variant: 'ghost', onClick: () => modal.destroy() }),
            createButton({
                label: '解析酒馆 JSON',
                variant: 'ghost',
                onClick: () => {
                    try {
                        const raw = JSON.parse(stPaste.getValue());
                        const imported = importFromSillyTavernPreset(
                            raw,
                            { kind: kindSelect.getValue() === 'recall' ? 'recall' : 'imagegen', name: nameField.getValue() || undefined },
                            { id: ids.id('pr'), now: ids.now() },
                        );
                        if (!imported.ok) {
                            modal.setError(imported.error.message);
                            return;
                        }
                        nameField.setValue(imported.value.name);
                        kindSelect.setValue(imported.value.kind);
                        prompts = imported.value.prompts.map((p) => ({
                            identifier: p.identifier,
                            name: p.name,
                            role: p.role,
                            content: p.content,
                            enabled: p.enabled,
                        }));
                        paintPrompts();
                        toast(host, 'success', '已解析酒馆预设');
                    } catch (e) {
                        modal.setError(e instanceof Error ? e.message : String(e));
                    }
                },
            }),
            createButton({
                label: '设为当前',
                variant: 'ghost',
                onClick: async () => {
                    const saved = await save();
                    if (!saved) return;
                    if (saved.kind === 'recall') {
                        settings.patch({ activeRecallPresetId: saved.id });
                    } else {
                        settings.patch({ activeImagegenPresetId: saved.id });
                    }
                    toast(host, 'success', '已设为当前预设');
                    await view.refresh();
                },
            }),
            createButton({
                label: '保存',
                variant: 'primary',
                onClick: async () => {
                    if (await save()) {
                        modal.destroy();
                        toast(host, 'success', '已保存');
                        await view.refresh();
                    }
                },
            }),
        );
        form.appendChild(actions);

        async function save() {
            const name = nameField.getValue().trim();
            if (!name) {
                modal.setError('请填写预设名称');
                return null;
            }
            const kind = kindSelect.getValue() === 'recall' ? 'recall' : 'imagegen';
            const promptList = readPrompts();
            const entity = item
                ? {
                    ...item,
                    name,
                    kind,
                    prompts: promptList,
                    prompt_order: promptList.map((p) => ({
                        identifier: p.identifier,
                        enabled: p.enabled,
                    })),
                    updatedAt: ids.now(),
                }
                : createPreset(
                    { name, kind, prompts: promptList },
                    { id: ids.id('pr'), now: ids.now() },
                );
            return awaitRepo(host, repo.put(entity), '保存失败');
        }
    }

    async function openImport() {
        await openImportExportModal(
            deps,
            '导入预设',
            'preset',
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
            () => void view.refresh(),
        );
    }

    if (typeof repo.onChanged === 'function') {
        cleanups.push(repo.onChanged(() => void view.refresh()));
    }

    return {
        destroy() {
            if (destroyed) return;
            destroyed = true;
            for (const fn of cleanups) fn();
            view.destroy();
            shell.remove();
        },
    };
}
