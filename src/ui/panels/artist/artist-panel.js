/**
 * L5 UI · 画师串库 管理面板。
 * 归属：W2-H 面板代理实现。
 * 预览走 D9：传正在编辑的那一条；尺寸 ARTIST_PREVIEW_SIZE；不改 activeArtistId。
 * 列表用卡片图；点开看原图；按 sequence 排序；新建 sequence = max+1。
 */

import { createButton, createField, createInlineError } from '../../common/controls.js';
import { paintSafeCover } from '../../common/safe-url.js';
import { openSlotImageViewer } from '../../common/image-viewer.js';
import {
    createArtist,
    nextArtistSequence,
} from '../../../domain/model/artist.js';
import { mountLibraryView } from '../library-view.js';
import {
    gateCoverUrl,
    buildArtistPreviewRequest,
    applyFormFields,
    paidActionLabels,
    formatErrorDisplay,
    readArtistPreviewPrompts,
    writeArtistPreviewPrompts,
} from '../_lib/library-logic.js';
import {
    el,
    labeledTextarea,
    idNow,
    settingsApi,
    confirmDanger,
    openImportExportModal,
    openFormModal,
    awaitRepo,
    toast,
    runExclusivePaidAction,
} from '../_lib/panel-kit.js';

/**
 * @param {Element} root
 * @param {object} deps repos / services / host / bus / artistFileUrl
 * @returns {{ destroy: () => void }}
 */
