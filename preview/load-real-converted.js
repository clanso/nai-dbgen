/**
 * 演示页：从仓库上级 ref/转换后/ 拉真实标签库 + 特征库 + 角色库 + 文生图预设，走插件 importJson。
 * 单个文件缺失/失败只提示，不影响其它文件与其它功能。
 *
 * 依赖：npm run preview 以仓库上级为静态根；页面在 /nai-dbgen/preview/ 。
 */

/** 相对静态服务根（仓库上级）的绝对路径 */
export const PREVIEW_TAG_JSON_URL = '/ref/画师串、标签库等/转换后/标签库9.5-V5.tag.json';
export const PREVIEW_PRESET_JSON_URL = '/ref/画师串、标签库等/转换后/文生图9.7-V5.preset.json';
export const PREVIEW_CHARACTER_JSON_URL = '/ref/画师串、标签库等/转换后/同人库8.5.character.json';

/** 特征库（清空示例后与 9.5 一并依次 importJson） */
export const PREVIEW_FEATURE_TAG_JSON_URLS = Object.freeze([
    { url: '/ref/画师串、标签库等/转换后/扩展库5.4.tag.json', label: '扩展库5.4' },
    { url: '/ref/画师串、标签库等/转换后/SEX模板9.2.tag.json', label: 'SEX模板9.2' },
    { url: '/ref/画师串、标签库等/转换后/常规模板5.25.tag.json', label: '常规模板5.25' },
]);

/** 转换预设 id（导入后设为当前生图 / 召回） */
export const PREVIEW_IMAGEGEN_PRESET_ID = 'preset-imagegen-97-v5';
export const PREVIEW_RECALL_PRESET_ID = 'preset-recall-97-v5';

/**
 * @param {string} url
 * @param {string} label
 * @param {(text: string) => void} setStatus
 * @param {object} [host]
 * @returns {Promise<{ ok: true, data: object, downloadMs: number, parseMs: number }|{ ok: false, reason: string }>}
 */
async function fetchJson(url, label, setStatus, host) {
    const tFetch0 = performance.now();
    setStatus(`正在拉取演示${label}（${url}）…`);

    let response;
    try {
        response = await fetch(url);
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        const msg = [
            `演示${label}数据源不可达：`,
            url,
            `（${detail}）。`,
            '请在 nai-dbgen 目录执行 npm run preview（静态根为仓库上级），',
            '打开 http://127.0.0.1:8765/nai-dbgen/preview/ ；其它功能可用。',
        ].join('');
        setStatus(msg);
        host?.toast?.('warning', `演示${label}数据源不可达；其它功能可用`);
        return { ok: false, reason: 'fetch' };
    }

    if (!response.ok) {
        const msg = [
            `演示${label}数据源未找到（HTTP ${response.status}：`,
            url,
            '）。请确认转换后文件存在，且用 npm run preview 从仓库上级起服务；其它功能可用。',
        ].join('');
        setStatus(msg);
        host?.toast?.('warning', `演示${label}数据源未找到；其它功能可用`);
        return { ok: false, reason: 'http' };
    }

    let data;
    let tDownload1;
    try {
        const text = await response.text();
        tDownload1 = performance.now();
        data = JSON.parse(text);
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        const msg = `演示${label} JSON 解析失败：${detail}；其它功能可用。`;
        setStatus(msg);
        host?.toast?.('error', msg);
        return { ok: false, reason: 'parse' };
    }

    const tParse1 = performance.now();
    return {
        ok: true,
        data,
        downloadMs: Math.round(tDownload1 - tFetch0),
        parseMs: Math.round(tParse1 - tDownload1),
    };
}

/**
 * 清空演示标签库（与 load-real-artists 清示例画师串同理）。
 * @param {object} tagRepo
 * @returns {Promise<void>}
 */
async function clearFixtureTagLibraries(tagRepo) {
    const listed = await tagRepo.listLibraries();
    if (!listed?.ok || !Array.isArray(listed.value)) {
        return;
    }
    for (const lib of listed.value) {
        await tagRepo.removeLibrary(lib.id);
    }
}

