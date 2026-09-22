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
    createField,
    createNumberField,
    createSelect,
    createFieldGroup,
    createDetails,
    createInlineError,
    createStatusPill,
} from '../common/controls.js';
import { defaultNaiParams, emptyNaiCaption } from '../../domain/model/nai-params.js';
import { mountCaptionEditor } from './caption-editor.js';
import {
    buildWritePromptInput,
    buildGenerateImageInput,
    createDecoupledWorkbenchApi,
    resolveSessionParams,
    assembleWorkbenchNaiParams,
    formatUnmatchedKeys,
    isWorkbenchAbort,
    workbenchErrorMessage,
    workbenchErrorTraceId,
    canSubmitGenerate,
    gatePreviewUrl,
    previewUrlFromImage,
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
        setText(label, '自然语言（写提示词用）');
        /** @type {HTMLTextAreaElement} */
        const ta = /** @type {HTMLTextAreaElement} */ (el('textarea', 'nd-textarea'));
        ta.rows = 4;
        ta.placeholder = '描述想要的画面；也可留空后直接手填下方结构化提示词';
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
    setText(libTitle, '本次勾选的标签库（不改全局激活）');
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
                const control = createCheckbox({
                    label: String(lib.name || lib.id),
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

    // ── 出图区（独立；绝不调 writePrompt）──────────────────────
    // replaceCharacterKeywords：用户显式控件，程序绝不推断
    const replaceToggle = createToggle({
        label: '是否替换角色关键字',
        checked: false,
    });

    // 4.13 控件：默认值一律取自 domain（与 trigger-panel 选型对齐，D47）
    const defaults = defaultNaiParams();
    const model = createField({
        label: '模型',
        value: String(sessionParams.model ?? defaults.model),
    });
    const width = createNumberField({
        label: '宽',
        value: Number(sessionParams.width ?? defaults.width),
        min: 64,
        max: 2048,
        step: 64,
    });
    const height = createNumberField({
        label: '高',
        value: Number(sessionParams.height ?? defaults.height),
        min: 64,
        max: 2048,
        step: 64,
    });
    const steps = createNumberField({
        label: 'steps',
        value: Number(sessionParams.steps ?? defaults.steps),
        min: 1,
        max: 50,
        step: 1,
    });
    const scale = createNumberField({
        label: 'scale',
        value: Number(sessionParams.scale ?? defaults.scale),
        min: 0,
        max: 10,
        step: 0.1,
    });
    const sampler = createField({
        label: 'sampler',
        value: String(sessionParams.sampler ?? defaults.sampler),
    });
    const noise = createField({
        label: 'noise_schedule',
        value: String(sessionParams.noise_schedule ?? defaults.noise_schedule),
    });
    const seed = createNumberField({
        label: 'seed',
        value: Number(sessionParams.seed ?? defaults.seed),
        min: 0,
        max: 4294967295,
        step: 1,
    });
    const seedRandom = createCheckbox({
        label: '随机 seed',
        checked: sessionParams.seedRandom !== false,
    });
    const imageFormat = createSelect({
        label: '图片格式',
        value: sessionParams.image_format === 'webp' ? 'webp' : 'png',
        options: [
            { value: 'png', label: 'png' },
            { value: 'webp', label: 'webp' },
        ],
    });
    const qualityToggle = createCheckbox({
        label: 'qualityToggle',
        checked: sessionParams.qualityToggle !== false,
    });
    const tagHintQt = createCheckbox({
        label: 'tag_hint_qt',
        checked: sessionParams.tag_hint_qt !== false,
    });
    const ucPreset = createNumberField({
        label: 'ucPreset',
        value: Number(sessionParams.ucPreset ?? defaults.ucPreset),
        min: 0,
        max: 10,
        step: 1,
    });
    const tagHintUc = createCheckbox({
        label: 'tag_hint_uc_preset',
        checked: sessionParams.tag_hint_uc_preset !== false,
    });
    const cfgRescale = createNumberField({
        label: 'cfg_rescale',
        value: Number(sessionParams.cfg_rescale ?? defaults.cfg_rescale),
        min: 0,
        max: 1,
        step: 0.01,
    });
    const varietyEnabled = createCheckbox({
        label: '启用 Variety（skip_cfg_above_sigma）',
        checked: sessionParams.skip_cfg_above_sigma != null,
    });
    const varietySigma = createNumberField({
        label: 'skip_cfg_above_sigma',
        value: sessionParams.skip_cfg_above_sigma == null
            ? 0
            : Number(sessionParams.skip_cfg_above_sigma),
        min: 0,
        max: 100,
        step: 0.1,
    });
    const sm = createCheckbox({
        label: 'sm（SMEA）',
        checked: sessionParams.sm === true,
    });
    const smDyn = createCheckbox({
        label: 'sm_dyn',
        checked: sessionParams.sm_dyn === true,
    });
    const straightAlpha = createCheckbox({
        label: 'straight_alpha',
        checked: sessionParams.straight_alpha === true,
    });
    const tagHintTransparent = createCheckbox({
        label: 'tag_hint_transparent_background',
        checked: sessionParams.tag_hint_transparent_background === true,
    });
    const qualityStrategy = createSelect({
        label: 'qualityStrategy',
        value: sessionParams.qualityStrategy === 'caption' ? 'caption' : 'field',
        options: [
            { value: 'field', label: 'field' },
            { value: 'caption', label: 'caption' },
        ],
    });

    function readParams() {
        return assembleWorkbenchNaiParams(sessionParams, {
            model: model.getValue(),
            width: width.getValue(),
            height: height.getValue(),
            steps: steps.getValue(),
            scale: scale.getValue(),
            sampler: sampler.getValue(),
            noise_schedule: noise.getValue(),
            seed: seed.getValue(),
            seedRandom: seedRandom.getValue(),
            image_format: imageFormat.getValue(),
            qualityToggle: qualityToggle.getValue(),
            tag_hint_qt: tagHintQt.getValue(),
            ucPreset: ucPreset.getValue(),
            tag_hint_uc_preset: tagHintUc.getValue(),
            cfg_rescale: cfgRescale.getValue(),
            varietyEnabled: varietyEnabled.getValue(),
            skip_cfg_above_sigma: varietySigma.getValue(),
            sm: sm.getValue(),
            sm_dyn: smDyn.getValue(),
            straight_alpha: straightAlpha.getValue(),
            tag_hint_transparent_background: tagHintTransparent.getValue(),
            qualityStrategy: qualityStrategy.getValue(),
        });
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
                const tid = workbenchErrorTraceId(result);
                writeErr.setMessage(tid ? `${msg}（${tid}）` : msg);
                statusPill.setStatus('error');
                statusPill.setLabel('写提示词失败');
                toast(host, 'error', msg);
                return;
            }
            captionEditor.setCaption(result.value.caption);
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
                const tid = workbenchErrorTraceId(result);
                genErr.setMessage(tid ? `${msg}（${tid}）` : msg);
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
        title: '写提示词（不出图）',
        children: [nlField.el, libBox, writeActions, writeErr.el, unmatchedEl],
    });

    const captionSection = createFieldGroup({
        title: '当前提示词（NaiCaption）',
        children: [captionMount],
    });

    const paramsDetails = createDetails({
        summary: '本次出图参数（覆盖 4.13，仅作用于这一次）',
        open: false,
        body: [
            model.el, width.el, height.el, steps.el, scale.el,
            sampler.el, noise.el, seed.el, seedRandom.el,
            imageFormat.el, qualityToggle.el, tagHintQt.el,
            ucPreset.el, tagHintUc.el, cfgRescale.el,
            varietyEnabled.el, varietySigma.el,
            sm.el, smDyn.el, straightAlpha.el, tagHintTransparent.el,
            qualityStrategy.el,
        ],
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
    const title = el('h3', 'nd-wb-title');
    setText(title, '生成工作台');
    const hint = el('p', 'nd-muted');
    setText(hint, '写提示词与出图彼此独立。替换角色关键字仅由下方开关决定，不根据提示词来源推断。');
    header.append(title, statusPill.el, hint);

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
            model.destroy();
            width.destroy();
            height.destroy();
            steps.destroy();
            scale.destroy();
            sampler.destroy();
            noise.destroy();
            seed.destroy();
            seedRandom.destroy();
            imageFormat.destroy();
            qualityToggle.destroy();
            tagHintQt.destroy();
            ucPreset.destroy();
            tagHintUc.destroy();
            cfgRescale.destroy();
            varietyEnabled.destroy();
            varietySigma.destroy();
            sm.destroy();
            smDyn.destroy();
            straightAlpha.destroy();
            tagHintTransparent.destroy();
            qualityStrategy.destroy();
            paramsDetails.destroy();
            writeSection.destroy();
            captionSection.destroy();
            genSection.destroy();
            shell.remove();
        },
    };
}