export function mountArtistPanel(root, deps) {
    if (!(root instanceof Element)) {
        throw new Error('mountArtistPanel: root must be an Element');
    }
    const repo = deps?.repos?.artist;
    if (!repo) throw new Error('mountArtistPanel: deps.repos.artist required');

    const host = deps.host;
    const artistFileUrl = deps?.artistFileUrl;
    if (!artistFileUrl || typeof artistFileUrl.urlOf !== 'function') {
        throw new Error('mountArtistPanel: deps.artistFileUrl required');
    }
    const previewSvc = deps?.services?.artistPreview;
    const ids = idNow(deps);
    const settings = settingsApi(deps);

    /** @type {Map<string, string>} ref+version → gated URL */
    const urlCache = new Map();
    /** @type {(() => void)[]} */
    const cleanups = [];
    let destroyed = false;

    const shell = el('div', 'nd-panel nd-panel--artist');
    root.appendChild(shell);

    /**
     * @param {string|null|undefined} ref
     * @param {string|number|null|undefined} [version]
     * @returns {string|null}
     */
    async function resolveFileUrl(ref, version) {
        if (!ref) return null;
        const cacheKey = version != null && String(version) !== ''
            ? `${ref}::${version}`
            : String(ref);
        if (urlCache.has(cacheKey)) return urlCache.get(cacheKey) || null;
        const raw = await Promise.resolve(artistFileUrl.urlOf(ref, version));
        const gated = gateCoverUrl(raw);
        if (gated) urlCache.set(cacheKey, gated);
        return gated;
    }

    async function listWithActive() {
        const items = await awaitRepo(host, repo.list(), '读取画师串失败') || [];
        const activeId = settings.load().activeArtistId;
        /** @type {object[]} */
        const out = [];
        for (const item of items) {
            const cover = await resolveFileUrl(item.cardImageRef, item.updatedAt);
            const isActive = activeId != null && String(activeId) === String(item.id);
            out.push({
                ...item,
                coverUrl: cover || '',
                __active: isActive,
                __chips: isActive ? ['当前使用'] : [],
            });
        }
        return out;
    }

    /** @type {{ destroy: () => void, refresh: () => Promise<void> }|null} */
    let view = null;

    view = mountLibraryView(shell, {
        list: listWithActive,
        onCreate: () => void openEditor(null),
        onEdit: (item) => void openEditor(item),
        onDelete: (idsToDelete) => void removeItems(idsToDelete),
        onImport: () => void openImport('import'),
        onExport: () => void openImport('export'),
        onCoverClick: (item) => void openFullImage(item),
    }, {
        cover: true,
        defaultSort: 'sequence-asc',
        sortOptions: [
            { value: 'sequence-asc', label: '排序号' },
            { value: 'sequence-desc', label: '排序号倒序' },
            { value: 'name-asc', label: '名称' },
            { value: 'name-desc', label: '名称倒序' },
            { value: 'updated-desc', label: '最近更新' },
        ],
        searchKeys: ['name', 'positivePrompt', 'negativePrompt'],
        columns: [
            { key: 'name', label: '名称' },
        ],
        cardMeta: (item) => ({
            chips: Array.isArray(item?.__chips) ? item.__chips : [],
        }),
    });

    /**
     * @param {object} item
     */
    async function openFullImage(item) {
        const url = await resolveFileUrl(item?.referenceImageRef, item?.updatedAt);
        if (!url) {
            toast(host, 'info', '该条目没有示例图');
            return;
        }
        await openSlotImageViewer({ host }, { url, title: item?.name, alt: item?.name });
    }

    /**
     * @param {string[]} idList
     */
    async function removeItems(idList) {
        if (!idList.length) return;
        const ok = await confirmDanger(deps, `删除选中的 ${idList.length} 条画师串？`);
        if (!ok) return;
        for (const id of idList) {
            await awaitRepo(host, repo.remove(id), '删除失败');
            const activeId = settings.load().activeArtistId;
            if (activeId != null && String(activeId) === String(id)) {
                settings.patch({ activeArtistId: null });
            }
        }
        await view?.refresh();
    }

    /**
     * @param {object|null} item
     */
    async function openEditor(item) {
        const nameField = createField({ label: '名称', value: item?.name ?? '' });
        const positive = labeledTextarea('正向画师串', item?.positivePrompt ?? '', 4);
        const negative = labeledTextarea('负向画师串', item?.negativePrompt ?? '', 3);
        const savedPreview = readArtistPreviewPrompts();
        const promptField = labeledTextarea('预览提示词', savedPreview.promptText, 3);
        const negPreview = labeledTextarea('预览负向', savedPreview.negativeText, 2);
        const rememberPreviewPrompts = () => {
            writeArtistPreviewPrompts(promptField.getValue(), negPreview.getValue());
        };
        promptField.el.addEventListener('input', rememberPreviewPrompts);
        negPreview.el.addEventListener('input', rememberPreviewPrompts);

        const coverBox = el('div', 'nd-artist-preview-cover');
        coverBox.style.cursor = 'pointer';
        coverBox.title = '点击查看原图';
        coverBox.addEventListener('click', () => {
            void openFullImage(item || {});
        });
        void (async () => {
            const url = await resolveFileUrl(item?.cardImageRef, item?.updatedAt);
            paintSafeCover(coverBox, url, item?.name ?? '', { emptyVariant: 'label' });
        })();

        const form = el('div', 'nd-form');
        form.append(nameField.el, positive.el, negative.el, coverBox, promptField.el, negPreview.el);
        const err = createInlineError();
        form.appendChild(err.el);

        const modal = await openFormModal(deps, item ? '编辑画师串' : '新建画师串', form);
        const closeModal = () => {
            rememberPreviewPrompts();
            modal.destroy();
        };

        const activateBtn = createButton({
            label: '设为当前',
            variant: 'ghost',
            onClick: async () => {
                const draft = await persistDraft();
                if (!draft) return;
                settings.patch({ activeArtistId: draft.id });
                toast(host, 'success', '已设为当前画师串');
                await view?.refresh();
            },
        });

        const previewLabels = paidActionLabels('artistPreview');
        const previewBtn = createButton({
            label: previewLabels.idle,
            variant: 'primary',
            onClick: async () => {
                err.clear();
                if (!previewSvc || typeof previewSvc.preview !== 'function') {
                    err.setMessage('预览出图不可用，请刷新后重试');
                    return;
                }

                await runExclusivePaidAction({
                    button: previewBtn,
                    idleLabel: previewLabels.idle,
                    busyLabel: previewLabels.busy,
                    run: async () => {
                        const draft = await persistDraft();
                        if (!draft) return;

                        rememberPreviewPrompts();
                        const req = buildArtistPreviewRequest(draft, {
                            promptText: promptField.getValue(),
                            negativeText: negPreview.getValue(),
                            saveAsPreview: true,
                        });

                        const result = await previewSvc.preview({
                            artistId: req.artistId,
                            promptText: req.promptText,
                            negativeText: req.negativeText,
                            saveAsPreview: req.saveAsPreview,
                        });

                        if (!result?.ok) {
                            err.setMessage(formatErrorDisplay(result?.error, '预览失败'));
                            return;
                        }
                        toast(host, 'success', '示例图已更新');
                        item = {
                            ...draft,
                            referenceImageRef: result.value?.referenceImageRef ?? draft.referenceImageRef,
                            cardImageRef: result.value?.cardImageRef ?? draft.cardImageRef,
                            updatedAt: draft.updatedAt,
                        };
                        const url = await resolveFileUrl(item.cardImageRef, item.updatedAt);
                        if (url) paintSafeCover(coverBox, url, draft.name, { emptyVariant: 'label' });
                        await view?.refresh();
                    },
                });
            },
        });

        /**
         * @returns {Promise<object|null>}
         */
        async function persistDraft() {
            const name = nameField.getValue().trim();
            if (!name) {
                err.setMessage('请填写名称');
                return null;
            }
            let entity;
            if (item) {
                entity = applyFormFields(item, {
                    name,
                    positivePrompt: positive.getValue(),
                    negativePrompt: negative.getValue(),
                    updatedAt: ids.now(),
                });
            } else {
                const all = await awaitRepo(host, repo.list(), '读取画师串失败') || [];
                entity = createArtist(
                    {
                        name,
                        positivePrompt: positive.getValue(),
                        negativePrompt: negative.getValue(),
                        sequence: nextArtistSequence(all),
                    },
                    { id: ids.id('ar'), now: ids.now() },
                );
            }
            const saved = await awaitRepo(host, repo.put(entity), '保存失败');
            if (saved && !item) {
                item = saved;
            }
            return saved;
        }

        const actions = el('div', 'nd-form__actions');
        actions.append(
            createButton({ label: '取消', variant: 'ghost', onClick: () => closeModal() }),
            activateBtn,
            previewBtn,
            createButton({
                label: '保存',
                variant: 'primary',
                onClick: async () => {
                    const saved = await persistDraft();
                    if (saved) {
                        closeModal();
                        toast(host, 'success', '已保存');
                        await view?.refresh();
                    }
                },
            }),
        );
        form.appendChild(actions);
    }

    /**
     * @param {'import'|'export'} [mode]
     */
    async function openImport(mode = 'import') {
        /** @type {AbortController|null} */
        let ioAbort = null;
        await openImportExportModal(
            deps,
            mode === 'export' ? '导出画师串' : '导入画师串',
            'artist',
            async (data, strategy, progress) => {
                ioAbort = new AbortController();
                const r = await repo.importJson(data, {
                    strategy,
                    signal: ioAbort.signal,
                    onProgress: progress?.onProgress,
                });
                ioAbort = null;
                if (!r.ok) throw new Error(r.error?.message || '导入失败');
                if (Array.isArray(r.value?.errors) && r.value.errors.length) {
                    toast(host, 'warning', `部分失败：${r.value.errors.slice(0, 3).join('；')}`);
                }
                return r.value;
            },
            async (progress) => {
                ioAbort = new AbortController();
                const r = await repo.exportJson({
                    signal: ioAbort.signal,
                    onProgress: progress?.onProgress,
                });
                ioAbort = null;
                if (!r.ok) throw new Error(r.error?.message || '导出失败');
                return r.value;
            },
            () => void view?.refresh(),
            {
                mode,
                allowBareArray: true,
                onCancelIo: () => {
                    ioAbort?.abort();
                },
            },
        );
    }

    if (typeof repo.onChanged === 'function') {
        cleanups.push(repo.onChanged(() => void view?.refresh()));
    }

    return {
        destroy() {
            if (destroyed) return;
            destroyed = true;
            for (const fn of cleanups) fn();
            urlCache.clear();
            view?.destroy();
            shell.remove();
        },
    };
}