/**
 * 清空演示角色组（级联删角色）。
 * @param {object} characterRepo
 * @returns {Promise<void>}
 */
async function clearFixtureCharacters(characterRepo) {
    const listed = await characterRepo.listGroups();
    if (!listed?.ok || !Array.isArray(listed.value)) {
        return;
    }
    for (const group of listed.value) {
        await characterRepo.removeGroup(group.id);
    }
}

/**
 * @param {object|null|undefined} data
 * @returns {boolean}
 */
function isTagPackage(data) {
    return !!data && typeof data === 'object' && Array.isArray(data.libraries);
}

/**
 * @param {object|null|undefined} data
 * @returns {boolean}
 */
function isPresetPackage(data) {
    return !!data && typeof data === 'object' && Array.isArray(data.items);
}

/**
 * @param {object|null|undefined} data
 * @returns {boolean}
 */
function isCharacterPackage(data) {
    return !!data
        && typeof data === 'object'
        && (data.kind == null || data.kind === 'character')
        && Array.isArray(data.groups)
        && Array.isArray(data.characters);
}

/**
 * 导入单个标签包；失败只提示，返回条数与耗时。
 * @param {object} args
 * @param {object} args.tagRepo
 * @param {object} args.data
 * @param {string} args.label
 * @param {(text: string) => void} args.setStatus
 * @param {object} [args.host]
 * @param {{ downloadMs?: number, parseMs?: number }} [args.timing]
 * @returns {Promise<{ ok: boolean, imported: number, downloadMs: number, parseMs: number, importMs: number, reason?: string }>}
 */
async function importOneTagPackage({ tagRepo, data, label, setStatus, host, timing }) {
    const downloadMs = Number(timing?.downloadMs) || 0;
    const parseMs = Number(timing?.parseMs) || 0;
    if (!isTagPackage(data)) {
        const msg = `演示${label}数据形状无效（缺 libraries）；其它功能可用。`;
        setStatus(msg);
        host?.toast?.('error', msg);
        return { ok: false, imported: 0, downloadMs, parseMs, importMs: 0, reason: 'tag-shape' };
    }

    setStatus(`正在导入${label}（库 ${data.libraries.length} / 条目 ${(data.entries || []).length}）…`);
    const t0 = performance.now();
    const tagImp = await tagRepo.importJson(data, { strategy: 'overwrite' });
    const importMs = Math.round(performance.now() - t0);
    if (!tagImp.ok) {
        const msg = `${label}导入失败：${tagImp.error?.message || 'unknown'}；其它功能可用。`;
        setStatus(msg);
        host?.toast?.('error', msg);
        return { ok: false, imported: 0, downloadMs, parseMs, importMs, reason: 'tag-import' };
    }
    const imported = Number(tagImp.value?.imported) || (data.entries || []).length;
    return { ok: true, imported, downloadMs, parseMs, importMs };
}

/**
 * 导入转换标签库 + 特征库 + 角色库 + 预设，并切到两套当前预设。
 * 也可在 Node 冒烟里直接传已解析的 data（跳过 fetch）。
 *
 * @param {object} args
 * @param {object} args.container activate 后的容器
 * @param {object} [args.host]
 * @param {(text: string) => void} args.setStatus
 * @param {object} [args.tagData] 已解析的标签库 9.5 包（测用）
 * @param {object[]} [args.featureTagDataList] 已解析的特征库包列表（测用，与 PREVIEW_FEATURE_TAG_JSON_URLS 同序）
 * @param {object} [args.presetData] 已解析的预设包（测用）
 * @param {object} [args.characterData] 已解析的角色库包（测用）
 * @returns {Promise<{
 *   ok: boolean,
 *   reason?: string,
 *   tagLibs?: number,
 *   tagEntries?: number,
 *   presets?: number,
 *   characterGroups?: number,
 *   characters?: number,
 *   activeImagegenPresetId?: string|null,
 *   activeRecallPresetId?: string|null,
 *   fileStats?: object[],
 *   totalMs?: number,
 * }>}
 */
