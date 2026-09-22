/**
 * L5 UI · 画师串库 管理面板。
 * 归属：W2-H 面板代理实现。W0 仅冻结签名。
 * 预览走 D9：传正在编辑的那一条；尺寸 ARTIST_PREVIEW_SIZE；不改 activeArtistId。
 */

import { createButton, createField, createInlineError } from '../../common/controls.js';
import { paintSafeCover } from '../../common/safe-url.js';
import { createArtist } from '../../../domain/model/artist.js';
import { ARTIST_PREVIEW_SIZE } from '../../../domain/model/nai-params.js';
import { mountLibraryView } from '../library-view.js';
import { buildArtistPreviewRequest, gateCoverUrl } from '../_lib/library-logic.js';
import {
    el,
    setText,
    labeledTextarea,
    idNow,
    settingsApi,
    confirmDanger,
    openImportExportModal,
    openFormModal,
    awaitRepo,
    toast,
} from '../_lib/panel-kit.js';

/**
 * @param {Element} root
 * @param {object} deps repos / services / host / bus
 * @returns {{ destroy: () => void }}
 */
export function mountArtistPanel(root, deps) {
    if (!(root instanceof Element)) {
        throw new Error('mountArtistPanel: root must be an Element');
    }
    const repo = deps?.repos?.artist;
    if (!repo) throw new Error('mountArtistPanel: deps.repos.artist required');

    const host = deps.host;
    const imageRepo = deps?.repos?.image;
    const previewSvc = deps?.services?.artistPreview;
    const ids = idNow(deps);
    const settings = settingsApi(deps);

    /** @type {Map<string, string>} imageRef → objectURL（dispose 时 revoke） */
    const urlCache = new Map();
    /** @type {(() => void)[]} */
    const cleanups = [];
    let destroyed = false;

    const shell = el('div', 'nd-panel nd-panel--artist');
    root.appendChild(shell);

    /**
     * @param {string|null|undefined} ref
     * @returns {Promise<string|null>}
     */
    async function resolveCover(ref) {
        if (!ref) return null;
        if (urlCache.has(ref)) return urlCache.get(ref) || null;
        // 直接 URL（导入示例）走白名单
        const gated = gateCoverUrl(ref);
        if (gated) {
            urlCache.set(ref, gated);
            return gated;
        }
        if (!imageRepo || typeof imageRepo.getUrl !== 'function') return null;
        const r = await imageRepo.getUrl(ref);
        if (!r?.ok || !r.value) return null;
        const safe = gateCoverUrl(r.value);
        if (safe) urlCache.set(ref, safe);
        return safe;
    }

    async function listWithActive() {
        const items = await awaitRepo(host, repo.list(), '读取画师串失败') || [];
        const activeId = settings.load().activeArtistId;
        /** @type {object[]} */
        const out = [];
        for (const item of items) {
            const cover = await resolveCover(item.previewImageRef);
            out.push({
                ...item,
                coverUrl: cover || '',
                __active: activeId != null && String(activeId) === String(item.id),
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
        onImport: () => void openImport(),
        onExport: () => void openImport(),
    }, {
        searchKeys: ['name', 'positive', 'negative'],
        columns: [
            { key: 'name', label: '名称' },
            {
                key: 'positive',
                label: '正向',
                render: (item) => {
                    const s = String(item.positive ?? '');
                    return s.length > 40 ? `${s.slice(0, 40)}…` : s;
                },
            },
        ],
    });

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
        const positive = labeledTextarea('正向画师串', item?.positive ?? '', 4);
        const negative = labeledTextarea('负向画师串', item?.negative ?? '', 3);
        const promptField = labeledTextarea('手填预览提示词（不读 4.13 宽高）', '', 3);
        const negPreview = labeledTextarea('预览负向（可选）', '', 2);
        const sizeHint = el('p', 'nd-muted');
        setText(
            sizeHint,
            `预览尺寸固定 ${ARTIST_PREVIEW_SIZE.width}×${ARTIST_PREVIEW_SIZE.height}（ARTIST_PREVIEW_SIZE）`,
        );

        const coverBox = el('div', 'nd-artist-preview-cover');
        void (async () => {
            const url = await resolveCover(item?.previewImageRef);
            paintSafeCover(coverBox, url, item?.name ?? '');
        })();

        const form = el('div', 'nd-form');
        form.append(nameField.el, positive.el, negative.el, coverBox, sizeHint, promptField.el, negPreview.el);
        const err = createInlineError();
        form.appendChild(err.el);

        const modal = await openFormModal(deps, item ? '编辑画师串' : '新建画师串', form);

        const activateBtn = createButton({
            label: '设为当前激活',
            variant: 'ghost',
            onClick: async () => {
                const draft = await persistDraft();
                if (!draft) return;
                settings.patch({ activeArtistId: draft.id });
                toast(host, 'success', '已设为当前画师串');
                await view?.refresh();
            },
        });

        const previewBtn = createButton({
            label: '手填预览生图',
            variant: 'primary',
            onClick: async () => {
                err.clear();
                if (!previewSvc || typeof previewSvc.preview !== 'function') {
                    err.setMessage('预览服务未装配');
                    return;
                }
                const draft = await persistDraft();
                if (!draft) return;

                // D9：用正在编辑的那一条；对照传入 activeArtistId 但 build 不用它
                const before = { ...settings.load() };
                const req = buildArtistPreviewRequest(draft, {
                    promptText: promptField.getValue(),
                    negativeText: negPreview.getValue(),
                    saveAsPreview: true,
                    activeArtistId: before.activeArtistId,
                });

                const result = await previewSvc.preview({
                    artistId: req.artistId,
                    promptText: req.promptText,
                    negativeText: req.negativeText,
                    saveAsPreview: req.saveAsPreview,
                });

                const after = settings.load();
                if (after.activeArtistId !== before.activeArtistId) {
                    // 防御：若有人误改激活态，立刻写回
                    settings.patch({ activeArtistId: before.activeArtistId });
                    err.setMessage('预览不应改动当前激活画师串，已回滚');
                    return;
                }

                if (!result?.ok) {
                    err.setMessage(result?.error?.message || '预览失败');
                    return;
                }
                toast(host, 'success', '预览已生成');
                const url = result.value?.imageRef
                    ? await resolveCover(result.value.imageRef)
                    : null;
                if (url) paintSafeCover(coverBox, url, draft.name);
                await view?.refresh();
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
            const entity = item
                ? {
                    ...item,
                    name,
                    positive: positive.getValue(),
                    negative: negative.getValue(),
                    updatedAt: ids.now(),
                }
                : createArtist(
                    {
                        name,
                        positive: positive.getValue(),
                        negative: negative.getValue(),
                    },
                    { id: ids.id('ar'), now: ids.now() },
                );
            const saved = await awaitRepo(host, repo.put(entity), '保存失败');
            if (saved && !item) {
                item = saved;
            }
            return saved;
        }

        const actions = el('div', 'nd-form__actions');
        actions.append(
            createButton({ label: '取消', variant: 'ghost', onClick: () => modal.destroy() }),
            activateBtn,
            previewBtn,
            createButton({
                label: '保存',
                variant: 'primary',
                onClick: async () => {
                    const saved = await persistDraft();
                    if (saved) {
                        modal.destroy();
                        toast(host, 'success', '已保存');
                        await view?.refresh();
                    }
                },
            }),
        );
        form.appendChild(actions);
    }

    async function openImport() {
        await openImportExportModal(
            deps,
            '导入画师串',
            'artist',
            async (data, strategy) => {
                const r = await repo.importJson(data, { strategy });
                if (!r.ok) throw new Error(r.error?.message || '导入失败');
                return r.value;
            },
            async () => {
                const r = await repo.exportJson();
                if (!r.ok) throw new Error(r.error?.message || '导出失败');
                return r.value;
            },
            () => void view?.refresh(),
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
            for (const url of urlCache.values()) {
                if (typeof url === 'string' && url.startsWith('blob:')) {
                    try {
                        URL.revokeObjectURL(url);
                    } catch {
                        // ignore
                    }
                }
            }
            urlCache.clear();
            view?.destroy();
            shell.remove();
        },
    };
}
