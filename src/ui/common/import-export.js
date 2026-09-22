/**
 * L5 UI · 拖放 + 预览表 + 重复策略（跳过/覆盖/另存）。
 * 归属：W1-E 组件代理实现。W0 仅冻结签名。
 *
 * 只做 UI：JSON 解析与预览勾选；真正导入/导出交给 deps（W1-D 存储层）。
 */

import { t } from '../i18n/zh-CN.js';
import { createButton } from './controls.js';

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
    const keys = [
        'items', 'entries', 'characters', 'tags',
        'artists', 'presets', 'configs', 'rows',
    ];
    for (const key of keys) {
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
 * @param {object} data
 * @param {string} filename
 */
function downloadJson(data, filename) {
    const text = JSON.stringify(data, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
}

/**
 * @param {Element} root
 * @param {object} deps
 * @param {(data: object, strategy: string) => Promise<object>} deps.importJson
 * @param {() => Promise<object>} deps.exportJson
 * @returns {{ destroy: () => void }}
 */
export function mountImportExport(root, deps) {
    if (!(root instanceof Element)) {
        throw new Error('mountImportExport: root must be an Element');
    }
    const importJson = typeof deps?.importJson === 'function' ? deps.importJson : null;
    const exportJson = typeof deps?.exportJson === 'function' ? deps.exportJson : null;

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
    const strategy = document.createElement('select');
    strategy.className = 'nd-select';
    for (const [value, key] of [
        ['skip', 'import.skip'],
        ['overwrite', 'import.overwrite'],
        ['rename', 'import.rename'],
    ]) {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = t(key);
        strategy.appendChild(opt);
    }
    strategyLabel.append(strategyTitle, strategy);

    const commitBtn = createButton({
        label: t('import.commit'),
        variant: 'primary',
        onClick: () => commitImport(),
    });

    toolbar.append(toolbarCopy, strategyLabel, commitBtn);

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

    async function commitImport() {
        if (!importJson || !pendingData) return;
        setError('');
        try {
            // 存储层按整包 + strategy 处理；UI 勾选仅作预览确认信号。
            // 若全部取消勾选，则不调用导入。
            if (!previewRows.some((row) => row.checked)) {
                setError(t('import.empty'));
                return;
            }
            await importJson(pendingData, strategy.value || 'skip');
            setError('');
            summary.textContent = t('import.done');
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
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
