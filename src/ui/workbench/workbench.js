/**
 * L5 UI · 生成工作台（需求 4.15）：写提示词与出图解耦。
 * 归属：W2-I 工作台代理实现。
 *
 * 裁决 D13：提示词状态为 NaiCaption（base 文本域 + 角色分镜可增删列表）。
 * 写出走 workbenchService.writePrompt → NaiCaption；
 * 出图走 generateImage({ caption: NaiCaption, replaceCharacterKeywords, … })。
 *
 * 只导出 mountWorkbench，由 W3 装配接线；不改 panels/drawer shell。
 */

import {
    createButton,
    createMiniAction,
    createToggle,
    createCheckbox,
    createFieldGroup,
    createDetails,
    createInlineError,
    createStatusPill,
} from '../common/controls.js';
import { createNaiParamsForm } from '../common/nai-params-form.js';
import { openModal } from '../common/modal.js';
import {
    parsePromptText,
} from '../common/prompt-text.js';
import { openSlotImageViewer } from '../common/image-viewer.js';
import { emptyNaiCaption } from '../../domain/model/nai-params.js';
import { normalizeTagLibraryKind } from '../../domain/model/tag.js';
import { parseCompositionKey } from '../../domain/model/composition-key.js';
import { mergePluginSettings } from '../../domain/model/plugin-settings.js';
import { mountCaptionEditor } from './caption-editor.js';
import {
    WORKBENCH_MAX_CHARACTERS,
    buildWritePromptInput,
    buildGenerateImageInput,
    createDecoupledWorkbenchApi,
    resolveSessionParams,
    formatUnmatchedKeys,
    isWorkbenchAbort,
    workbenchErrorMessage,
    canSubmitGenerate,
    gatePreviewUrl,
    previewUrlFromImage,
    resolvePasteArtistAction,
} from './workbench-logic.js';

const WORKBENCH_DRAFT_KEY = 'nai-dbgen:workbench-draft';

/**
 * @returns {Record<string, unknown>|null}
 */
function readWorkbenchDraft() {
    try {
        if (typeof localStorage === 'undefined') return null;
        const raw = localStorage.getItem(WORKBENCH_DRAFT_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        return data && typeof data === 'object' ? data : null;
    } catch {
        return null;
    }
}

/**
 * @param {Record<string, unknown>} data
 */
function writeWorkbenchDraft(data) {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem(WORKBENCH_DRAFT_KEY, JSON.stringify(data));
    } catch {
        /* 隐私模式或配额满时，这一次打不开也只是不记住 */
    }
}

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
 * @param {HTMLElement} node
 * @param {string} text
 */
function setText(node, text) {
    node.textContent = text == null ? '' : String(text);
}

/**
 * @param {object} [host]
 * @param {'info'|'success'|'warning'|'error'} level
 * @param {string} message
 */
function toast(host, level, message) {
    if (host && typeof host.toast === 'function') {
        host.toast(level, message);
    }
}

/**
 * @param {object} deps
 * @returns {{ writePrompt: Function, generateImage: Function }}
 */
function resolveWorkbenchService(deps) {
    if (deps?.workbenchService
        && typeof deps.workbenchService.writePrompt === 'function') {
        return deps.workbenchService;
    }
    if (deps?.workbench && typeof deps.workbench.writePrompt === 'function') {
        return deps.workbench;
    }
    throw new Error('mountWorkbench: missing workbenchService');
}

/**
 * @param {Element} root
 * @param {object} deps 含 workbenchService / tagRepo / host / loadSettings
 * @returns {{ destroy: () => void }}
 */
