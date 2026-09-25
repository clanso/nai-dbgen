/**
 * L5 UI · 拖放 + 预览表 + 重复策略（跳过/覆盖/另存）。
 * 归属：W1-E 组件代理实现。W0 仅冻结签名。
 *
 * 只做 UI：JSON 解析与预览勾选；真正导入/导出交给 deps（W1-D 存储层）。
 *
 * ## 勾选语义（裁决 D44）
 * 预览表只列**叶子**（扁平 items / characters / entries，或嵌套组内角色、库内条目）。
 * 「导入已勾选」必须按勾选过滤后再交给 importJson——假勾选会在 overwrite 下覆盖用户本想保住的条目。
 *
 * 两层结构：
 * - 取消勾选某叶子 = 不导入该叶子。
 * - 过滤后若某父（组/库）下已无任何已勾选叶子，该父从载荷中省略（不写空组）。
 * - 本 UI **无独立父勾选列**；「取消父节点」= 取消其下全部叶子勾选。
 * - 扁平信封 `{ groups, characters }` / `{ libraries, entries }`：父按叶子的 groupId/libraryId 引用保留。
 */

import { t } from '../i18n/zh-CN.js';
import { createButton } from './controls.js';
import { safeImageUrl } from './safe-url.js';

/** @type {readonly string[]} */
const FLAT_LEAF_KEYS = Object.freeze([
    'items', 'entries', 'characters', 'tags',
    'artists', 'presets', 'configs', 'rows',
]);

/**
 * @param {unknown} data
 * @returns {object[]}
 */
export function extractPreviewRows(data) {
    if (data == null) return [];
    if (Array.isArray(data)) {
        return data.filter((item) => item && typeof item === 'object');
    }
    if (typeof data !== 'object') return [];

    const obj = /** @type {Record<string, unknown>} */ (data);
    for (const key of FLAT_LEAF_KEYS) {
        if (Array.isArray(obj[key])) {
            return /** @type {object[]} */ (obj[key]).filter((item) => item && typeof item === 'object');
        }
    }

    // 嵌套 envelope：groups[].characters / libraries[].entries
    if (Array.isArray(obj.groups)) {
        /** @type {object[]} */
        const rows = [];
        for (const group of obj.groups) {
            if (!group || typeof group !== 'object') continue;
            const g = /** @type {Record<string, unknown>} */ (group);
            if (Array.isArray(g.characters)) {
                for (const ch of g.characters) {
                    if (ch && typeof ch === 'object') {
                        rows.push({
                            ...ch,
                            _groupName: g.name,
                        });
                    }
                }
            } else {
                rows.push(group);
            }
        }
        if (rows.length) return rows;
    }
    if (Array.isArray(obj.libraries)) {
        /** @type {object[]} */
        const rows = [];
        for (const lib of obj.libraries) {
            if (!lib || typeof lib !== 'object') continue;
            const l = /** @type {Record<string, unknown>} */ (lib);
            if (Array.isArray(l.entries)) {
                for (const entry of l.entries) {
                    if (entry && typeof entry === 'object') {
                        rows.push({
                            ...entry,
                            _libraryName: l.name,
                        });
                    }
                }
            } else {
                rows.push(lib);
            }
        }
        if (rows.length) return rows;
    }

    return [obj];
}

/**
 * 按与 extractPreviewRows 同序的勾选数组过滤载荷。
 * 无任何勾选 → 返回 null（调用方不得把空包丢给 importJson）。
 *
 * @param {object|object[]} data
 * @param {boolean[]} checked
 * @returns {object|object[]|null}
 */