export async function loadRealConvertedIntoPreview({
    container,
    host,
    setStatus,
    tagData,
    featureTagDataList,
    presetData,
    characterData,
}) {
    const tAll0 = performance.now();
    const tagRepo = container?.repos?.tag;
    const presetRepo = container?.repos?.preset;
    const characterRepo = container?.repos?.character;

    if (!tagRepo || typeof tagRepo.importJson !== 'function') {
        setStatus('标签库不可用，跳过真实标签/预设导入');
        return { ok: false, reason: 'no-tag-repo' };
    }
    if (!presetRepo || typeof presetRepo.importJson !== 'function') {
        setStatus('预设库不可用，跳过真实标签/预设导入');
        return { ok: false, reason: 'no-preset-repo' };
    }

    /** @type {{ label: string, imported: number, downloadMs: number, parseMs: number, importMs: number, ok: boolean }[]} */
    const fileStats = [];

    // ── 标签：清空示例后依次导入 9.5 + 3 个特征库 ─────────────────
    setStatus('正在清空示例标签库…');
    await clearFixtureTagLibraries(tagRepo);

    /** @type {{ label: string, data: object|null, timing: { downloadMs: number, parseMs: number } }[]} */
    const tagJobs = [];

    if (tagData != null) {
        tagJobs.push({
            label: '标签库9.5',
            data: tagData,
            timing: { downloadMs: 0, parseMs: 0 },
        });
    } else {
        const fetched = await fetchJson(PREVIEW_TAG_JSON_URL, '标签库9.5', setStatus, host);
        tagJobs.push({
            label: '标签库9.5',
            data: fetched.ok ? fetched.data : null,
            timing: fetched.ok
                ? { downloadMs: fetched.downloadMs, parseMs: fetched.parseMs }
                : { downloadMs: 0, parseMs: 0 },
        });
        if (!fetched.ok) {
            fileStats.push({
                label: '标签库9.5',
                imported: 0,
                downloadMs: 0,
                parseMs: 0,
                importMs: 0,
                ok: false,
            });
        }
    }

    const featureOverrides = Array.isArray(featureTagDataList) ? featureTagDataList : null;
    for (let i = 0; i < PREVIEW_FEATURE_TAG_JSON_URLS.length; i += 1) {
        const meta = PREVIEW_FEATURE_TAG_JSON_URLS[i];
        if (featureOverrides && featureOverrides[i] != null) {
            tagJobs.push({
                label: meta.label,
                data: featureOverrides[i],
                timing: { downloadMs: 0, parseMs: 0 },
            });
            continue;
        }
        if (featureOverrides) {
            // 测用只传了部分特征包时，跳过未提供的项（不 fetch）
            continue;
        }
        const fetched = await fetchJson(meta.url, meta.label, setStatus, host);
        if (!fetched.ok) {
            fileStats.push({
                label: meta.label,
                imported: 0,
                downloadMs: 0,
                parseMs: 0,
                importMs: 0,
                ok: false,
            });
            continue;
        }
        tagJobs.push({
            label: meta.label,
            data: fetched.data,
            timing: { downloadMs: fetched.downloadMs, parseMs: fetched.parseMs },
        });
    }

    let tagImportedTotal = 0;
    let anyTagOk = false;
    for (const job of tagJobs) {
        if (!job.data) {
            continue;
        }
        const r = await importOneTagPackage({
            tagRepo,
            data: job.data,
            label: job.label,
            setStatus,
            host,
            timing: job.timing,
        });
        fileStats.push({
            label: job.label,
            imported: r.imported,
            downloadMs: r.downloadMs,
            parseMs: r.parseMs,
            importMs: r.importMs,
            ok: r.ok,
        });
        if (r.ok) {
            anyTagOk = true;
            tagImportedTotal += r.imported;
        }
    }

    // ── 预设（独立；失败不影响标签/角色）────────────────────────
    /** @type {object|null} */
    let presets = presetData ?? null;
    let presetTiming = { downloadMs: 0, parseMs: 0 };
    if (!presets) {
        const fetched = await fetchJson(PREVIEW_PRESET_JSON_URL, '预设', setStatus, host);
        if (fetched.ok) {
            presets = fetched.data;
            presetTiming = { downloadMs: fetched.downloadMs, parseMs: fetched.parseMs };
        } else {
            fileStats.push({
                label: '预设',
                imported: 0,
                downloadMs: 0,
                parseMs: 0,
                importMs: 0,
                ok: false,
            });
        }
    }

    let presetOk = false;
    let presetImported = 0;
    if (presets) {
        if (!isPresetPackage(presets)) {
            const msg = '演示预设数据形状无效（缺 items）；其它功能可用。';
            setStatus(msg);
            host?.toast?.('error', msg);
            fileStats.push({
                label: '预设',
                imported: 0,
                downloadMs: presetTiming.downloadMs,
                parseMs: presetTiming.parseMs,
                importMs: 0,
                ok: false,
            });
        } else {
            setStatus('正在导入转换预设…');
            const t0 = performance.now();
            const presetImp = await presetRepo.importJson(presets, { strategy: 'overwrite' });
            const importMs = Math.round(performance.now() - t0);
            if (!presetImp.ok) {
                const msg = `预设导入失败：${presetImp.error?.message || 'unknown'}；其它功能可用。`;
                setStatus(msg);
                host?.toast?.('error', msg);
                fileStats.push({
                    label: '预设',
                    imported: 0,
                    downloadMs: presetTiming.downloadMs,
                    parseMs: presetTiming.parseMs,
                    importMs,
                    ok: false,
                });
            } else {
                presetOk = true;
                presetImported = Number(presetImp.value?.imported) || (presets.items || []).length;
                fileStats.push({
                    label: '预设',
                    imported: presetImported,
                    downloadMs: presetTiming.downloadMs,
                    parseMs: presetTiming.parseMs,
                    importMs,
                    ok: true,
                });
            }
        }
    }

    // ── 角色库：清空示例后 importJson 同人库 ─────────────────────
    let characterGroups = 0;
    let characters = 0;
    let characterOk = false;
    if (!characterRepo || typeof characterRepo.importJson !== 'function') {
        setStatus('角色库不可用，跳过真实角色导入');
        fileStats.push({
            label: '同人库8.5',
            imported: 0,
            downloadMs: 0,
            parseMs: 0,
            importMs: 0,
            ok: false,
        });
    } else {
        setStatus('正在清空示例角色库…');
        await clearFixtureCharacters(characterRepo);

        /** @type {object|null} */
        let chars = characterData ?? null;
        let charTiming = { downloadMs: 0, parseMs: 0 };
        if (!chars) {
            const fetched = await fetchJson(PREVIEW_CHARACTER_JSON_URL, '同人库8.5', setStatus, host);
            if (fetched.ok) {
                chars = fetched.data;
                charTiming = { downloadMs: fetched.downloadMs, parseMs: fetched.parseMs };
            } else {
                fileStats.push({
                    label: '同人库8.5',
                    imported: 0,
                    downloadMs: 0,
                    parseMs: 0,
                    importMs: 0,
                    ok: false,
                });
            }
        }

        if (chars) {
            if (!isCharacterPackage(chars)) {
                const msg = '演示角色库数据形状无效（缺 groups/characters 或 kind 不符）；其它功能可用。';
                setStatus(msg);
                host?.toast?.('error', msg);
                fileStats.push({
                    label: '同人库8.5',
                    imported: 0,
                    downloadMs: charTiming.downloadMs,
                    parseMs: charTiming.parseMs,
                    importMs: 0,
                    ok: false,
                });
            } else {
                setStatus(
                    `正在导入同人库（组 ${chars.groups.length} / 角色 ${chars.characters.length}）…`,
                );
                const t0 = performance.now();
                const charImp = await characterRepo.importJson(chars, { strategy: 'overwrite' });
                const importMs = Math.round(performance.now() - t0);
                if (!charImp.ok) {
                    const msg = `同人库导入失败：${charImp.error?.message || 'unknown'}；其它功能可用。`;
                    setStatus(msg);
                    host?.toast?.('error', msg);
                    fileStats.push({
                        label: '同人库8.5',
                        imported: 0,
                        downloadMs: charTiming.downloadMs,
                        parseMs: charTiming.parseMs,
                        importMs,
                        ok: false,
                    });
                } else {
                    characterOk = true;
                    const imported = Number(charImp.value?.imported)
                        || (chars.groups.length + chars.characters.length);
                    fileStats.push({
                        label: '同人库8.5',
                        imported,
                        downloadMs: charTiming.downloadMs,
                        parseMs: charTiming.parseMs,
                        importMs,
                        ok: true,
                    });
                }
            }
        }

        const afterGroups = await characterRepo.listGroups();
        const groups = afterGroups?.ok && Array.isArray(afterGroups.value)
            ? afterGroups.value
            : [];
        characterGroups = groups.length;
        let charCount = 0;
        for (const g of groups) {
            const listed = await characterRepo.listByGroup(g.id);
            if (listed?.ok && Array.isArray(listed.value)) {
                charCount += listed.value.length;
            }
        }
        characters = charCount;
    }

    const afterLibs = await tagRepo.listLibraries();
    const libs = afterLibs?.ok && Array.isArray(afterLibs.value) ? afterLibs.value : [];
    const afterPresets = await presetRepo.list();
    const presetList = afterPresets?.ok && Array.isArray(afterPresets.value) ? afterPresets.value : [];

    const hasImagegen = presetList.some((p) => p.id === PREVIEW_IMAGEGEN_PRESET_ID);
    const hasRecall = presetList.some((p) => p.id === PREVIEW_RECALL_PRESET_ID);

    if (container.settingsStore?.save) {
        const s = container.loadSettings?.() || container.settingsStore.load();
        container.settingsStore.save({
            ...s,
            ...(hasImagegen ? { activeImagegenPresetId: PREVIEW_IMAGEGEN_PRESET_ID } : {}),
            ...(hasRecall ? { activeRecallPresetId: PREVIEW_RECALL_PRESET_ID } : {}),
        });
        // 同步假宿主设置，避免工具栏「恢复示例配置」以外路径读到旧 id
        if (host?._ctrl?.setSettings) {
            const next = container.settingsStore.load();
            host._ctrl.setSettings(next);
            host.saveSettings?.(next);
        }
    }

    const settings = container.loadSettings?.() || container.settingsStore?.load?.() || {};
    const totalMs = Math.round(performance.now() - tAll0);
    const perFile = fileStats
        .map((f) => `${f.label}${f.ok ? '' : '(失败)'} imported=${f.imported}`
            + ` 下载/解析/导入 ${f.downloadMs}/${f.parseMs}/${f.importMs}ms`)
        .join(' · ');

    setStatus(
        `真实转换数据已导入：库 ${libs.length} 个`
        + ` · 角色组 ${characterGroups} / 角色 ${characters}`
        + ` · 预设 imported=${presetImported}`
        + ` · 当前生图=${settings.activeImagegenPresetId || '—'}`
        + ` · 当前召回=${settings.activeRecallPresetId || '—'}`
        + (perFile ? ` · ${perFile}` : '')
        + ` · 标签/角色/预设合计 ${totalMs}ms`,
    );

    const ok = anyTagOk || presetOk || characterOk;
    return {
        ok,
        reason: ok ? undefined : 'all-failed',
        tagLibs: libs.length,
        tagEntries: tagImportedTotal,
        presets: presetList.length,
        characterGroups,
        characters,
        activeImagegenPresetId: settings.activeImagegenPresetId ?? null,
        activeRecallPresetId: settings.activeRecallPresetId ?? null,
        fileStats,
        totalMs,
    };
}
