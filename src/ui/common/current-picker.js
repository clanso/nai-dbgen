/**
 * L5 UI · 当前项选择器（封面 + 搜索 + 高亮 + 清除）。
 * 归属：W1-E 组件代理实现。W0 仅冻结签名。
 */

import { t } from '../i18n/zh-CN.js';
import { paintSafeCover, pickCoverField } from './safe-url.js';

/**
 * @param {object} item
 * @param {(item: object) => string} [getLabel]
 * @returns {string}
 */
function labelOf(item, getLabel) {
    if (typeof getLabel === 'function') {
        return String(getLabel(item) ?? '');
    }
    if (item == null) return '';
    if (item.name != null) return String(item.name);
    if (item.label != null) return String(item.label);
    if (item.id != null) return String(item.id);
    return '';
}

/**
 * @param {object} item
 * @returns {string}
 */
function idOf(item) {
    if (item == null || item.id == null) return '';
    return String(item.id);
}

/**
 * @param {HTMLElement} coverEl
 * @param {object|null|undefined} item
 * @param {string} label
 */
function paintCover(coverEl, item, label) {
    paintSafeCover(coverEl, pickCoverField(item), label);
}

/**
 * @param {Element} root
 * @param {object} deps
 * @param {() => Promise<object[]>} deps.list
 * @param {() => string|null} deps.getActiveId
 * @param {(id: string|null) => void} deps.setActiveId
 * @param {(item: object) => string} [deps.getLabel]
 * @returns {{ destroy: () => void, refresh: () => Promise<void> }}
 */
export function mountCurrentPicker(root, deps) {
    if (!(root instanceof Element)) {
        throw new Error('mountCurrentPicker: root must be an Element');
    }

    const list = typeof deps?.list === 'function' ? deps.list : async () => [];
    const getActiveId = typeof deps?.getActiveId === 'function' ? deps.getActiveId : () => null;
    const setActiveId = typeof deps?.setActiveId === 'function' ? deps.setActiveId : () => {};
    const getLabel = deps?.getLabel;

    const shell = document.createElement('div');
    shell.className = 'nd-picker';

    const control = document.createElement('div');
    control.className = 'nd-picker__control';

    const cover = document.createElement('div');
    cover.className = 'nd-picker__cover';
    cover.setAttribute('aria-hidden', 'true');

    const input = document.createElement('input');
    input.type = 'search';
    input.placeholder = t('picker.searchPlaceholder');
    input.setAttribute('aria-label', t('common.search'));
    input.autocomplete = 'off';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'nd-picker__clear';
    clearBtn.textContent = '×';
    clearBtn.title = t('picker.clear');
    clearBtn.setAttribute('aria-label', t('picker.clear'));

    control.append(cover, input, clearBtn);

    const results = document.createElement('div');
    results.className = 'nd-picker__results nd-hidden';
    results.setAttribute('role', 'listbox');

    shell.append(control, results);
    root.appendChild(shell);

    /** @type {object[]} */
    let items = [];
    let destroyed = false;
    let resultsOpen = false;

    /**
     * @param {boolean} open
     */
    function setResultsOpen(open) {
        resultsOpen = open;
        results.classList.toggle('nd-hidden', !open);
    }

    function activeItem() {
        const id = getActiveId();
        if (id == null) return null;
        return items.find((item) => idOf(item) === String(id)) || null;
    }

    function syncControl() {
        const current = activeItem();
        const label = labelOf(current, getLabel);
        paintCover(cover, current, label);
        if (!resultsOpen) {
            input.value = label;
        }
    }

    /**
     * @param {string} query
     */
    function renderResults(query) {
        results.replaceChildren();
        const q = String(query || '').trim().toLowerCase();
        const filtered = items.filter((item) => {
            if (!q) return true;
            return labelOf(item, getLabel).toLowerCase().includes(q);
        });

        if (!filtered.length) {
            const empty = document.createElement('div');
            empty.className = 'nd-empty-lab';
            empty.style.minHeight = '72px';
            empty.textContent = t('picker.noResults');
            results.appendChild(empty);
            return;
        }

        const activeId = getActiveId();
        for (const item of filtered) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'nd-picker-option';
            btn.setAttribute('role', 'option');
            const id = idOf(item);
            if (activeId != null && String(activeId) === id) {
                btn.classList.add('is-active');
                btn.setAttribute('aria-selected', 'true');
            } else {
                btn.setAttribute('aria-selected', 'false');
            }

            const mini = document.createElement('div');
            mini.className = 'nd-mini-cover';
            const label = labelOf(item, getLabel);
            paintCover(mini, item, label);

            const meta = document.createElement('span');
            meta.className = 'nd-picker-option__meta';
            const strong = document.createElement('strong');
            strong.textContent = label;
            meta.appendChild(strong);
            if (item.category != null || item.subtitle != null) {
                const small = document.createElement('small');
                small.textContent = String(item.category ?? item.subtitle);
                meta.appendChild(small);
            }

            btn.append(mini, meta);
            btn.addEventListener('click', () => {
                setActiveId(id || null);
                setResultsOpen(false);
                syncControl();
            });
            results.appendChild(btn);
        }
    }

    async function refresh() {
        if (destroyed) return;
        try {
            const next = await list();
            items = Array.isArray(next) ? next : [];
        } catch {
            items = [];
        }
        syncControl();
        if (resultsOpen) {
            renderResults(input.value);
        }
    }

    const onFocus = () => {
        setResultsOpen(true);
        input.value = '';
        renderResults('');
    };

    const onInput = () => {
        setResultsOpen(true);
        renderResults(input.value);
    };

    const onClear = (event) => {
        event.preventDefault();
        setActiveId(null);
        setResultsOpen(false);
        syncControl();
    };

    const onDocPointer = (event) => {
        if (!resultsOpen || destroyed) return;
        const target = event.target;
        if (target instanceof Node && shell.contains(target)) return;
        setResultsOpen(false);
        syncControl();
    };

    input.addEventListener('focus', onFocus);
    input.addEventListener('input', onInput);
    clearBtn.addEventListener('click', onClear);
    document.addEventListener('pointerdown', onDocPointer);

    const boot = refresh();

    return {
        refresh: () => refresh(),
        destroy() {
            if (destroyed) return;
            destroyed = true;
            input.removeEventListener('focus', onFocus);
            input.removeEventListener('input', onInput);
            clearBtn.removeEventListener('click', onClear);
            document.removeEventListener('pointerdown', onDocPointer);
            shell.remove();
            void boot;
        },
    };
}