export function filterImportPayload(data, checked) {
    const flags = Array.isArray(checked) ? checked : [];
    if (!flags.some(Boolean)) {
        return null;
    }

    if (Array.isArray(data)) {
        const kept = data.filter((item, i) => item && typeof item === 'object' && flags[i]);
        return kept.length ? kept : null;
    }
    if (data == null || typeof data !== 'object') {
        return null;
    }

    const obj = /** @type {Record<string, unknown>} */ (data);

    for (const key of FLAT_LEAF_KEYS) {
        if (!Array.isArray(obj[key])) continue;
        const leaves = /** @type {object[]} */ (obj[key]);
        const keptLeaves = leaves.filter((item, i) => item && typeof item === 'object' && flags[i]);
        if (!keptLeaves.length) return null;

        /** @type {Record<string, unknown>} */
        const next = { ...obj, [key]: keptLeaves };

        // 扁平两层：characters ↔ groups / entries ↔ libraries
        if (key === 'characters' && Array.isArray(obj.groups)) {
            const parentIds = new Set(
                keptLeaves
                    .map((c) => (c && /** @type {any} */ (c).groupId != null
                        ? String(/** @type {any} */ (c).groupId)
                        : ''))
                    .filter(Boolean),
            );
            next.groups = /** @type {object[]} */ (obj.groups).filter(
                (g) => g && typeof g === 'object' && parentIds.has(String(/** @type {any} */ (g).id ?? '')),
            );
        }
        if (key === 'entries' && Array.isArray(obj.libraries)) {
            const parentIds = new Set(
                keptLeaves
                    .map((e) => (e && /** @type {any} */ (e).libraryId != null
                        ? String(/** @type {any} */ (e).libraryId)
                        : ''))
                    .filter(Boolean),
            );
            next.libraries = /** @type {object[]} */ (obj.libraries).filter(
                (l) => l && typeof l === 'object' && parentIds.has(String(/** @type {any} */ (l).id ?? '')),
            );
        }
        return next;
    }

    if (Array.isArray(obj.groups)) {
        let idx = 0;
        /** @type {object[]} */
        const newGroups = [];
        for (const group of obj.groups) {
            if (!group || typeof group !== 'object') continue;
            const g = /** @type {Record<string, unknown>} */ (group);
            if (Array.isArray(g.characters)) {
                /** @type {object[]} */
                const kept = [];
                for (const ch of g.characters) {
                    if (!ch || typeof ch !== 'object') {
                        idx += 1;
                        continue;
                    }
                    if (flags[idx]) kept.push(ch);
                    idx += 1;
                }
                if (kept.length) {
                    newGroups.push({ ...g, characters: kept });
                }
            } else if (flags[idx]) {
                newGroups.push(group);
                idx += 1;
            } else {
                idx += 1;
            }
        }
        if (!newGroups.length) return null;
        return { ...obj, groups: newGroups };
    }

    if (Array.isArray(obj.libraries)) {
        let idx = 0;
        /** @type {object[]} */
        const newLibs = [];
        for (const lib of obj.libraries) {
            if (!lib || typeof lib !== 'object') continue;
            const l = /** @type {Record<string, unknown>} */ (lib);
            if (Array.isArray(l.entries)) {
                /** @type {object[]} */
                const kept = [];
                for (const entry of l.entries) {
                    if (!entry || typeof entry !== 'object') {
                        idx += 1;
                        continue;
                    }
                    if (flags[idx]) kept.push(entry);
                    idx += 1;
                }
                if (kept.length) {
                    newLibs.push({ ...l, entries: kept });
                }
            } else if (flags[idx]) {
                newLibs.push(lib);
                idx += 1;
            } else {
                idx += 1;
            }
        }
        if (!newLibs.length) return null;
        return { ...obj, libraries: newLibs };
    }

    // 单根对象：仅当 flags[0]
    return flags[0] ? obj : null;
}

/**
 * @param {object} item
 * @returns {{ name: string, id: string, kind: string }}
 */
function rowMeta(item) {
    const name = item.name != null
        ? String(item.name)
        : item.label != null
            ? String(item.label)
            : item.key != null
                ? String(item.key)
                : '(unnamed)';
    const id = item.id != null ? String(item.id) : '';
    const kind = item.kind != null
        ? String(item.kind)
        : item.type != null
            ? String(item.type)
            : item._groupName != null
                ? `group:${item._groupName}`
                : item._libraryName != null
                    ? `library:${item._libraryName}`
                    : '';
    return { name, id, kind };
}

/**
 * @param {object|object[]|Blob} data
 * @param {string} filename
 */
