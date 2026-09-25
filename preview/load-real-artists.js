/**
 * 演示页：从仓库上级 ref/ 拉真实画师串.json，走插件 importJson + 导入进度 UI。
 * 不进冒烟测试；文件缺失时只提示，保留 fixture 假数据，其它功能照常可用。
 *
 * 依赖：npm run preview 以仓库上级为静态根（见 package.json），页面在
 * /nai-dbgen/preview/ ，数据在 /ref/画师串、标签库等/画师串.json 。
 */

import { openImportExportModal } from '../src/ui/panels/_lib/panel-kit.js';
import { PUBLIC_API_NAME } from '../src/bootstrap/lifecycle.js';

/** 相对静态服务根（仓库上级）的绝对路径 */
export const PREVIEW_ARTIST_JSON_URL = '/ref/画师串、标签库等/画师串.json';

/**
 * @param {object} args
 * @param {object} args.container activate 后的容器
 * @param {object} args.host
 * @param {(text: string) => void} args.setStatus
 * @returns {Promise<{
 *   ok: boolean,
 *   reason?: string,
 *   imported?: number,
 *   count?: number,
 *   downloadMs?: number,
 *   parseMs?: number,
 *   importMs?: number,
 *   totalMs?: number,
 * }>}
 */
export async function loadRealArtistsIntoPreview({ container, host, setStatus }) {
    const t0 = performance.now();
    const repo = container?.repos?.artist;
    if (!repo || typeof repo.importJson !== 'function') {
        setStatus('画师串库不可用，跳过真实数据导入');
        return { ok: false, reason: 'no-repo' };
    }

    const tFetch0 = performance.now();
    setStatus(`正在拉取演示画师串（${PREVIEW_ARTIST_JSON_URL}）…`);

    let response;
    try {
        response = await fetch(PREVIEW_ARTIST_JSON_URL);
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        const msg = [
            '演示画师串数据源不可达：',
            PREVIEW_ARTIST_JSON_URL,
            `（${detail}）。`,
            '请在 nai-dbgen 目录执行 npm run preview（静态根为仓库上级），',
            '打开 http://127.0.0.1:8765/nai-dbgen/preview/ ；其它功能可用。',
        ].join('');
        setStatus(msg);
        host.toast?.('warning', '演示画师串数据源不可达；其它功能可用');
        return { ok: false, reason: 'fetch' };
    }

    if (!response.ok) {
        const msg = [
            `演示画师串数据源未找到（HTTP ${response.status}：`,
            PREVIEW_ARTIST_JSON_URL,
            '）。请确认 ref/画师串、标签库等/画师串.json 存在，',
            '且用 npm run preview 从仓库上级起服务；其它功能可用。',
        ].join('');
        setStatus(msg);
        host.toast?.('warning', '演示画师串数据源未找到；其它功能可用');
        return { ok: false, reason: 'http', totalMs: Math.round(performance.now() - t0) };
    }

    setStatus('正在下载并解析画师串 JSON（约 216MB，可能需数十秒）…');

    let data;
    let tDownload1;
    try {
        const text = await response.text();
        tDownload1 = performance.now();
        data = JSON.parse(text);
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        const msg = `演示画师串 JSON 解析失败：${detail}；其它功能可用。`;
        setStatus(msg);
        host.toast?.('error', msg);
        return { ok: false, reason: 'parse' };
    }

    const tParse1 = performance.now();
    const downloadMs = Math.round((tDownload1 ?? tParse1) - tFetch0);
    const parseMs = Math.round(tParse1 - (tDownload1 ?? tFetch0));

    if (!Array.isArray(data)) {
        const msg = '演示画师串数据不是 JSON 数组；其它功能可用。';
        setStatus(msg);
        host.toast?.('error', msg);
        return { ok: false, reason: 'shape' };
    }

    setStatus(`已解析 ${data.length} 条，正在清空示例画师串并打开导入…`);

    // 替换假数据：先删 fixture 三条，再走真实 importJson
    const listed = await repo.list();
    if (listed?.ok && Array.isArray(listed.value)) {
        for (const row of listed.value) {
            await repo.remove(row.id);
        }
    }
    const settings = container.loadSettings?.() || container.settingsStore?.load?.();
    if (settings && container.settingsStore?.save) {
        container.settingsStore.save({ ...settings, activeArtistId: null });
    }

    const api = globalThis[PUBLIC_API_NAME];
    if (api && typeof api.openManagement === 'function') {
        await api.openManagement('artist');
    }

    /** @type {AbortController|null} */
    let ioAbort = null;
    /** @type {object|null} */
    let importResult = null;

    const tImp0 = performance.now();
    setStatus(`正在导入 ${data.length} 条画师串（插件进度见弹层）…`);

    const importModal = await openImportExportModal(
        { host },
        '导入画师串（演示数据）',
        'artist',
        async (payload, strategy, progress) => {
            ioAbort = new AbortController();
            const r = await repo.importJson(payload, {
                strategy,
                signal: ioAbort.signal,
                onProgress: progress?.onProgress,
            });
            ioAbort = null;
            if (!r.ok) throw new Error(r.error?.message || '导入失败');
            if (Array.isArray(r.value?.errors) && r.value.errors.length) {
                host.toast?.('warning', `部分失败：${r.value.errors.slice(0, 3).join('；')}`);
            }
            importResult = r.value;
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
        undefined,
        {
            allowBareArray: true,
            onCancelIo: () => {
                ioAbort?.abort();
            },
            autoImport: { data, strategy: 'skip' },
        },
    );

    const tImp1 = performance.now();

    const after = await repo.list();
    const artists = after?.ok && Array.isArray(after.value) ? after.value : [];
    if (artists.length && container.settingsStore?.save) {
        const s = container.loadSettings?.() || container.settingsStore.load();
        container.settingsStore.save({ ...s, activeArtistId: artists[0].id });
    }

    const totalMs = Math.round(performance.now() - t0);
    const importMs = Math.round(tImp1 - tImp0);
    const imported = Number(importResult?.imported) || artists.length;

    setStatus(
        `真实画师串已导入 ${artists.length} 条`
        + `（imported=${imported}）`
        + ` · 下载 ${downloadMs}ms · 解析 ${parseMs}ms · 导入 ${importMs}ms · 合计 ${totalMs}ms`,
    );

    // 导入完成后关掉导入弹层，留下管理台画师串列表供验收
    try {
        importModal.destroy();
    } catch {
        // ignore
    }

    return {
        ok: true,
        imported,
        count: artists.length,
        downloadMs,
        parseMs,
        importMs,
        totalMs,
    };
}
