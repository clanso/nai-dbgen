/**
 * L5 UI · 库管理铬件：卡片 + 工具栏工厂（W2 面板共用，裁决「组件缺口」）。
 * 封面一律走 safeImageUrl（D24）。
 */

import { t } from '../i18n/zh-CN.js';
import { createButton, createToggle } from './controls.js';
import { paintSafeCover, pickCoverField } from './safe-url.js';

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
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.subtitle]
 * @param {unknown} [opts.coverUrl] 会过 safeImageUrl；也可传整条 item（取 cover* 字段）
 * @param {object} [opts.item] 若提供则从 item 取封面
 * @param {boolean} [opts.active]
 * @param {boolean} [opts.selected]
 * @param {boolean} [opts.enabled]
 * @param {(v: boolean) => void} [opts.onEnabledChange] 有则渲染启用开关
 * @param {{ label: string, action?: string, variant?: string, onClick?: () => void }[]} [opts.actions]
 * @param {() => void} [opts.onOpen] 点封面/标题
 * @param {HTMLElement} [opts.body]
 * @returns {{
 *   el: HTMLElement,
 *   setTitle: (s: string) => void,
 *   setSubtitle: (s: string) => void,
 *   setCover: (url: unknown, label?: string) => void,
 *   setActive: (v: boolean) => void,
 *   setSelected: (v: boolean) => void,
 *   setEnabled: (v: boolean) => void,
 *   destroy: () => void,
 * }}
 */
export function createStyleCard(opts) {
    const root = el('article', 'nd-style-card');
    if (opts?.active) root.classList.add('is-active');
    if (opts?.selected) root.classList.add('is-selected');

    const cover = el('button', 'nd-style-card__cover');
    /** @type {HTMLButtonElement} */ (cover).type = 'button';
    const titleText = opts?.title != null ? String(opts.title) : '';
    const coverSrc = opts?.coverUrl != null
        ? opts.coverUrl
        : pickCoverField(opts?.item);
    paintSafeCover(cover, coverSrc, titleText);

    const body = el('div', 'nd-style-card__body');
    const heading = el('h3');
    heading.textContent = titleText;

    /** @type {HTMLElement|null} */
    let subtitleEl = null;
    if (opts?.subtitle) {
        subtitleEl = el('p', 'nd-style-card__subtitle');
        subtitleEl.textContent = String(opts.subtitle);
        body.append(heading, subtitleEl);
    } else {
        body.appendChild(heading);
    }

    if (opts?.body instanceof HTMLElement) {
        body.appendChild(opts.body);
    }

    /** @type {{ destroy: () => void }|null} */
    let enabledToggle = null;
    if (typeof opts?.onEnabledChange === 'function') {
        enabledToggle = createToggle({
            label: t('library.enabled'),
            checked: Boolean(opts.enabled),
            onChange: opts.onEnabledChange,
        });
        enabledToggle.el.classList.add('nd-style-card__enable');
        body.appendChild(enabledToggle.el);
    }

    const actions = el('div', 'nd-style-card__actions');
    /** @type {(() => void)[]} */
    const cleanups = [];

    const actionList = Array.isArray(opts?.actions) ? opts.actions : [];
    for (const spec of actionList) {
        const btn = createButton({
            label: spec.label,
            variant: spec.variant || 'icon',
            onClick: spec.onClick,
        });
        if (spec.action) {
            btn.dataset.action = String(spec.action);
        }
        actions.appendChild(btn);
    }
    if (actionList.length) {
        body.appendChild(actions);
    }

    if (typeof opts?.onOpen === 'function') {
        const onOpen = (event) => {
            event.preventDefault();
            opts.onOpen();
        };
        cover.addEventListener('click', onOpen);
        heading.style.cursor = 'pointer';
        heading.addEventListener('click', onOpen);
        cleanups.push(() => {
            cover.removeEventListener('click', onOpen);
            heading.removeEventListener('click', onOpen);
        });
    }

    root.append(cover, body);

    let destroyed = false;
    return {
        el: root,
        setTitle(s) {
            heading.textContent = s == null ? '' : String(s);
        },
        setSubtitle(s) {
            const text = s == null ? '' : String(s);
            if (!subtitleEl) {
                subtitleEl = el('p', 'nd-style-card__subtitle');
                heading.after(subtitleEl);
            }
            subtitleEl.textContent = text;
        },
        setCover(url, label) {
            paintSafeCover(cover, url, label != null ? label : heading.textContent);
        },
        setActive(v) {
            root.classList.toggle('is-active', Boolean(v));
        },
        setSelected(v) {
            root.classList.toggle('is-selected', Boolean(v));
        },
        setEnabled(v) {
            if (enabledToggle) enabledToggle.setValue(Boolean(v));
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            for (const fn of cleanups) fn();
            enabledToggle?.destroy();
            root.remove();
        },
    };
}

