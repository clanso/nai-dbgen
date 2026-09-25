/**
 * 预设面板：四种类型子标签 + 设为当前写入对应设置键。
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Ok } from '../../src/infra/result.js';
import { installFakeDom } from './fake-dom.js';
import { mountPresetPanel } from '../../src/ui/panels/preset/preset-panel.js';
import { defaultPluginSettings } from '../../src/domain/model/plugin-settings.js';

/**
 * @param {object} root
 * @param {string} className
 * @returns {object[]}
 */
function findAllByClass(root, className) {
    /** @type {object[]} */
    const out = [];
    function walk(node) {
        if (!node) return;
        if (String(node.className || '').split(/\s+/).includes(className)) {
            out.push(node);
        }
        for (const child of node.childNodes || []) walk(child);
    }
    walk(root);
    return out;
}

describe('preset-panel four kinds', () => {
    /** @type {ReturnType<typeof installFakeDom>|null} */
    let fake = null;
    /** @type {Record<string, unknown>} */
    let settings = {};
    /** @type {Map<string, object>} */
    let store;

    beforeEach(() => {
        fake = installFakeDom();
        settings = {
            ...defaultPluginSettings(),
            activeImagegenPresetId: 'ig-1',
            activeRecallPresetId: null,
            activeSingleImagegenPresetId: null,
            activeSingleRecallPresetId: null,
        };
        store = new Map([
            ['ig-1', {
                id: 'ig-1', name: '楼中生图', kind: 'imagegen',
                prompts: [], prompt_order: [],
            }],
            ['rc-1', {
                id: 'rc-1', name: '楼中召回', kind: 'recall',
                prompts: [], prompt_order: [],
            }],
            ['si-1', {
                id: 'si-1', name: '单图生图', kind: 'single-imagegen',
                prompts: [], prompt_order: [],
            }],
            ['sr-1', {
                id: 'sr-1', name: '单图召回', kind: 'single-recall',
                prompts: [], prompt_order: [],
            }],
        ]);
    });

    afterEach(() => {
        fake?.restore();
        fake = null;
    });

    function mount() {
        const root = document.createElement('div');
        document.body.appendChild(root);
        const api = mountPresetPanel(root, {
            host: {
                toast: () => {},
                openModal: async () => ({ destroy: () => {} }),
            },
            loadSettings: () => settings,
            saveSettings: (next) => { settings = next; },
            repos: {
                preset: {
                    list: async () => Ok([...store.values()]),
                    get: async (id) => Ok(store.get(id) ?? null),
                    put: async (entity) => {
                        store.set(entity.id, entity);
                        return Ok(entity);
                    },
                    remove: async (id) => {
                        store.delete(id);
                        return Ok(undefined);
                    },
                    exportJson: async () => Ok({}),
                    importJson: async () => Ok({ imported: 0, skipped: 0, errors: [] }),
                    onChanged: () => () => {},
                },
            },
            newId: () => 'new-1',
            nowIso: () => '2026-01-01T00:00:00.000Z',
        });
        return { root, api };
    }

    it('renders four kind segmented tabs', async () => {
        const { root, api } = mount();
        await new Promise((r) => setTimeout(r, 0));
        const tabs = findAllByClass(root, 'nd-segment');
        assert.equal(tabs.length, 1);
        const labels = [...(tabs[0].childNodes || [])]
            .map((n) => String(n.textContent || '').trim())
            .filter(Boolean);
        assert.deepEqual(labels, ['生图预设', '召回预设', '单图生图预设', '单图召回预设']);
        api.destroy();
    });

    it('cover:false — no style-cover in preset panel', async () => {
        const { root, api } = mount();
        await new Promise((r) => setTimeout(r, 10));
        const covers = findAllByClass(root, 'nd-style-cover')
            .concat(findAllByClass(root, 'style-cover'));
        assert.equal(covers.length, 0);
        api.destroy();
    });
});
