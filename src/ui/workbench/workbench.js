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
import { emptyNaiCaption } from '../../domain/model/nai-params.js';
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

    const sessionParams = resolveSessionParams(loadSettings());

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
        return {
            el: wrap,
            getValue: () => ta.value,
            setValue: (v) => { ta.value = v == null ? '' : String(v); },
            destroy: () => { wrap.remove(); },
        };
    })();

    const libBox = el('div', 'nd-wb-libraries');
    const libTitle = el('span', 'nd-field__label');
    setText(libTitle, '本次使用的标签库');
    libBox.appendChild(libTitle);
    /** @type {Array<{ id: string, control: ReturnType<typeof createCheckbox> }>} */
    const libChecks = [];

    async function loadLibraries() {
        const tagRepo = deps?.tagRepo;
        if (!tagRepo || typeof tagRepo.listLibraries !== 'function') return;
        try {
            const r = await tagRepo.listLibraries();
            if (!r || !r.ok || !Array.isArray(r.value)) return;
            for (const lib of r.value) {
                if (!lib || lib.id == null) continue;
                const kind = lib.kind === 'feature'
                    ? '特征库'
                    : lib.kind === 'constant'
                        ? '常驻库'
                        : '构图库';
                const control = createCheckbox({
                    label: `${String(lib.name || lib.id)}（${kind}）`,
                    checked: lib.active === true,
                });
                libChecks.push({ id: String(lib.id), control });
                libBox.appendChild(control.el);
            }
        } catch {
            /* 列表失败不阻塞手填路径 */
        }
    }

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
        initial: emptyNaiCaption(),
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
        checked: false,
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
                img.src = url;
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
            const libraryIds = libChecks
                .filter((c) => c.control.getValue())
                .map((c) => c.id);
            const input = buildWritePromptInput({
                naturalLanguage: nlField.getValue(),
                libraryIds,
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
            showPreviews(images);
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
        children: [nlField.el, libBox, writeActions, writeErr.el, unmatchedEl],
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

    void loadLibraries();

    let destroyed = false;
    return {
        destroy() {
            if (destroyed) return;
            destroyed = true;
            if (writeAbort) writeAbort.abort();
            if (genAbort) genAbort.abort();
            clearPreviews();
            writeErr.destroy();
            genErr.destroy();
            statusPill.destroy();
            nlField.destroy();
            for (const c of libChecks) c.control.destroy();
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
