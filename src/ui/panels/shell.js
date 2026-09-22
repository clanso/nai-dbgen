/**
 * L5 UI · 管理台 Popup 外壳 + 标签页路由。
 * 归属：W2-H 面板代理实现。W0 仅冻结签名。
 */

import { openModal } from '../common/modal.js';
import { createButton } from '../common/controls.js';
import { mountCharacterPanel } from './character/character-panel.js';
import { mountTagPanel } from './tag/tag-panel.js';
import { mountArtistPanel } from './artist/artist-panel.js';
import { mountApiConfigPanel } from './api-config/api-config-panel.js';
import { mountPresetPanel } from './preset/preset-panel.js';
import { mountPromptsPanel } from './prompts/prompts-panel.js';
import { mountTriggerPanel } from './trigger/trigger-panel.js';

/**
 * @typedef {object} PanelShellDeps
 * @property {import('../../ports/host.port.js').HostPort} host
 * @property {object} repos
 * @property {object} services
 */

/** @type {{ id: string, label: string, mount: (root: Element, deps: object) => { destroy: () => void } }[]} */
const TABS = [
    { id: 'character', label: '角色库', mount: mountCharacterPanel },
    { id: 'tag', label: '标签库', mount: mountTagPanel },
    { id: 'artist', label: '画师串', mount: mountArtistPanel },
    { id: 'api', label: 'API 配置', mount: mountApiConfigPanel },
    { id: 'preset', label: '预设', mount: mountPresetPanel },
    { id: 'prompts', label: '提示词', mount: mountPromptsPanel },
    { id: 'trigger', label: '运行配置', mount: mountTriggerPanel },
];

/**
 * 打开管理台；返回句柄以便 dispose 时关闭。
 * @param {PanelShellDeps} deps
 * @param {string} [initialTab]
 * @returns {Promise<{ destroy: () => void }>}
 */
export async function openPanelShell(deps, initialTab) {
    const shell = document.createElement('div');
    shell.className = 'nd-shell nd-root';
    // D52：作用域根用 class .nd-root，不再赋 #nai-dbgen-root id
    const root = document.createElement('div');
    root.className = 'nd-root';
    root.appendChild(shell);

    const tabBar = document.createElement('div');
    tabBar.className = 'nd-shell__tabs';
    tabBar.setAttribute('role', 'tablist');

    const body = document.createElement('div');
    body.className = 'nd-shell__body';

    shell.append(tabBar, body);

    /** @type {{ destroy: () => void }|null} */
    let activePanel = null;
    /** @type {string} */
    let current = TABS.some((t) => t.id === initialTab) ? String(initialTab) : TABS[0].id;
    /** @type {HTMLButtonElement[]} */
    const tabButtons = [];

    /**
     * @param {string} tabId
     */
    function activate(tabId) {
        const tab = TABS.find((t) => t.id === tabId) || TABS[0];
        current = tab.id;
        for (const btn of tabButtons) {
            const on = btn.dataset.tab === current;
            btn.classList.toggle('is-active', on);
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
        }
        activePanel?.destroy();
        activePanel = null;
        body.replaceChildren();
        const panelRoot = document.createElement('div');
        panelRoot.className = 'nd-shell__panel';
        body.appendChild(panelRoot);
        activePanel = tab.mount(panelRoot, deps);
    }

    for (const tab of TABS) {
        const btn = createButton({
            label: tab.label,
            variant: 'ghost',
            onClick: () => activate(tab.id),
        });
        btn.classList.add('nd-shell__tab');
        btn.dataset.tab = tab.id;
        btn.setAttribute('role', 'tab');
        tabBar.appendChild(btn);
        tabButtons.push(btn);
    }

    activate(current);

    const modal = await openModal(
        { host: deps?.host },
        {
            title: '数据库生图 · 管理台',
            element: root,
            wide: true,
            large: true,
            allowVerticalScrolling: true,
        },
    );

    let destroyed = false;
    return {
        destroy() {
            if (destroyed) return;
            destroyed = true;
            activePanel?.destroy();
            activePanel = null;
            modal.destroy();
        },
    };
}