/**
 * @param {object} opts
 * @param {string} [opts.searchPlaceholder]
 * @param {string} [opts.searchValue]
 * @param {(q: string) => void} [opts.onSearch]
 * @param {{ value: string, label: string }[]} [opts.filters]
 * @param {string} [opts.filterValue]
 * @param {string} [opts.filterLabel]
 * @param {(v: string) => void} [opts.onFilter]
 * @param {{ value: string, label: string }[]} [opts.sortOptions]
 * @param {string} [opts.sortValue]
 * @param {string} [opts.sortLabel]
 * @param {(v: string) => void} [opts.onSort]
 * @param {() => void} [opts.onCreate]
 * @param {() => void} [opts.onImport]
 * @param {() => void} [opts.onExport]
 * @param {HTMLElement[]} [opts.extra]
 * @returns {{
 *   el: HTMLElement,
 *   getSearch: () => string,
 *   setSearch: (s: string) => void,
 *   getFilter: () => string,
 *   setFilter: (v: string) => void,
 *   getSort: () => string,
 *   setSort: (v: string) => void,
 *   destroy: () => void,
 * }}
 */
export function createLibraryToolbar(opts) {
    const root = el('div', 'nd-library-toolbar');

    const searchWrap = el('div', 'nd-search-field');
    const search = document.createElement('input');
    search.type = 'search';
    search.placeholder = opts?.searchPlaceholder != null
        ? String(opts.searchPlaceholder)
        : t('library.searchPlaceholder');
    search.setAttribute('aria-label', t('common.search'));
    search.value = opts?.searchValue != null ? String(opts.searchValue) : '';
    search.autocomplete = 'off';
    searchWrap.appendChild(search);

    /** @type {HTMLSelectElement|null} */
    let filterSelect = null;
    if (Array.isArray(opts?.filters) && opts.filters.length) {
        filterSelect = /** @type {HTMLSelectElement} */ (el('select', 'nd-select'));
        filterSelect.setAttribute(
            'aria-label',
            opts.filterLabel != null ? String(opts.filterLabel) : t('library.filter'),
        );
        for (const item of opts.filters) {
            const option = document.createElement('option');
            option.value = String(item.value);
            option.textContent = item.label != null ? String(item.label) : String(item.value);
            filterSelect.appendChild(option);
        }
        if (opts.filterValue != null) filterSelect.value = String(opts.filterValue);
    }

    /** @type {HTMLSelectElement|null} */
    let sortSelect = null;
    if (Array.isArray(opts?.sortOptions) && opts.sortOptions.length) {
        sortSelect = /** @type {HTMLSelectElement} */ (el('select', 'nd-select'));
        sortSelect.setAttribute(
            'aria-label',
            opts.sortLabel != null ? String(opts.sortLabel) : t('library.sort'),
        );
        for (const item of opts.sortOptions) {
            const option = document.createElement('option');
            option.value = String(item.value);
            option.textContent = item.label != null ? String(item.label) : String(item.value);
            sortSelect.appendChild(option);
        }
        if (opts.sortValue != null) sortSelect.value = String(opts.sortValue);
    }

    /** @type {HTMLButtonElement[]} */
    const buttons = [];
    if (typeof opts?.onCreate === 'function') {
        buttons.push(createButton({
            label: t('library.create'),
            variant: 'primary',
            onClick: opts.onCreate,
        }));
    }
    if (typeof opts?.onImport === 'function') {
        buttons.push(createButton({
            label: t('common.import'),
            variant: 'ghost',
            onClick: opts.onImport,
        }));
    }
    if (typeof opts?.onExport === 'function') {
        buttons.push(createButton({
            label: t('common.export'),
            variant: 'ghost',
            onClick: opts.onExport,
        }));
    }

    root.appendChild(searchWrap);
    if (filterSelect) root.appendChild(filterSelect);
    if (sortSelect) root.appendChild(sortSelect);
    for (const btn of buttons) root.appendChild(btn);
    const extras = Array.isArray(opts?.extra) ? opts.extra : [];
    for (const node of extras) {
        if (node instanceof HTMLElement) root.appendChild(node);
    }

    const onSearch = () => {
        if (typeof opts?.onSearch === 'function') opts.onSearch(search.value);
    };
    const onFilter = () => {
        if (filterSelect && typeof opts?.onFilter === 'function') {
            opts.onFilter(filterSelect.value);
        }
    };
    const onSort = () => {
        if (sortSelect && typeof opts?.onSort === 'function') {
            opts.onSort(sortSelect.value);
        }
    };

    search.addEventListener('input', onSearch);
    filterSelect?.addEventListener('change', onFilter);
    sortSelect?.addEventListener('change', onSort);

    let destroyed = false;
    return {
        el: root,
        getSearch: () => search.value,
        setSearch(s) {
            search.value = s == null ? '' : String(s);
        },
        getFilter: () => (filterSelect ? filterSelect.value : ''),
        setFilter(v) {
            if (filterSelect) filterSelect.value = v == null ? '' : String(v);
        },
        getSort: () => (sortSelect ? sortSelect.value : ''),
        setSort(v) {
            if (sortSelect) sortSelect.value = v == null ? '' : String(v);
        },
        destroy() {
            if (destroyed) return;
            destroyed = true;
            search.removeEventListener('input', onSearch);
            filterSelect?.removeEventListener('change', onFilter);
            sortSelect?.removeEventListener('change', onSort);
            root.remove();
        },
    };
}
