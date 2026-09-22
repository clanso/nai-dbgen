/**
 * L5 UI · 酒馆设置抽屉内精简面板（高频开关与当前选择）。
 * 归属：W2-H 面板代理实现。W0 仅冻结签名。
 */

import { createNumberField, createToggle, createButton, createFieldGroup } from '../common/controls.js';
import { mountCurrentPicker } from '../common/current-picker.js';
import { mergePluginSettings } from '../../domain/model/plugin-settings.js';
import { pickAllowedSettingsPatch, PLUGIN_SETTINGS_KEYS } from '../panels/_lib/library-logic.js';
import { el, setText } from '../panels/_lib/panel-kit.js';

/**
 * @typedef {import('../domain/model/plugin-settings.js').PluginSettings} PluginSettings
 */

/**
 * @typedef {object} DrawerDeps
 * @property {() => PluginSettings} loadSettings
 * @property {(settings: PluginSettings) => void} saveSettings
 * @property {() => void} openManagementShell
 * @property {object} repos
 */

/**
 * @param {Element} root 挂到 #extensions_settings2 内的容器
 * @param {DrawerDeps} deps
 * @returns {{ destroy: () => void }}
 */
export function mountDrawer(root, deps) {
    if (!(root instanceof Element)) {
        throw new Error('mountDrawer: root must be an Element');
    }
    if (typeof deps?.loadSettings !== 'function' || typeof deps?.saveSettings !== 'function') {
        throw new Error('mountDrawer: loadSettings/saveSettings required');
    }

    const shell = el('div', 'nd-drawer nd-root');
    shell.id = 'nai-dbgen-drawer';

    const title = el('h3', 'nd-drawer__title');
    setText(title, '数据库生图');

    function load() {
        return deps.loadSettings();
    }

    /**
     * @param {object} partial
     */
    function patch(partial) {
        const allowed = pickAllowedSettingsPatch(partial);
        const next = mergePluginSettings(load(), /** @type {any} */ (allowed));
        deps.saveSettings(next);
        return next;
    }

    const current = load();
    const contextN = createNumberField({
        label: '上下文楼数',
        value: current.contextWindowSize ?? 5,
        min: 1,
        max: 100,
        step: 1,
        onChange: (v) => patch({ contextWindowSize: v }),
    });
    const autoWrite = createToggle({
        label: '自动写 slot',
        checked: current.autoWriteSlots === true,
        onChange: (v) => patch({ autoWriteSlots: v }),
    });
    const autoRender = createToggle({
        label: '自动出图',
        checked: current.autoRenderSlots === true,
        onChange: (v) => patch({ autoRenderSlots: v }),
    });

    const pickers = el('div', 'nd-drawer__pickers');

    /**
     * @param {string} label
     * @param {() => Promise<object[]>} listFn
     * @param {() => string|null} getId
     * @param {(id: string|null) => void} setId
     */
    function addPicker(label, listFn, getId, setId) {
        const wrap = el('div', 'nd-drawer__picker');
        const lab = el('span', 'nd-field__label');
        setText(lab, label);
        const host = el('div');
        wrap.append(lab, host);
        pickers.appendChild(wrap);
        return mountCurrentPicker(host, {
            list: listFn,
            getActiveId: getId,
            setActiveId: setId,
        });
    }

    /** @type {{ destroy: () => void, refresh: () => Promise<void> }[]} */
    const pickerHandles = [];
    const repos = deps.repos || {};

    if (repos.artist) {
        pickerHandles.push(addPicker(
            '当前画师串',
            async () => {
                const r = await repos.artist.list();
                return r?.ok ? r.value : [];
            },
            () => load().activeArtistId,
            (id) => patch({ activeArtistId: id }),
        ));
    }
    if (repos.naiConfig) {
        pickerHandles.push(addPicker(
            '当前 NAI',
            async () => {
                const r = await repos.naiConfig.list();
                return r?.ok ? r.value : [];
            },
            () => load().activeNaiConfigId,
            (id) => patch({ activeNaiConfigId: id }),
        ));
    }
    if (repos.llmConfig) {
        pickerHandles.push(addPicker(
            '召回 LLM',
            async () => {
                const r = await repos.llmConfig.list();
                return r?.ok ? r.value : [];
            },
            () => load().recallLlmConfigId,
            (id) => patch({ recallLlmConfigId: id }),
        ));
        pickerHandles.push(addPicker(
            '提示词 LLM',
            async () => {
                const r = await repos.llmConfig.list();
                return r?.ok ? r.value : [];
            },
            () => load().promptGenLlmConfigId,
            (id) => patch({ promptGenLlmConfigId: id }),
        ));
    }
    if (repos.preset) {
        pickerHandles.push(addPicker(
            '生图预设',
            async () => {
                const r = await repos.preset.list();
                const items = r?.ok ? r.value : [];
                return (items || []).filter((p) => p && p.kind === 'imagegen');
            },
            () => load().activeImagegenPresetId,
            (id) => patch({ activeImagegenPresetId: id }),
        ));
        pickerHandles.push(addPicker(
            '召回预设',
            async () => {
                const r = await repos.preset.list();
                const items = r?.ok ? r.value : [];
                return (items || []).filter((p) => p && p.kind === 'recall');
            },
            () => load().activeRecallPresetId,
            (id) => patch({ activeRecallPresetId: id }),
        ));
    }

    const openBtn = createButton({
        label: '打开管理台',
        variant: 'primary',
        onClick: () => {
            if (typeof deps.openManagementShell === 'function') {
                deps.openManagementShell();
            }
        },
    });

    const hint = el('p', 'nd-muted');
    setText(hint, `设置键：${PLUGIN_SETTINGS_KEYS.slice(0, 6).join(', ')}…`);

    const group = createFieldGroup({
        title: '高频开关',
        children: [contextN.el, autoWrite.el, autoRender.el],
    });

    shell.append(title, group.el, pickers, openBtn, hint);
    root.appendChild(shell);

    let destroyed = false;
    return {
        destroy() {
            if (destroyed) return;
            destroyed = true;
            for (const h of pickerHandles) h.destroy();
            contextN.destroy();
            autoWrite.destroy();
            autoRender.destroy();
            group.destroy();
            shell.remove();
        },
    };
}