function downloadJson(data, filename) {
    /** @type {Blob} */
    let blob;
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
        blob = data;
    } else if (Array.isArray(data)) {
        // 分段拼 Blob，避免一次性 JSON.stringify 整个巨数组卡死
        /** @type {BlobPart[]} */
        const parts = ['[\n'];
        for (let i = 0; i < data.length; i += 1) {
            if (i > 0) parts.push(',\n');
            parts.push(JSON.stringify(data[i], null, 2));
        }
        parts.push('\n]');
        blob = new Blob(parts, { type: 'application/json' });
    } else {
        const text = JSON.stringify(data ?? {}, null, 2);
        blob = new Blob([text], { type: 'application/json' });
    }
    const url = URL.createObjectURL(blob);
    const safe = safeImageUrl(url);
    if (!safe) {
        URL.revokeObjectURL(url);
        throw new Error('export download url rejected');
    }
    const a = document.createElement('a');
    a.href = safe;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/**
 * @param {number} count
 * @param {((count: number) => boolean|Promise<boolean>)|null|undefined} custom
 * @returns {Promise<boolean>}
 */
async function resolveOverwriteConfirm(count, custom) {
    if (typeof custom === 'function') {
        return Boolean(await custom(count));
    }
    // 禁止 window.confirm；未注入回调则拒绝覆盖（安全默认）
    return false;
}

/**
 * @param {Element} root
 * @param {object} deps
 * @param {(data: object, strategy: string) => Promise<object>} deps.importJson
 * @param {() => Promise<object>} deps.exportJson
 * @param {(count: number) => boolean|Promise<boolean>} [deps.confirmOverwrite] D53：面板注入异步确认（confirmAsk）；未传则拒绝覆盖
 * @returns {{ destroy: () => void }}
 */
