/**
 * L5 UI · LLM / NAI API 库 管理面板。
 * 归属：W2-H 面板代理实现。W0 仅冻结签名。
 * LLM 与 NAI 两个仓储（D7），分 tab 管理。
 */

import { createButton, createField, createSelect } from '../../common/controls.js';
import { createLlmApiConfig, createNaiApiConfig } from '../../../domain/model/api-config.js';
import { mountLibraryView } from '../library-view.js';
import {
    el,
    setText,
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
export function mountApiConfigPanel(root, deps) {
    if (!(root instanceof Element)) {
        throw new Error('mountApiConfigPanel: root must be an Element');
    }
    const llmRepo = deps?.repos?.llmConfig;
    const naiRepo = deps?.repos?.naiConfig;
    if (!llmRepo || !naiRepo) {
        throw new Error('mountApiConfigPanel: deps.repos.llmConfig / naiConfig required');
    }

    const host = deps.host;
    const ids = idNow(deps);
    const settings = settingsApi(deps);

    const shell = el('div', 'nd-panel nd-panel--api');
    const tabs = el('div', 'nd-subtabs');
    const llmTab = createButton({
        label: 'LLM API',
        variant: 'ghost',
        onClick: () => showKind('llm'),
    });
    const naiTab = createButton({
        label: 'NAI API',
        variant: 'ghost',
        onClick: () => showKind('nai'),
    });
    tabs.append(llmTab, naiTab);

    const llmHost = el('div', 'nd-subpanel');
    const naiHost = el('div', 'nd-subpanel nd-hidden');
    shell.append(tabs, llmHost, naiHost);
    root.appendChild(shell);

    /** @type {'llm'|'nai'} */
    let kind = 'llm';
    /** @type {(() => void)[]} */
    const cleanups = [];
    let destroyed = false;

    function showKind(next) {
        kind = next;
        llmHost.classList.toggle('nd-hidden', kind !== 'llm');
        naiHost.classList.toggle('nd-hidden', kind !== 'nai');
        llmTab.classList.toggle('is-active', kind === 'llm');
        naiTab.classList.toggle('is-active', kind === 'nai');
    }
    showKind('llm');

    const llmView = mountLibraryView(llmHost, {
        list: async () => {
            const items = await awaitRepo(host, llmRepo.list(), '读取 LLM 配置失败') || [];
            const s = settings.load();
            return items.map((item) => ({
                ...item,
                __active:
                    (s.recallLlmConfigId != null && String(s.recallLlmConfigId) === String(item.id))
                    || (s.promptGenLlmConfigId != null && String(s.promptGenLlmConfigId) === String(item.id)),
                __roles: [
                    s.recallLlmConfigId != null && String(s.recallLlmConfigId) === String(item.id) ? '召回' : null,
                    s.promptGenLlmConfigId != null && String(s.promptGenLlmConfigId) === String(item.id) ? '提示词' : null,
                ].filter(Boolean).join(' / '),
            }));
        },
        onCreate: () => void openLlmEditor(null),
        onEdit: (item) => void openLlmEditor(item),
        onDelete: (idList) => void removeLlm(idList),
        onImport: () => void openImport(llmRepo, 'llm-config', '导入 LLM 配置', () => llmView.refresh()),
        onExport: () => void openImport(llmRepo, 'llm-config', '导入 LLM 配置', () => llmView.refresh()),
    }, {
        searchKeys: ['name', 'model', 'baseUrl'],
        columns: [
            { key: 'name', label: '名称' },
            { key: 'model', label: '模型' },
            {
                key: '__roles',
                label: '用途',
                render: (item) => String(item.__roles || ''),
            },
        ],
    });

    const naiView = mountLibraryView(naiHost, {
        list: async () => {
            const items = await awaitRepo(host, naiRepo.list(), '读取 NAI 配置失败') || [];
            const activeId = settings.load().activeNaiConfigId;
            return items.map((item) => ({
                ...item,
                __active: activeId != null && String(activeId) === String(item.id),
            }));
        },
        onCreate: () => void openNaiEditor(null),
        onEdit: (item) => void openNaiEditor(item),
        onDelete: (idList) => void removeNai(idList),
        onImport: () => void openImport(naiRepo, 'nai-config', '导入 NAI 配置', () => naiView.refresh()),
        onExport: () => void openImport(naiRepo, 'nai-config', '导入 NAI 配置', () => naiView.refresh()),
    }, {
        searchKeys: ['name', 'baseUrl'],
        columns: [
            { key: 'name', label: '名称' },
            { key: 'baseUrl', label: '地址' },
            { key: 'transport', label: '传输' },
        ],
    });

    /**
     * @param {object} repo
     * @param {string} expectedKind
     * @param {string} title
     * @param {() => void} onDone
     */
    async function openImport(repo, expectedKind, title, onDone) {
        await openImportExportModal(
            deps,
            title,
            expectedKind,
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
            onDone,
        );
    }

    /**
     * @param {string[]} idList
     */
    async function removeLlm(idList) {
        const ok = await confirmDanger(deps, `删除 ${idList.length} 条 LLM 配置？`);
        if (!ok) return;
        const s = settings.load();
        for (const id of idList) {
            await awaitRepo(host, llmRepo.remove(id), '删除失败');
            /** @type {Record<string, unknown>} */
            const patch = {};
            if (s.recallLlmConfigId != null && String(s.recallLlmConfigId) === String(id)) {
                patch.recallLlmConfigId = null;
            }
            if (s.promptGenLlmConfigId != null && String(s.promptGenLlmConfigId) === String(id)) {
                patch.promptGenLlmConfigId = null;
            }
            if (Object.keys(patch).length) settings.patch(patch);
        }
        await llmView.refresh();
    }

    /**
     * @param {string[]} idList
     */
    async function removeNai(idList) {
        const ok = await confirmDanger(deps, `删除 ${idList.length} 条 NAI 配置？`);
        if (!ok) return;
        for (const id of idList) {
            await awaitRepo(host, naiRepo.remove(id), '删除失败');
            if (settings.load().activeNaiConfigId != null
                && String(settings.load().activeNaiConfigId) === String(id)) {
                settings.patch({ activeNaiConfigId: null });
            }
        }
        await naiView.refresh();
    }

    /**
     * @param {object|null} item
     */
    async function openLlmEditor(item) {
        const nameField = createField({ label: '名称', value: item?.name ?? '' });
        const urlField = createField({ label: '接口地址', value: item?.baseUrl ?? '' });
        const keyField = createField({ label: 'API Key（明文存本地）', value: item?.apiKey ?? '' });
        const modelField = createField({ label: '模型名', value: item?.model ?? '' });
        const transport = createSelect({
            label: '传输',
            value: item?.transport === 'direct' ? 'direct' : 'st-backend',
            options: [
                { value: 'st-backend', label: '酒馆后端（推荐）' },
                { value: 'direct', label: '浏览器直连' },
            ],
        });
        const warn = el('p', 'nd-muted');
        setText(warn, 'Key 出现在浏览器侧，与需求 §8 一致。召回与提示词生成各自独立选择当前配置。');

        const form = el('div', 'nd-form');
        form.append(nameField.el, urlField.el, keyField.el, modelField.el, transport.el, warn);
        const modal = await openFormModal(deps, item ? '编辑 LLM 配置' : '新建 LLM 配置', form);

        const actions = el('div', 'nd-form__actions');
        actions.append(
            createButton({ label: '取消', variant: 'ghost', onClick: () => modal.destroy() }),
            createButton({
                label: '用作召回 LLM',
                variant: 'ghost',
                onClick: async () => {
                    const saved = await saveLlm();
                    if (!saved) return;
                    settings.patch({ recallLlmConfigId: saved.id });
                    toast(host, 'success', '已设为召回 LLM');
                    await llmView.refresh();
                },
            }),
            createButton({
                label: '用作提示词 LLM',
                variant: 'ghost',
                onClick: async () => {
                    const saved = await saveLlm();
                    if (!saved) return;
                    settings.patch({ promptGenLlmConfigId: saved.id });
                    toast(host, 'success', '已设为提示词生成 LLM');
                    await llmView.refresh();
                },
            }),
            createButton({
                label: '保存',
                variant: 'primary',
                onClick: async () => {
                    if (await saveLlm()) {
                        modal.destroy();
                        toast(host, 'success', '已保存');
                        await llmView.refresh();
                    }
                },
            }),
        );
        form.appendChild(actions);

        async function saveLlm() {
            const name = nameField.getValue().trim();
            const baseUrl = urlField.getValue().trim();
            const model = modelField.getValue().trim();
            if (!name || !baseUrl || !model) {
                modal.setError('请填写名称、接口地址与模型名');
                return null;
            }
            const entity = item
                ? {
                    ...item,
                    name,
                    baseUrl,
                    apiKey: keyField.getValue(),
                    model,
                    transport: transport.getValue() === 'direct' ? 'direct' : 'st-backend',
                    updatedAt: ids.now(),
                }
                : createLlmApiConfig(
                    {
                        name,
                        baseUrl,
                        apiKey: keyField.getValue(),
                        model,
                        transport: transport.getValue(),
                    },
                    { id: ids.id('llm'), now: ids.now() },
                );
            return awaitRepo(host, llmRepo.put(entity), '保存失败');
        }
    }

    /**
     * @param {object|null} item
     */
    async function openNaiEditor(item) {
        const nameField = createField({ label: '名称', value: item?.name ?? '' });
        const urlField = createField({ label: '接口地址', value: item?.baseUrl ?? '' });
        const keyField = createField({ label: 'API Key', value: item?.apiKey ?? '' });
        const transport = createSelect({
            label: '传输',
            value: item?.transport === 'st-cors-proxy' ? 'st-cors-proxy' : 'direct',
            options: [
                { value: 'direct', label: '直连（官方或中转）' },
                { value: 'st-cors-proxy', label: '酒馆 CORS 代理' },
            ],
        });
        const decoder = createSelect({
            label: '解码',
            value: item?.decoder === 'json' || item?.decoder === 'zip' ? item.decoder : 'auto',
            options: [
                { value: 'auto', label: '自动' },
                { value: 'json', label: 'JSON' },
                { value: 'zip', label: 'ZIP' },
            ],
        });
        const form = el('div', 'nd-form');
        form.append(nameField.el, urlField.el, keyField.el, transport.el, decoder.el);
        const modal = await openFormModal(deps, item ? '编辑 NAI 配置' : '新建 NAI 配置', form);
        const actions = el('div', 'nd-form__actions');
        actions.append(
            createButton({ label: '取消', variant: 'ghost', onClick: () => modal.destroy() }),
            createButton({
                label: '设为当前激活',
                variant: 'ghost',
                onClick: async () => {
                    const saved = await saveNai();
                    if (!saved) return;
                    settings.patch({ activeNaiConfigId: saved.id });
                    toast(host, 'success', '已设为当前 NAI');
                    await naiView.refresh();
                },
            }),
            createButton({
                label: '保存',
                variant: 'primary',
                onClick: async () => {
                    if (await saveNai()) {
                        modal.destroy();
                        toast(host, 'success', '已保存');
                        await naiView.refresh();
                    }
                },
            }),
        );
        form.appendChild(actions);

        async function saveNai() {
            const name = nameField.getValue().trim();
            const baseUrl = urlField.getValue().trim();
            if (!name || !baseUrl) {
                modal.setError('请填写名称与接口地址');
                return null;
            }
            const entity = item
                ? {
                    ...item,
                    name,
                    baseUrl,
                    apiKey: keyField.getValue(),
                    transport: transport.getValue() === 'st-cors-proxy' ? 'st-cors-proxy' : 'direct',
                    decoder: decoder.getValue(),
                    updatedAt: ids.now(),
                }
                : createNaiApiConfig(
                    {
                        name,
                        baseUrl,
                        apiKey: keyField.getValue(),
                        transport: transport.getValue(),
                        decoder: decoder.getValue(),
                    },
                    { id: ids.id('nai'), now: ids.now() },
                );
            return awaitRepo(host, naiRepo.put(entity), '保存失败');
        }
    }

    if (typeof llmRepo.onChanged === 'function') {
        cleanups.push(llmRepo.onChanged(() => void llmView.refresh()));
    }
    if (typeof naiRepo.onChanged === 'function') {
        cleanups.push(naiRepo.onChanged(() => void naiView.refresh()));
    }

    return {
        destroy() {
            if (destroyed) return;
            destroyed = true;
            for (const fn of cleanups) fn();
            llmView.destroy();
            naiView.destroy();
            shell.remove();
        },
    };
}