export function mountWorkbench(root, deps) {
    if (!(root instanceof Element)) {
        throw new Error('mountWorkbench: root must be an Element');
    }

    const host = deps?.host;
    const service = createDecoupledWorkbenchApi(resolveWorkbenchService(deps));
    const loadSettings = typeof deps?.loadSettings === 'function'
        ? deps.loadSettings
        : () => (host && typeof host.loadSettings === 'function' ? host.loadSettings() : {});
    const saveSettings = typeof deps?.saveSettings === 'function'
        ? deps.saveSettings
        : (s) => {
            if (host && typeof host.saveSettings === 'function') host.saveSettings(s);
        };
    const artistRepo = deps?.artistRepo
        || deps?.repos?.artist
        || null;

    const draft = readWorkbenchDraft();
    const sessionParams = resolveSessionParams(
        draft?.naiParams ? { naiParams: draft.naiParams } : loadSettings(),
    );

    const shell = el('div', 'nd-workbench');
    const writeErr = createInlineError();
    const genErr = createInlineError();
    const unmatchedEl = el('div', 'nd-wb-unmatched');
    unmatchedEl.setAttribute('role', 'status');
    unmatchedEl.setAttribute('aria-live', 'polite');
    unmatchedEl.hidden = true;

    const statusPill = createStatusPill({ label: '空闲', status: 'idle' });

    // ── 写提示词区（独立；绝不调 generateImage）────────────────
    const nlField = (() => {
        const wrap = el('label', 'nd-field');
        const label = el('span', 'nd-field__label');
        setText(label, '自然语言');
        /** @type {HTMLTextAreaElement} */
        const ta = /** @type {HTMLTextAreaElement} */ (el('textarea', 'nd-textarea'));
        ta.rows = 4;
        ta.placeholder = '描述想要的画面';
        wrap.append(label, ta);
        if (typeof draft?.naturalLanguage === 'string') {
            ta.value = draft.naturalLanguage;
        }
        return {
            el: wrap,
            getValue: () => ta.value,
            setValue: (v) => { ta.value = v == null ? '' : String(v); },
            destroy: () => { wrap.remove(); },
        };
    })();

    const floorToggle = createToggle({
        label: '楼内流程',
        hint: '从当前这一楼里按你的拍摄要求只画一帧，再交给生图预设，结果填回这里',
        checked: draft?.floorMode === true,
        onChange: (on) => {
            libBox.hidden = on;
        },
    });

    const libBox = el('div', 'nd-wb-libraries');
    if (draft?.floorMode === true) {
        libBox.hidden = true;
    }
    const libTitle = el('span', 'nd-field__label');
    setText(libTitle, '本次使用的条目');
    const libHint = el('p', 'nd-muted');
    setText(libHint, '只发送勾中的条目。勾库或分类会选中其下全部条目。');
    const searchWrap = el('div', 'nd-search-field nd-wb-lib-search');
    const searchInput = /** @type {HTMLInputElement} */ (el('input'));
    searchInput.type = 'search';
    searchInput.placeholder = '搜索名称或正文';
    searchInput.setAttribute('aria-label', '搜索名称或正文');
    searchInput.autocomplete = 'off';
    searchWrap.appendChild(searchInput);
    let onlyPicked = false;
    const onlyPickedBox = createCheckbox({
        label: '只看已勾选',
        checked: false,
        onChange: (on) => {
            onlyPicked = on;
            applyEntryFilter();
        },
    });
    const filterRow = el('div', 'nd-wb-lib-tools');
    filterRow.append(searchWrap, onlyPickedBox.el);
    const searchEmpty = el('p', 'nd-muted nd-wb-lib-empty');
    setText(searchEmpty, '没有匹配的条目');
    searchEmpty.hidden = true;
    const libList = el('div', 'nd-wb-lib-list');
    libBox.append(libTitle, libHint, filterRow, searchEmpty, libList);
    /** @type {{ id: string, entryIds: string[] }[]} */
    const libGroups = [];
    /** @type {Map<string, boolean>} */
    const picked = new Map();
    /** @type {Array<{ destroy: () => void }>} */
    const libControls = [];
    libControls.push(onlyPickedBox);

    /**
     * @param {ReturnType<typeof createCheckbox>} control
     * @param {boolean} on
     * @param {boolean} partial
     */
    function paintCheck(control, on, partial) {
        control.setValue(on && !partial);
        const input = control.el.querySelector('input');
        if (input) input.indeterminate = partial;
    }

    /**
     * @param {string[]} ids
     */
    function countPicked(ids) {
        let n = 0;
        for (const id of ids) {
            if (picked.get(id) === true) n += 1;
        }
        return n;
    }

    function syncGroupChecks() {
        for (const group of libGroups) {
            const n = countPicked(group.entryIds);
            const total = group.entryIds.length;
            paintCheck(group.control, total > 0 && n === total, n > 0 && n < total);
            setText(group.count, total ? `${n}/${total}` : '0');
            for (const cat of group.categories) {
                const cn = countPicked(cat.entryIds);
                const ct = cat.entryIds.length;
                paintCheck(cat.control, ct > 0 && cn === ct, cn > 0 && cn < ct);
                setText(cat.count, ct ? `${cn}/${ct}` : '0');
            }
            for (const row of group.rows) {
                row.control.setValue(picked.get(row.id) === true);
            }
        }
    }

    /**
     * @param {string[]} ids
     * @param {boolean} on
     */
    function setPicked(ids, on) {
        for (const id of ids) picked.set(id, on);
        syncGroupChecks();
        if (onlyPicked) applyEntryFilter();
    }

    /**
     * @param {object[]} entries
     * @param {string} kind
     * @returns {{ title: string, entries: object[] }[]}
     */
    function groupEntries(entries, kind) {
        if (kind !== 'composition') {
            return [{ title: '', entries }];
        }
        /** @type {Map<string, object[]>} */
        const map = new Map();
        for (const entry of entries) {
            const parsed = parseCompositionKey(entry?.key);
            const title = parsed.ok ? parsed.value.category : '未分类';
            if (!map.has(title)) map.set(title, []);
            map.get(title).push(entry);
        }
        return [...map.entries()].map(([title, list]) => ({ title, entries: list }));
    }

    /**
     * @param {object} entry
     * @param {string} kind
     * @returns {string}
     */
    function entryLabel(entry, kind) {
        const key = String(entry?.key ?? entry?.id ?? '');
        let label = key;
        if (kind === 'composition') {
            const parsed = parseCompositionKey(key);
            if (parsed.ok) label = parsed.value.name;
        }
        return entry?.active === false ? `${label}（已关闭）` : label;
    }

    /**
     * @param {object} entry
     * @param {string} kind
     * @returns {string}
     */
    function entryHaystack(entry, kind) {
        return [
            entryLabel(entry, kind),
            entry?.key,
            entry?.value,
            entry?.secondaryKey,
        ].map((part) => String(part ?? '')).join('\n').toLowerCase();
    }

    /**
     * @param {HTMLElement} body
     * @param {HTMLElement} toggle
     * @param {boolean} open
     */
    function setSectionOpen(body, toggle, open) {
        body.hidden = !open;
        toggle.textContent = open ? '收起' : '展开';
    }

    /**
     * @param {HTMLElement} host
     * @param {object[]} entries
     * @param {string} kind
     * @param {{ rows: { id: string, control: ReturnType<typeof createCheckbox> }[] }} bucket
     */
    function paintEntries(host, entries, kind, bucket) {
        host.replaceChildren();
        for (const entry of entries) {
            if (!entry || entry.id == null) continue;
            const id = String(entry.id);
            const control = createCheckbox({
                label: entryLabel(entry, kind),
                checked: picked.get(id) === true,
                onChange: (on) => {
                    picked.set(id, on);
                    syncGroupChecks();
                    if (onlyPicked) applyEntryFilter();
                },
            });
            libControls.push(control);
            const wrap = el('div', 'nd-wb-entry');
            wrap.appendChild(control.el);
            const value = String(entry?.value ?? '').trim();
            if (value) {
                const body = el('div', 'nd-wb-entry__value');
                setText(body, value);
                wrap.appendChild(body);
            }
            const row = { id, control, el: wrap, haystack: entryHaystack(entry, kind) };
            bucket.rows.push(row);
            if (Array.isArray(bucket.local)) bucket.local.push(row);
            host.appendChild(wrap);
        }
    }

    async function loadLibraries() {
        const tagRepo = deps?.tagRepo;
        if (!tagRepo || typeof tagRepo.listLibraries !== 'function') return;
        let libraries = [];
        try {
            const r = await tagRepo.listLibraries();
            if (r?.ok && Array.isArray(r.value)) libraries = r.value;
        } catch {
            return;
        }
        for (const lib of libraries) {
            if (!lib || lib.id == null) continue;
            const kind = normalizeTagLibraryKind(lib.kind);
            const kindText = kind === 'feature' ? '特征库' : kind === 'constant' ? '常驻库' : '构图库';
            /** @type {object[]} */
            let entries = [];
            if (typeof tagRepo.listEntries === 'function') {
                try {
                    const er = await tagRepo.listEntries(lib.id);
                    if (er?.ok && Array.isArray(er.value)) entries = er.value.filter((entry) => entry && entry.id != null);
                } catch {
                    entries = [];
                }
            }
            for (const entry of entries) picked.set(String(entry.id), false);

            const entryIds = entries.map((entry) => String(entry.id));
            const head = el('div', 'nd-wb-lib__head');
            const control = createCheckbox({
                label: `${String(lib.name || lib.id)}（${kindText}）`,
                checked: false,
                onChange: (on) => setPicked(entryIds, on),
            });
            libControls.push(control);
            const count = el('span', 'nd-muted');
            setText(count, entryIds.length ? `0/${entryIds.length}` : '0');
            head.append(control.el, count);

            const body = el('div', 'nd-wb-lib__body');
            body.hidden = true;
            /** @type {{ title: string, entryIds: string[], entries: object[], kind: string, control: ReturnType<typeof createCheckbox>, count: HTMLElement, head: HTMLElement, body: HTMLElement, toggle: HTMLElement, rows: { id: string, control: ReturnType<typeof createCheckbox>, haystack: string }[], painted: boolean, userOpen: boolean }[]} */
            const categories = [];
            /** @type {{ id: string, control: ReturnType<typeof createCheckbox>, haystack: string }[]} */
            const rows = [];
            /** @type {{ id: string, control: ReturnType<typeof createCheckbox>, haystack: string }[]} */
            const looseRows = [];
            const grouped = groupEntries(entries, kind);
            for (const cat of grouped) {
                const catIds = cat.entries.map((entry) => String(entry.id));
                if (!cat.title) {
                    paintEntries(body, cat.entries, kind, { rows, local: looseRows });
                    continue;
                }
                const catHead = el('div', 'nd-wb-cat__head');
                const catControl = createCheckbox({
                    label: cat.title,
                    checked: false,
                    onChange: (on) => setPicked(catIds, on),
                });
                libControls.push(catControl);
                const catCount = el('span', 'nd-muted');
                setText(catCount, catIds.length ? `0/${catIds.length}` : '0');
                const catBody = el('div', 'nd-wb-cat__body');
                catBody.hidden = true;
                /** @type {{ title: string, entryIds: string[], entries: object[], kind: string, control: ReturnType<typeof createCheckbox>, count: HTMLElement, head: HTMLElement, body: HTMLElement, toggle: HTMLElement, rows: { id: string, control: ReturnType<typeof createCheckbox>, haystack: string }[], painted: boolean, userOpen: boolean }} */
                const catState = {
                    title: cat.title,
                    entryIds: catIds,
                    entries: cat.entries,
                    kind,
                    control: catControl,
                    count: catCount,
                    head: catHead,
                    body: catBody,
                    toggle: /** @type {HTMLElement} */ (document.createElement('button')),
                    rows: [],
                    painted: false,
                    userOpen: false,
                };
                const toggle = createMiniAction({
                    label: '展开',
                    onClick: () => {
                        catState.userOpen = catState.body.hidden;
                        if (catState.userOpen) paintCategory(catState);
                        if (String(searchInput.value || '').trim()) {
                            setSectionOpen(catState.body, catState.toggle, catState.userOpen);
                            return;
                        }
                        applyEntryFilter();
                    },
                });
                catState.toggle = toggle;
                catHead.append(catControl.el, catCount, toggle);
                body.append(catHead, catBody);
                categories.push(catState);
            }

            const libToggle = createMiniAction({
                label: '展开',
                onClick: () => {
                    const group = libGroups.find((item) => item.body === body);
                    if (!group) return;
                    group.userOpen = group.body.hidden;
                    if (String(searchInput.value || '').trim()) {
                        setSectionOpen(group.body, group.toggle, group.userOpen);
                        return;
                    }
                    applyEntryFilter();
                },
            });
            head.appendChild(libToggle);
            const block = el('div', 'nd-wb-lib');
            block.append(head, body);
            libList.appendChild(block);
            libGroups.push({
                id: String(lib.id),
                haystack: `${String(lib.name || lib.id)} ${kindText}`.toLowerCase(),
                entryIds,
                control,
                count,
                categories,
                rows,
                looseRows,
                block,
                body,
                toggle: libToggle,
                userOpen: false,
            });
        }
        if (Array.isArray(draft?.entryIds) && draft.entryIds.length) {
            setPicked(draft.entryIds.map((id) => String(id)), true);
        }
        applyEntryFilter();
    }

    /**
     * @param {{ body: HTMLElement, entries: object[], kind: string, rows: { id: string, control: ReturnType<typeof createCheckbox>, haystack: string }[], painted: boolean }} cat
     */
    function paintCategory(cat) {
        if (cat.painted) return;
        cat.painted = true;
        const group = libGroups.find((item) => item.categories.includes(cat));
        paintEntries(cat.body, cat.entries, cat.kind, {
            rows: group ? group.rows : cat.rows,
            local: cat.rows,
        });
    }

    /**
     * @param {string} haystack
     * @param {string} q
     * @param {boolean} libHit
     * @param {boolean} titleHit
     * @returns {boolean}
     */
    function textMatches(haystack, q, libHit, titleHit) {
        if (!q) return true;
        if (libHit || titleHit) return true;
        return haystack.includes(q);
    }

    /**
     * @param {string} id
     * @param {string} haystack
     * @param {string} q
     * @param {boolean} libHit
     * @param {boolean} titleHit
     * @returns {boolean}
     */
    function rowShown(id, haystack, q, libHit, titleHit) {
        if (onlyPicked && picked.get(id) !== true) return false;
        return textMatches(haystack, q, libHit, titleHit);
    }

    /**
     * 搜索或「只看已勾选」时展开命中的库和分类。两个条件都空时回到原先的展开状态。
     */
    function applyEntryFilter() {
        const q = String(searchInput.value || '').trim().toLowerCase();
        const filtering = Boolean(q) || onlyPicked;
        let anyVisible = !filtering;
        for (const group of libGroups) {
            const libHit = Boolean(q) && group.haystack.includes(q);
            let groupVisible = false;
            for (const row of group.looseRows) {
                const hit = rowShown(row.id, row.haystack, q, libHit, false);
                (row.el || row.control.el).hidden = !hit;
                if (hit) groupVisible = true;
            }
            for (const cat of group.categories) {
                const titleHit = Boolean(q) && cat.title.toLowerCase().includes(q);
                const wantPaint = filtering && cat.entries.some((entry) => rowShown(
                    String(entry.id),
                    entryHaystack(entry, cat.kind),
                    q,
                    libHit,
                    titleHit,
                ));
                if (wantPaint) paintCategory(cat);
                let catVisible = !filtering;
                if (cat.painted) {
                    catVisible = false;
                    for (const row of cat.rows) {
                        const hit = rowShown(row.id, row.haystack, q, libHit, titleHit);
                        (row.el || row.control.el).hidden = !hit;
                        if (hit) catVisible = true;
                    }
                }
                if (cat.head) cat.head.hidden = filtering && !catVisible;
                if (filtering) setSectionOpen(cat.body, cat.toggle, catVisible);
                else setSectionOpen(cat.body, cat.toggle, cat.userOpen);
                if (catVisible) groupVisible = true;
            }
            group.block.hidden = filtering && !groupVisible;
            if (filtering) setSectionOpen(group.body, group.toggle, groupVisible);
            else setSectionOpen(group.body, group.toggle, group.userOpen);
            if (groupVisible) anyVisible = true;
        }
        setText(searchEmpty, onlyPicked && !q ? '没有已勾选的条目' : '没有匹配的条目');
        searchEmpty.hidden = !filtering || anyVisible || libGroups.length === 0;
    }
    searchInput.addEventListener('input', applyEntryFilter);

    /** @type {AbortController|null} */
    let writeAbort = null;
    /** @type {boolean} */
    let writing = false;

    const writeBtn = createButton({
        label: '写提示词',
        variant: 'primary',
        onClick: () => { void onWritePrompt(); },
    });
    const writeCancelBtn = createButton({
        label: '取消',
        variant: 'ghost',
        onClick: () => {
            if (writeAbort) writeAbort.abort();
        },
    });
    writeCancelBtn.disabled = true;

    // ── Caption 编辑器（手填 / 自动生成共用同一结构）────────────
    const captionMount = el('div', 'nd-wb-caption-mount');
    const captionEditor = mountCaptionEditor(captionMount, {
        initial: draft?.caption && typeof draft.caption === 'object'
            ? draft.caption
            : emptyNaiCaption(),
    });

    const captionToolbar = el('div', 'nd-wb-caption-toolbar');
    const pasteBtn = createButton({
        label: '粘贴提示词',
        variant: 'ghost',
        onClick: () => { void onPastePrompt(); },
    });
    captionToolbar.appendChild(pasteBtn);

    /**
     * @returns {Promise<string|null>}
     */
    async function readClipboardText() {
        try {
            if (typeof navigator !== 'undefined'
                && navigator.clipboard
                && typeof navigator.clipboard.readText === 'function') {
                return await navigator.clipboard.readText();
            }
        } catch {
            // fall through
        }
        return null;
    }

    /**
     * 剪贴板不可用时弹出文本框让用户手动粘贴。
     * @returns {Promise<string|null>}
     */
    function promptManualPaste() {
        return new Promise((resolve) => {
            const wrap = el('div', 'nd-wb-paste-fallback');
            const hint = el('p', 'nd-muted');
            setText(hint, '无法读取剪贴板，请把提示词粘贴到下方后确认。');
            /** @type {HTMLTextAreaElement} */
            const ta = /** @type {HTMLTextAreaElement} */ (el('textarea', 'nd-textarea'));
            ta.rows = 12;
            ta.placeholder = '场景\n正面：…';
            const actions = el('div', 'nd-wb-actions');
            let settled = false;
            /** @type {{ destroy: () => void }|null} */
            let modalHandle = null;

            const finish = (value) => {
                if (settled) return;
                settled = true;
                try { modalHandle?.destroy(); } catch { /* ignore */ }
                resolve(value);
            };

            const cancelBtn = createButton({
                label: '取消',
                variant: 'ghost',
                onClick: () => finish(null),
            });
            const okBtn = createButton({
                label: '确认',
                variant: 'primary',
                onClick: () => finish(ta.value),
            });
            actions.append(okBtn, cancelBtn);
            wrap.append(hint, ta, actions);

            void openModal({ host }, {
                title: '粘贴提示词',
                element: wrap,
                wide: true,
                allowVerticalScrolling: true,
            }).then((h) => {
                modalHandle = h;
            }).catch(() => {
                finish(null);
            });
        });
    }

    /**
     * @returns {Promise<object[]>}
     */
    async function listArtists() {
        if (!artistRepo || typeof artistRepo.list !== 'function') return [];
        try {
            const result = await artistRepo.list();
            if (result && result.ok && Array.isArray(result.value)) {
                return result.value;
            }
        } catch {
            /* ignore */
        }
        return [];
    }

    /**
     * @param {string} text
     */
    async function applyPastedText(text) {
        const parsed = parsePromptText(text, { maxCharacters: WORKBENCH_MAX_CHARACTERS });
        if (!parsed.ok) {
            toast(host, 'error', parsed.error?.message || '剪贴板里不是提示词');
            return;
        }
        captionEditor.setCaption(parsed.value.caption);

        const artists = await listArtists();
        const side = resolvePasteArtistAction(parsed.value, artists);
        if (side.truncateMessage) {
            toast(host, 'warning', side.truncateMessage);
        }
        toast(host, 'success', '已粘贴');
        persistWorkbenchDraft();

        if (side.artistAction === 'matched' && side.matchedArtist) {
            const next = mergePluginSettings(loadSettings(), {
                activeArtistId: side.matchedArtist.id,
            });
            saveSettings(next);
            toast(host, 'success', `已切换画师串：${side.matchedArtist.name}`);
        } else if (side.artistAction === 'missing') {
            toast(host, 'warning', '画师串库里没有这一串，未切换');
        }
    }

    async function onPastePrompt() {
        let text = await readClipboardText();
        if (text == null) {
            text = await promptManualPaste();
        }
        if (text == null) return;
        await applyPastedText(text);
    }

    // ── 出图区（独立；绝不调 writePrompt）──────────────────────
    // replaceCharacterKeywords：用户显式控件，程序绝不推断
    const replaceToggle = createToggle({
        label: '替换角色关键字',
        hint: '把提示词里的角色关键字换成该角色固定特征后再出图',
        checked: draft?.replaceCharacterKeywords === true,
    });

    // 4.13 共用组件（与运行配置同一套）
    const paramsForm = createNaiParamsForm(sessionParams);

    function readParams() {
        return paramsForm.getValue();
    }

    /** @type {AbortController|null} */
    let genAbort = null;
    /** @type {boolean} */
    let generating = false;
    /** @type {Array<() => void>} */
    const previewRevokers = [];
    const imageRepo = deps?.imageRepo || null;
    /** @type {string[]} */
    let savedImageRefs = Array.isArray(draft?.imageRefs)
        ? draft.imageRefs.map((id) => String(id)).filter(Boolean)
        : [];

    const previewBox = el('div', 'nd-wb-preview');
    const previewHint = el('p', 'nd-muted');
    setText(previewHint, '出图结果将显示在这里');
    previewBox.appendChild(previewHint);

    const genBtn = createButton({
        label: '出图',
        variant: 'primary',
        onClick: () => { void onGenerateImage(); },
    });
    const genCancelBtn = createButton({
        label: '取消出图',
        variant: 'ghost',
        onClick: () => {
            if (genAbort) genAbort.abort();
        },
    });
    genCancelBtn.disabled = true;

    function setUnmatched(keys) {
        const text = formatUnmatchedKeys(keys);
        if (!text) {
            unmatchedEl.hidden = true;
            setText(unmatchedEl, '');
            return;
        }
        unmatchedEl.hidden = false;
        setText(unmatchedEl, text);
    }

    function clearPreviews() {
        while (previewRevokers.length) {
            const revoke = previewRevokers.pop();
            try { revoke?.(); } catch { /* ignore */ }
        }
        previewBox.replaceChildren();
        previewBox.appendChild(previewHint);
        setText(previewHint, '出图结果将显示在这里');
        previewHint.hidden = false;
    }

    /**
     * @param {Array<{ blob?: Blob, mimeType?: string }>} images
     */
    function showPreviews(images) {
        clearPreviews();
        previewHint.hidden = true;
        if (!Array.isArray(images) || images.length === 0) {
            setText(previewHint, '未返回图片');
            previewHint.hidden = false;
            return;
        }
        for (let i = 0; i < images.length; i += 1) {
            const image = images[i];
            const { url, revoke } = previewUrlFromImage(image);
            previewRevokers.push(revoke);
            const card = el('div', 'nd-wb-preview__card');
            if (url && gatePreviewUrl(url)) {
                const img = document.createElement('img');
                img.className = 'nd-wb-preview__img';
                img.alt = `预览 ${i + 1}`;
                img.title = '点击查看大图';
                img.tabIndex = 0;
                img.src = url;
                const openLarge = () => {
                    void openSlotImageViewer({ host }, {
                        url,
                        title: `预览 ${i + 1}`,
                        alt: `预览 ${i + 1}`,
                    });
                };
                img.addEventListener('click', openLarge);
                img.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openLarge();
                    }
                });
                card.appendChild(img);
                const dl = document.createElement('a');
                dl.className = 'nd-button nd-button--ghost';
                dl.href = url;
                dl.download = `nai-dbgen-workbench-${i + 1}.${image?.mimeType === 'image/webp' ? 'webp' : 'png'}`;
                setText(dl, '下载');
                card.appendChild(dl);
            } else {
                const bad = el('p', 'nd-muted');
                setText(bad, '图片地址不安全，已拦截');
                card.appendChild(bad);
            }
            previewBox.appendChild(card);
        }
    }

    function setWritingUi(on) {
        writing = on;
        writeBtn.disabled = on;
        writeCancelBtn.disabled = !on;
        if (on) {
            statusPill.setStatus('online');
            statusPill.setLabel('正在写提示词…');
        } else if (!generating) {
            statusPill.setStatus('idle');
            statusPill.setLabel('空闲');
        }
    }

    function setGeneratingUi(on) {
        generating = on;
        // 进行中禁按钮，防重复计费
        genBtn.disabled = !canSubmitGenerate(on);
        genCancelBtn.disabled = !on;
        if (on) {
            statusPill.setStatus('online');
            statusPill.setLabel('正在出图…');
        } else if (!writing) {
            statusPill.setStatus('idle');
            statusPill.setLabel('空闲');
        }
    }

    async function onWritePrompt() {
        if (writing) return;
        writeErr.clear();
        setUnmatched([]);
        writeAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
        setWritingUi(true);
        try {
            const entryIds = [];
            const libraryIds = [];
            for (const group of libGroups) {
                const ids = group.entryIds.filter((id) => picked.get(id) === true);
                if (!ids.length) continue;
                libraryIds.push(group.id);
                entryIds.push(...ids);
            }
            const input = buildWritePromptInput({
                naturalLanguage: nlField.getValue(),
                libraryIds,
                entryIds,
                mode: floorToggle.getValue() ? 'floor' : 'entries',
                signal: writeAbort?.signal,
            });
            // 只走 writePrompt；createDecoupledWorkbenchApi 保证不碰 generateImage
            const result = await service.writePrompt(input);
            if (isWorkbenchAbort(result) || isWorkbenchAbort(result?.error)) {
                // Abort 不是失败
                return;
            }
            if (!result || result.ok !== true) {
                const msg = workbenchErrorMessage(result);
                writeErr.setMessage(msg);
                statusPill.setStatus('error');
                statusPill.setLabel('写提示词失败');
                toast(host, 'error', msg);
                return;
            }
            captionEditor.setCaption(result.value.caption);
            if (result.value.width != null && result.value.height != null) {
                const cur = paramsForm.getValue();
                paramsForm.setValue({
                    ...cur,
                    width: result.value.width,
                    height: result.value.height,
                });
            }
            setUnmatched(result.value.unmatchedKeys);
            if (Array.isArray(result.value.unmatchedKeys) && result.value.unmatchedKeys.length > 0) {
                toast(host, 'warning', formatUnmatchedKeys(result.value.unmatchedKeys));
            } else {
                toast(host, 'success', '提示词已填入工作台');
            }
            persistWorkbenchDraft();
        } catch (err) {
            if (isWorkbenchAbort(err)) return;
            const msg = workbenchErrorMessage(err);
            writeErr.setMessage(msg);
            toast(host, 'error', msg);
        } finally {
            writeAbort = null;
            setWritingUi(false);
        }
    }

    async function onGenerateImage() {
        // 重复提交门禁：进行中直接忽略
        if (!canSubmitGenerate(generating)) return;
        genErr.clear();
        genAbort = typeof AbortController !== 'undefined' ? new AbortController() : null;
        setGeneratingUi(true);
        try {
            // replaceCharacterKeywords 只读开关；与提示词来源无关
            const input = buildGenerateImageInput({
                caption: captionEditor.getCaption(),
                replaceCharacterKeywords: replaceToggle.getValue(),
                params: readParams(),
                signal: genAbort?.signal,
            });
            // 只走 generateImage；不经 LLM / writePrompt
            const result = await service.generateImage(input);
            if (isWorkbenchAbort(result) || isWorkbenchAbort(result?.error)) {
                return;
            }
            if (!result || result.ok !== true) {
                const msg = workbenchErrorMessage(result);
                genErr.setMessage(msg);
                statusPill.setStatus('error');
                statusPill.setLabel('出图失败');
                toast(host, 'error', msg);
                return;
            }
            const images = Array.isArray(result.value) ? result.value : [];
            await rememberPreviews(images);
            showPreviews(images);
            persistWorkbenchDraft();
            toast(host, 'success', `已生成 ${images.length} 张`);
        } catch (err) {
            if (isWorkbenchAbort(err)) return;
            const msg = workbenchErrorMessage(err);
            genErr.setMessage(msg);
            toast(host, 'error', msg);
        } finally {
            genAbort = null;
            setGeneratingUi(false);
        }
    }

    // ── 拼装 DOM ──────────────────────────────────────────────
    const writeActions = el('div', 'nd-wb-actions');
    writeActions.append(writeBtn, writeCancelBtn);

    const writeSection = createFieldGroup({
        title: '写提示词',
        children: [nlField.el, floorToggle.el, libBox, writeActions, writeErr.el, unmatchedEl],
    });

    const captionSection = createFieldGroup({
        title: '当前提示词',
        children: [captionToolbar, captionMount],
    });

    const paramsDetails = createDetails({
        summary: '本次出图参数',
        open: false,
        body: [paramsForm.el],
    });

    const genActions = el('div', 'nd-wb-actions');
    genActions.append(genBtn, genCancelBtn);

    const genSection = createFieldGroup({
        title: '用当前提示词出图',
        children: [
            replaceToggle.el,
            paramsDetails.el,
            genActions,
            genErr.el,
            previewBox,
        ],
    });

    const header = el('div', 'nd-wb-header');
    // 弹层 `.nd-popup-header` 已有「生成工作台」标题 + ×；此处只放状态
    header.append(statusPill.el);

    shell.append(header, writeSection.el, captionSection.el, genSection.el);
    root.appendChild(shell);

    function persistWorkbenchDraft() {
        const entryIds = [];
        for (const [id, on] of picked) {
            if (on) entryIds.push(id);
        }
        const savedEntryIds = entryIds.length || picked.size
            ? entryIds
            : (Array.isArray(draft?.entryIds) ? draft.entryIds.map((id) => String(id)) : []);
        writeWorkbenchDraft({
            naturalLanguage: nlField.getValue(),
            floorMode: floorToggle.getValue(),
            entryIds: savedEntryIds,
            caption: captionEditor.getCaption(),
            replaceCharacterKeywords: replaceToggle.getValue(),
            naiParams: paramsForm.getValue(),
            imageRefs: savedImageRefs,
        });
    }

    shell.addEventListener('input', persistWorkbenchDraft);
    shell.addEventListener('change', persistWorkbenchDraft);

    void loadLibraries();

    let destroyed = false;
    void restorePreviews();

    /**
     * 出图结果写入图片库并钉住，避免被缓存上限清掉。下一轮出图换掉上一轮。
     * @param {Array<{ blob?: Blob, mimeType?: string }>} images
     */
    async function rememberPreviews(images) {
        if (!imageRepo || typeof imageRepo.put !== 'function') return;
        const next = [];
        for (const image of images) {
            if (!image?.blob) continue;
            try {
                const put = await imageRepo.put(image.blob, { pinned: true });
                if (put?.ok && put.value) next.push(String(put.value));
            } catch {
                /* 存不上就只在这一次里显示 */
            }
        }
        if (!next.length) return;
        const prev = savedImageRefs;
        savedImageRefs = next;
        if (typeof imageRepo.remove === 'function') {
            for (const ref of prev) {
                if (next.includes(ref)) continue;
                try { await imageRepo.remove(ref); } catch { /* ignore */ }
            }
        }
    }

    async function restorePreviews() {
        if (!savedImageRefs.length || !imageRepo || typeof imageRepo.getBlob !== 'function') return;
        const images = [];
        const kept = [];
        for (const ref of savedImageRefs) {
            try {
                const got = await imageRepo.getBlob(ref);
                const blob = got?.ok ? got.value : null;
                if (!blob) continue;
                images.push({ blob, mimeType: blob.type || '' });
                kept.push(ref);
            } catch {
                /* 这一张读不出来就跳过 */
            }
        }
        if (kept.length !== savedImageRefs.length) {
            savedImageRefs = kept;
            persistWorkbenchDraft();
        }
        if (destroyed || !images.length) return;
        showPreviews(images);
    }
    return {
        destroy() {
            if (destroyed) return;
            persistWorkbenchDraft();
            destroyed = true;
            if (writeAbort) writeAbort.abort();
            if (genAbort) genAbort.abort();
            clearPreviews();
            writeErr.destroy();
            genErr.destroy();
            statusPill.destroy();
            nlField.destroy();
            floorToggle.destroy();
            searchInput.removeEventListener('input', applyEntryFilter);
            for (const c of libControls) c.destroy();
            captionEditor.destroy();
            replaceToggle.destroy();
            paramsForm.destroy();
            paramsDetails.destroy();
            writeSection.destroy();
            captionSection.destroy();
            genSection.destroy();
            shell.remove();
        },
    };
}