export function mountImportExport(root, deps) {
    if (!(root instanceof Element)) {
        throw new Error('mountImportExport: root must be an Element');
    }
    const importJson = typeof deps?.importJson === 'function' ? deps.importJson : null;
    const exportJson = typeof deps?.exportJson === 'function' ? deps.exportJson : null;
    const confirmOverwriteCb = typeof deps?.confirmOverwrite === 'function'
        ? deps.confirmOverwrite
        : null;

    const shell = document.createElement('div');
    shell.className = 'nd-import';

    const grid = document.createElement('div');
    grid.className = 'nd-import__grid';

    const drop = document.createElement('section');
    drop.className = 'nd-dropzone';
    drop.setAttribute('tabindex', '0');

    const icon = document.createElement('span');
    icon.className = 'nd-dropzone__icon';
    icon.textContent = '⇩';

    const dropTitle = document.createElement('h3');
    dropTitle.textContent = t('import.dropTitle');

    const dropHint = document.createElement('p');
    dropHint.textContent = t('import.dropHint');

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json,application/json,text/json';
    fileInput.hidden = true;

    const pickBtn = createButton({
        label: t('import.pickFile'),
        variant: 'primary',
        onClick: () => fileInput.click(),
    });

    const paste = document.createElement('textarea');
    paste.className = 'nd-textarea';
    paste.rows = 8;
    paste.placeholder = t('import.pastePlaceholder');

    const parseBtn = createButton({
        label: t('import.parsePaste'),
        variant: 'ghost',
        onClick: () => {
            previewFromText(paste.value, 'paste');
        },
    });

    drop.append(icon, dropTitle, dropHint, fileInput, pickBtn, paste, parseBtn);

    const exportPanel = document.createElement('section');
    exportPanel.className = 'nd-import__export';
    const exportTitle = document.createElement('h3');
    exportTitle.textContent = t('import.exportTitle');
    const exportHint = document.createElement('p');
    exportHint.textContent = t('import.exportHint');
    const exportBtn = createButton({
        label: t('import.exportButton'),
        variant: 'ghost',
        onClick: async () => {
            if (!exportJson) return;
            try {
                const data = await exportJson();
                downloadJson(data ?? {}, `nai-dbgen-export-${Date.now()}.json`);
            } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            }
        },
    });
    exportPanel.append(exportTitle, exportHint, exportBtn);

    grid.append(drop, exportPanel);

    const preview = document.createElement('section');
    preview.className = 'nd-import-preview nd-hidden';

    const toolbar = document.createElement('div');
    toolbar.className = 'nd-import-preview__toolbar';

    const toolbarCopy = document.createElement('div');
    const previewTitle = document.createElement('h3');
    previewTitle.textContent = t('import.previewTitle');
    const summary = document.createElement('p');
    toolbarCopy.append(previewTitle, summary);

    const strategyLabel = document.createElement('label');
    strategyLabel.className = 'nd-field';
    const strategyTitle = document.createElement('span');
    strategyTitle.className = 'nd-field__label';
    strategyTitle.textContent = t('import.duplicateStrategy');
    const strategySelect = document.createElement('select');
    strategySelect.className = 'nd-select';
    for (const [value, key] of [
        ['overwrite', 'import.overwrite'],
        ['skip', 'import.skip'],
        ['rename', 'import.rename'],
    ]) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = t(key);
        if (value === 'overwrite') opt.selected = true;
        strategySelect.appendChild(opt);
    }
    strategyLabel.append(strategyTitle, strategySelect);

    const commitBtn = createButton({
        label: t('import.commit'),
        variant: 'primary',
        onClick: () => {
            void commitImport();
        },
    });
    const commitLabel = t('import.commit');
    const statusEl = document.createElement('p');
    statusEl.className = 'nd-import-status';
    statusEl.setAttribute('aria-live', 'polite');

    toolbar.append(toolbarCopy, strategyLabel, commitBtn, statusEl);

    const tableWrap = document.createElement('div');
    tableWrap.className = 'nd-table-scroll';
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const key of ['import.colSelect', 'import.colName', 'import.colId', 'import.colKind']) {
        const th = document.createElement('th');
        th.textContent = t(key);
        headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    const tbody = document.createElement('tbody');
    table.append(thead, tbody);
    tableWrap.appendChild(table);

    const errorBox = document.createElement('div');
    errorBox.className = 'nd-inline-error';
    errorBox.setAttribute('role', 'alert');
    errorBox.setAttribute('aria-live', 'polite');

    preview.append(toolbar, tableWrap);
    shell.append(grid, errorBox, preview);
    root.appendChild(shell);

    /** @type {object|null} */
    let pendingData = null;
    /** @type {{ item: object, checked: boolean }[]} */
    let previewRows = [];
    let destroyed = false;
    let dragDepth = 0;

    /**
     * @param {string} message
     */
    function setError(message) {
        errorBox.textContent = message == null ? '' : String(message);
    }

    /**
     * @param {object} data
     * @param {string} [sourceLabel]
     */
    function showPreview(data, sourceLabel = '') {
        pendingData = data;
        const rows = extractPreviewRows(data);
        previewRows = rows.map((item) => ({ item, checked: true }));
        summary.textContent = t('import.summary', { count: previewRows.length })
            + (sourceLabel ? ` · ${sourceLabel}` : '');

        tbody.replaceChildren();
        if (!previewRows.length) {
            setError(t('import.empty'));
        } else {
            setError('');
        }

        previewRows.forEach((row, index) => {
            const tr = document.createElement('tr');
            tr.dataset.index = String(index);

            const tdCheck = document.createElement('td');
            const check = document.createElement('input');
            check.type = 'checkbox';
            check.checked = true;
            check.addEventListener('change', () => {
                row.checked = check.checked;
            });
            tdCheck.appendChild(check);

            const meta = rowMeta(row.item);
            const tdName = document.createElement('td');
            tdName.textContent = meta.name;
            const tdId = document.createElement('td');
            tdId.textContent = meta.id;
            const tdKind = document.createElement('td');
            tdKind.textContent = meta.kind;

            tr.append(tdCheck, tdName, tdId, tdKind);
            tbody.appendChild(tr);
        });

        preview.classList.remove('nd-hidden');
    }

    /**
     * @param {string} text
     * @param {string} sourceLabel
     */
    function previewFromText(text, sourceLabel) {
        try {
            const data = JSON.parse(String(text ?? ''));
            if (data == null || typeof data !== 'object') {
                throw new Error('root must be object or array');
            }
            showPreview(/** @type {object} */ (data), sourceLabel);
        } catch (err) {
            pendingData = null;
            preview.classList.add('nd-hidden');
            tbody.replaceChildren();
            summary.textContent = '';
            setError(t('import.parseError', {
                message: err instanceof Error ? err.message : String(err),
            }));
        }
    }

    /**
     * @param {unknown} result
     * @returns {string}
     */
    function formatImportResult(result) {
        if (!result || typeof result !== 'object') {
            return t('import.done');
        }
        const rec = /** @type {{ imported?: number, skipped?: number, errors?: string[] }} */ (result);
        if (typeof rec.imported !== 'number' && typeof rec.skipped !== 'number') {
            return t('import.done');
        }
        const errors = Array.isArray(rec.errors) ? rec.errors.filter(Boolean) : [];
        const parts = [`已导入 ${rec.imported || 0}`];
        if (rec.skipped) {
            parts.push(`跳过 ${rec.skipped}`);
        }
        if (errors.length) {
            parts.push(`失败 ${errors.length}：${errors.slice(0, 2).join('；')}`);
        }
        return parts.join('，');
    }

    async function commitImport() {
        if (!importJson || !pendingData || commitBtn.disabled) return;
        setError('');
        const checked = previewRows.map((row) => Boolean(row.checked));
        const filtered = filterImportPayload(pendingData, checked);
        if (filtered == null) {
            statusEl.textContent = t('import.empty');
            setError(t('import.empty'));
            return;
        }

        const mode = strategySelect.value || 'overwrite';
        if (mode === 'overwrite') {
            const count = checked.filter(Boolean).length;
            const ok = await resolveOverwriteConfirm(count, confirmOverwriteCb);
            if (!ok) {
                statusEl.textContent = t('import.overwriteCancelled');
                setError(t('import.overwriteCancelled'));
                return;
            }
        }

        commitBtn.disabled = true;
        commitBtn.textContent = '导入中…';
        statusEl.textContent = `正在导入 ${checked.filter(Boolean).length} 条…`;
        try {
            const result = await importJson(filtered, mode);
            const line = formatImportResult(result);
            statusEl.textContent = line;
            summary.textContent = line;
            const errors = result && typeof result === 'object'
                ? /** @type {{ errors?: string[] }} */ (result).errors
                : null;
            if (Array.isArray(errors) && errors.length) {
                setError(errors.slice(0, 3).join('；'));
            } else {
                setError('');
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            statusEl.textContent = message;
            setError(message);
        } finally {
            commitBtn.disabled = false;
            commitBtn.textContent = commitLabel;
        }
    }

    /**
     * @param {File} file
     */
    async function previewFromFile(file) {
        try {
            const text = await file.text();
            previewFromText(text, file.name || 'file');
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    }

    const onFileChange = () => {
        const file = fileInput.files && fileInput.files[0];
        if (file) void previewFromFile(file);
        fileInput.value = '';
    };

    /** @param {DragEvent} event */
    const onDragEnter = (event) => {
        event.preventDefault();
        dragDepth += 1;
        drop.classList.add('is-dragging');
    };
    /** @param {DragEvent} event */
    const onDragOver = (event) => {
        event.preventDefault();
    };
    /** @param {DragEvent} event */
    const onDragLeave = (event) => {
        event.preventDefault();
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) drop.classList.remove('is-dragging');
    };
    /** @param {DragEvent} event */
    const onDrop = (event) => {
        event.preventDefault();
        dragDepth = 0;
        drop.classList.remove('is-dragging');
        const file = event.dataTransfer?.files?.[0];
        if (file) void previewFromFile(file);
    };

    fileInput.addEventListener('change', onFileChange);
    drop.addEventListener('dragenter', onDragEnter);
    drop.addEventListener('dragover', onDragOver);
    drop.addEventListener('dragleave', onDragLeave);
    drop.addEventListener('drop', onDrop);

    return {
        destroy() {
            if (destroyed) return;
            destroyed = true;
            fileInput.removeEventListener('change', onFileChange);
            drop.removeEventListener('dragenter', onDragEnter);
            drop.removeEventListener('dragover', onDragOver);
            drop.removeEventListener('dragleave', onDragLeave);
            drop.removeEventListener('drop', onDrop);
            shell.remove();
            pendingData = null;
            previewRows = [];
        },
    };
}
