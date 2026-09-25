/**
 * L0 装配 · 首次启动导入种子资产。
 * 幂等：已登记过的种子 id 不再导入；绝不 overwrite 用户数据。
 * 用户删掉种子后也不会复活（靠本地 ledger，不靠「库里还在不在」）。
 * 导入失败只记日志，不抛到 activate。
 */

import { createLogger } from '../infra/logger.js';
import { validatePreset } from '../domain/model/preset.js';
import { validateArtist } from '../domain/model/artist.js';
import { validateLlmApiConfig, validateNaiApiConfig } from '../domain/model/api-config.js';
import { renderPreset } from '../domain/template/preset-renderer.js';
import { createBlockSet, setBlock } from '../domain/blocks/block-set.js';
import { VARIABLE_NAMES } from '../domain/template/variable-map.js';
import { RECALL_CANDIDATE_KEYS_VAR } from '../application/_helpers.js';

const log = createLogger('bootstrap/seed');

/** 内置默认 LLM 配置 id（地址/Key/模型留空，由用户填写）。 */
export const SEED_LLM_DEFAULT_ID = 'seed-llm-default-v1';

/** 内置默认 NAI 配置 id（预填官方地址，Key 留空）。 */
export const SEED_NAI_DEFAULT_ID = 'seed-nai-default-v1';


/** localStorage 键（与 extensionSettings 键分离，避免进 PluginSettings） */
export const SEED_LEDGER_KEY = 'nai-dbgen:seed-ledger-v1';

/**
 * 酒馆 extensionSettings 顶层键（不在 PLUGIN_NS / PluginSettings 内，D8 不冲突）。
 * 用于无 localStorage 或隐私模式时仍能跨重启记住「已提供过的种子 id」。
 */
export const SEED_LEDGER_EXTENSION_KEY = 'nai-dbgen-seed-ledger';

/** 种子资源文件名（相对 assets/seed/） */
export const SEED_ASSET_FILES = Object.freeze([
    'preset-imagegen.json',
    'preset-recall.json',
    'preset-single-recall.json',
    'preset-single-imagegen.json',
    'artists.json',
    'llm-default.json',
    'nai-default.json',
]);

/**
 * 进程内兜底：无 localStorage、也无 getContext 时，同页多次 activate 仍幂等。
 * @type {{ getItem: (k: string) => string|null, setItem: (k: string, v: string) => void }|null}
 */
let sharedFallbackStorage = null;

/**
 * @typedef {object} SeedLedger
 * @property {number} version
 * @property {string[]} offeredIds 曾经成功导入或确认已存在的种子实体 id
 */

/**
 * @typedef {object} SeedInstallDeps
 * @property {{
 *   preset: { get: (id: string) => Promise<any>, put: (item: any) => Promise<any>, importJson?: Function },
 *   artist: { get: (id: string) => Promise<any>, put: (item: any) => Promise<any>, importJson?: Function },
 *   llmConfig?: { get: (id: string) => Promise<any>, put: (item: any) => Promise<any>, importJson?: Function },
 *   naiConfig?: { get: (id: string) => Promise<any>, put: (item: any) => Promise<any>, importJson?: Function },
 *   tag?: object,
 * }} repos
 * @property {() => import('../domain/model/plugin-settings.js').PluginSettings} loadSettings
 * @property {(s: import('../domain/model/plugin-settings.js').PluginSettings) => void} saveSettings
 * @property {{ getItem: (k: string) => string|null, setItem: (k: string, v: string) => void }} [storage]
 *   缺省读 localStorage；测试可注入 memory
 * @property {() => any} [getContext] 用于读写 extensionSettings 账本
 * @property {Record<string, object>} [envelopes]
 *   测试注入已解析的信封；缺省从 assets/seed 加载
 * @property {(name: string) => Promise<object>} [loadEnvelope]
 *   可覆盖加载器
 */

/**
 * @returns {{ getItem: (k: string) => string|null, setItem: (k: string, v: string) => void }}
 */
function defaultStorage() {
    try {
        if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
            return globalThis.localStorage;
        }
    } catch {
        // private mode / 无 DOM
    }
    if (!sharedFallbackStorage) {
        /** @type {Map<string, string>} */
        const mem = new Map();
        sharedFallbackStorage = {
            getItem(k) {
                return mem.has(k) ? /** @type {string} */ (mem.get(k)) : null;
            },
            setItem(k, v) {
                mem.set(k, String(v));
            },
        };
    }
    return sharedFallbackStorage;
}

/**
 * @param {unknown} raw
 * @returns {SeedLedger}
 */
export function normalizeSeedLedger(raw) {
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const ids = Array.isArray(parsed?.offeredIds)
            ? parsed.offeredIds.map(String).filter(Boolean)
            : [];
        return { version: 1, offeredIds: [...new Set(ids)] };
    } catch {
        return { version: 1, offeredIds: [] };
    }
}

/**
 * @param {{ getItem: (k: string) => string|null }} storage
 * @returns {SeedLedger}
 */
export function readSeedLedger(storage) {
    try {
        return normalizeSeedLedger(storage.getItem(SEED_LEDGER_KEY));
    } catch {
        return { version: 1, offeredIds: [] };
    }
}

/**
 * @param {{ setItem: (k: string, v: string) => void }} storage
 * @param {SeedLedger} ledger
 */
export function writeSeedLedger(storage, ledger) {
    const payload = {
        version: 1,
        offeredIds: [...new Set((ledger?.offeredIds || []).map(String).filter(Boolean))],
    };
    storage.setItem(SEED_LEDGER_KEY, JSON.stringify(payload));
}

/**
 * 合并 localStorage + extensionSettings 两处账本（并集）。
 * @param {SeedInstallDeps} deps
 * @param {{ getItem: (k: string) => string|null, setItem: (k: string, v: string) => void }} storage
 * @returns {SeedLedger}
 */
export function loadMergedSeedLedger(deps, storage) {
    const fromStorage = readSeedLedger(storage);
    /** @type {string[]} */
    let fromExt = [];
    try {
        const ctx = typeof deps.getContext === 'function' ? deps.getContext() : null;
        if (ctx?.extensionSettings && typeof ctx.extensionSettings === 'object') {
            fromExt = normalizeSeedLedger(ctx.extensionSettings[SEED_LEDGER_EXTENSION_KEY]).offeredIds;
        }
    } catch {
        // ignore
    }
    return {
        version: 1,
        offeredIds: [...new Set([...fromStorage.offeredIds, ...fromExt])],
    };
}

/**
 * 双写：localStorage（或注入 storage）+ extensionSettings。
 * @param {SeedInstallDeps} deps
 * @param {{ setItem: (k: string, v: string) => void }} storage
 * @param {SeedLedger} ledger
 */
export function persistSeedLedger(deps, storage, ledger) {
    const payload = {
        version: 1,
        offeredIds: [...new Set((ledger?.offeredIds || []).map(String).filter(Boolean))],
    };
    try {
        writeSeedLedger(storage, payload);
    } catch {
        // ignore
    }
    try {
        const ctx = typeof deps.getContext === 'function' ? deps.getContext() : null;
        if (ctx?.extensionSettings && typeof ctx.extensionSettings === 'object') {
            ctx.extensionSettings[SEED_LEDGER_EXTENSION_KEY] = payload;
            if (typeof ctx.saveSettingsDebounced === 'function') {
                ctx.saveSettingsDebounced();
            }
        }
    } catch {
        // ignore
    }
}

/**
 * 解析 assets/seed 下某个 JSON（Node 读盘；浏览器 fetch import.meta.url）。
 * @param {string} fileName
 * @returns {Promise<object>}
 */
export async function loadSeedEnvelopeFromDisk(fileName) {
    const url = new URL(`../../assets/seed/${fileName}`, import.meta.url);
    if (typeof process !== 'undefined' && process.versions?.node) {
        const { readFileSync } = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const text = readFileSync(fileURLToPath(url), 'utf8');
        return JSON.parse(text);
    }
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`无法加载种子资产 ${fileName}（HTTP ${res.status}）`);
    }
    return res.json();
}

/**
 * @param {SeedInstallDeps} deps
 * @returns {Promise<Record<string, object>>}
 */
async function resolveEnvelopes(deps) {
    if (deps.envelopes && typeof deps.envelopes === 'object') {
        return deps.envelopes;
    }
    const load = typeof deps.loadEnvelope === 'function'
        ? deps.loadEnvelope
        : loadSeedEnvelopeFromDisk;
    /** @type {Record<string, object>} */
    const out = {};
    for (const name of SEED_ASSET_FILES) {
        out[name] = await load(name);
    }
    return out;
}

/**
 * @param {unknown} result
 * @returns {boolean}
 */
function isOkResult(result) {
    return !!(result && typeof result === 'object' && /** @type {any} */ (result).ok === true);
}

/**
 * 把信封里的 items 逐条写入（strategy 语义：已存在则跳过）。
 * @param {object} args
 * @param {object} args.envelope
 * @param {'preset'|'artist'|'llm-config'|'nai-config'} args.kind
 * @param {{ get: Function, put: Function, importJson?: Function }} args.repo
 * @param {(raw: unknown) => { ok: boolean, value?: any, error?: any }} args.validate
 * @param {Set<string>} args.offered
 * @returns {Promise<{ imported: string[], skipped: string[], errors: string[] }>}
 */
async function importEnvelopeItems(args) {
    const { envelope, kind, repo, validate, offered } = args;
    /** @type {string[]} */
    const imported = [];
    /** @type {string[]} */
    const skipped = [];
    /** @type {string[]} */
    const errors = [];

    if (!envelope || typeof envelope !== 'object') {
        errors.push(`${kind}: 信封不是对象`);
        return { imported, skipped, errors };
    }
    if (envelope.kind != null && String(envelope.kind) !== kind) {
        errors.push(`${kind}: kind 不匹配（期望 ${kind}，实际 ${String(envelope.kind)}）`);
        return { imported, skipped, errors };
    }

    const items = Array.isArray(envelope.items)
        ? envelope.items
        : Array.isArray(envelope.entries)
            ? envelope.entries
            : [];

    for (const raw of items) {
        const validated = validate(raw);
        if (!validated.ok) {
            errors.push(validated.error?.message || `${kind} 校验失败`);
            continue;
        }
        const entity = validated.value;
        const id = String(entity.id);

        let existing = null;
        try {
            const getR = await repo.get(id);
            if (isOkResult(getR)) {
                existing = getR.value;
            } else if (getR && typeof getR === 'object' && 'ok' in getR) {
                // Result.err：当作不存在，尝试写入；写入失败再记错
                existing = null;
            } else {
                // 非 Result 形状（极少）
                existing = getR ?? null;
            }
        } catch (err) {
            errors.push(`${id}: get 失败 ${err instanceof Error ? err.message : String(err)}`);
            continue;
        }

        if (offered.has(id) && !existing) {
            // 账本已记过且库中已删：不复活
            skipped.push(id);
            continue;
        }

        if (offered.has(id) && existing) {
            skipped.push(id);
            continue;
        }

        if (existing) {
            // 已有同 id：登记为已提供，绝不 overwrite
            offered.add(id);
            skipped.push(id);
            continue;
        }

        try {
            const putR = await repo.put(entity);
            if (putR && typeof putR === 'object' && 'ok' in putR && putR.ok === false) {
                errors.push(`${id}: ${putR.error?.message || 'put 失败'}`);
                continue;
            }
            offered.add(id);
            imported.push(id);
        } catch (err) {
            errors.push(`${id}: put 失败 ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    return { imported, skipped, errors };
}

/**
 * 首次安装后若尚未选定预设 / API 配置，自动指向种子（不覆盖用户已选）。
 * @param {SeedInstallDeps} deps
 * @param {{
 *   imagegenId?: string|null,
 *   recallId?: string|null,
 *   singleRecallId?: string|null,
 *   singleImagegenId?: string|null,
 *   llmId?: string|null,
 *   naiId?: string|null,
 * }} ids
 */
function maybeActivateSeeds(deps, ids) {
    try {
        const settings = deps.loadSettings();
        /** @type {Partial<import('../domain/model/plugin-settings.js').PluginSettings>} */
        const patch = {};
        if (!settings.activeImagegenPresetId && ids.imagegenId) {
            patch.activeImagegenPresetId = ids.imagegenId;
        }
        if (!settings.activeRecallPresetId && ids.recallId) {
            patch.activeRecallPresetId = ids.recallId;
        }
        if (!settings.activeSingleRecallPresetId && ids.singleRecallId) {
            patch.activeSingleRecallPresetId = ids.singleRecallId;
        }
        if (!settings.activeSingleImagegenPresetId && ids.singleImagegenId) {
            patch.activeSingleImagegenPresetId = ids.singleImagegenId;
        }
        if (!settings.recallLlmConfigId && ids.llmId) {
            patch.recallLlmConfigId = ids.llmId;
        }
        if (!settings.promptGenLlmConfigId && ids.llmId) {
            patch.promptGenLlmConfigId = ids.llmId;
        }
        if (!settings.activeNaiConfigId && ids.naiId) {
            patch.activeNaiConfigId = ids.naiId;
        }
        if (Object.keys(patch).length === 0) {
            return;
        }
        deps.saveSettings({ ...settings, ...patch });
    } catch (err) {
        log.warn('seed auto-activate failed', {
            message: err instanceof Error ? err.message : String(err),
        });
    }
}

/**
 * 安装种子资产。任何失败只汇总返回，不抛。
 * @param {SeedInstallDeps} deps
 * @returns {Promise<{
 *   ok: boolean,
 *   imported: string[],
 *   skipped: string[],
 *   errors: string[],
 * }>}
 */
export async function installSeedAssets(deps) {
    /** @type {string[]} */
    const imported = [];
    /** @type {string[]} */
    const skipped = [];
    /** @type {string[]} */
    const errors = [];

    if (!deps || !deps.repos || typeof deps.loadSettings !== 'function'
        || typeof deps.saveSettings !== 'function') {
        return {
            ok: false,
            imported,
            skipped,
            errors: ['installSeedAssets: 缺少 repos / loadSettings / saveSettings'],
        };
    }

    const storage = deps.storage || defaultStorage();
    const ledger = loadMergedSeedLedger(deps, storage);
    const offered = new Set(ledger.offeredIds);

    /** @type {string|null} */
    let imagegenId = null;
    /** @type {string|null} */
    let recallId = null;
    /** @type {string|null} */
    let singleRecallId = null;
    /** @type {string|null} */
    let singleImagegenId = null;
    /** @type {string|null} */
    let llmId = null;
    /** @type {string|null} */
    let naiId = null;

    try {
        const envelopes = await resolveEnvelopes(deps);

        const presetEnv = envelopes['preset-imagegen.json'];
        const recallEnv = envelopes['preset-recall.json'];
        const singleRecallEnv = envelopes['preset-single-recall.json'];
        const singleImagegenEnv = envelopes['preset-single-imagegen.json'];
        const artistEnv = envelopes['artists.json'];
        const llmEnv = envelopes['llm-default.json'];
        const naiEnv = envelopes['nai-default.json'];

        // 合并全部 preset 信封再导入（同 kind）
        const presetItems = [
            ...(Array.isArray(presetEnv?.items) ? presetEnv.items : []),
            ...(Array.isArray(recallEnv?.items) ? recallEnv.items : []),
            ...(Array.isArray(singleRecallEnv?.items) ? singleRecallEnv.items : []),
            ...(Array.isArray(singleImagegenEnv?.items) ? singleImagegenEnv.items : []),
        ];
        const presetEnvelope = {
            schemaVersion: 1,
            kind: 'preset',
            items: presetItems,
        };
        const presetResult = await importEnvelopeItems({
            envelope: presetEnvelope,
            kind: 'preset',
            repo: deps.repos.preset,
            validate: validatePreset,
            offered,
        });
        imported.push(...presetResult.imported);
        skipped.push(...presetResult.skipped);
        errors.push(...presetResult.errors);

        for (const item of presetItems) {
            if (item?.kind === 'imagegen' && item?.id) {
                imagegenId = String(item.id);
            }
            if (item?.kind === 'recall' && item?.id) {
                recallId = String(item.id);
            }
            if (item?.kind === 'single-recall' && item?.id) {
                singleRecallId = String(item.id);
            }
            if (item?.kind === 'single-imagegen' && item?.id) {
                singleImagegenId = String(item.id);
            }
        }

        if (artistEnv) {
            const artistResult = await importEnvelopeItems({
                envelope: artistEnv,
                kind: 'artist',
                repo: deps.repos.artist,
                validate: validateArtist,
                offered,
            });
            imported.push(...artistResult.imported);
            skipped.push(...artistResult.skipped);
            errors.push(...artistResult.errors);
        }

        if (llmEnv && deps.repos.llmConfig) {
            const llmResult = await importEnvelopeItems({
                envelope: llmEnv,
                kind: 'llm-config',
                repo: deps.repos.llmConfig,
                validate: validateLlmApiConfig,
                offered,
            });
            imported.push(...llmResult.imported);
            skipped.push(...llmResult.skipped);
            errors.push(...llmResult.errors);
            const llmItems = Array.isArray(llmEnv.items) ? llmEnv.items : [];
            for (const item of llmItems) {
                if (item?.id) {
                    llmId = String(item.id);
                }
            }
        }

        if (naiEnv && deps.repos.naiConfig) {
            const naiResult = await importEnvelopeItems({
                envelope: naiEnv,
                kind: 'nai-config',
                repo: deps.repos.naiConfig,
                validate: validateNaiApiConfig,
                offered,
            });
            imported.push(...naiResult.imported);
            skipped.push(...naiResult.skipped);
            errors.push(...naiResult.errors);
            const naiItems = Array.isArray(naiEnv.items) ? naiEnv.items : [];
            for (const item of naiItems) {
                if (item?.id) {
                    naiId = String(item.id);
                }
            }
        }

        persistSeedLedger(deps, storage, { version: 1, offeredIds: [...offered] });
        maybeActivateSeeds(deps, {
            imagegenId,
            recallId,
            singleRecallId,
            singleImagegenId,
            llmId,
            naiId,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(message);
        log.warn('installSeedAssets failed', { message });
        // 尽量落盘已成功登记的 offered，避免部分成功后下次重复 put
        try {
            persistSeedLedger(deps, storage, { version: 1, offeredIds: [...offered] });
        } catch {
            // ignore
        }
    }

    if (errors.length) {
        log.warn('seed import finished with errors', {
            importedCount: imported.length,
            skippedCount: skipped.length,
            errors,
        });
    } else if (imported.length) {
        log.info('seed import completed', {
            importedCount: imported.length,
            skippedCount: skipped.length,
        });
    }

    return {
        ok: errors.length === 0,
        imported,
        skipped,
        errors,
    };
}

/**
 * 用注入块占位渲染生图 / 召回 / 单图种子预设，断言无残留 {{…}} 插件变量。
 * 供单测与自检；不写库。
 * @param {import('../domain/model/preset.js').Preset} preset
 * @returns {{ ok: boolean, messages: import('../ports/llm.port.js').ChatMessage[], leftovers: string[] }}
 */
export function smokeRenderSeedPreset(preset) {
    let blocks = createBlockSet();
    blocks = setBlock(blocks, VARIABLE_NAMES.WORLDINFO, 'WORLD_INFO_SAMPLE');
    blocks = setBlock(blocks, VARIABLE_NAMES.CONTEXT, 'CONTEXT_SAMPLE');
    blocks = setBlock(blocks, VARIABLE_NAMES.CHARACTER, 'CHARACTER_SAMPLE');
    blocks = setBlock(blocks, VARIABLE_NAMES.COMPOSITION, 'TAG_SAMPLE');
    blocks = setBlock(blocks, VARIABLE_NAMES.FEATURE, 'FEATURE_SAMPLE');
    blocks = setBlock(blocks, VARIABLE_NAMES.CONSTANT, 'CONSTANT_SAMPLE');
    blocks = setBlock(blocks, VARIABLE_NAMES.RECENT_SLOTS, 'RECENT_SLOTS_SAMPLE');
    blocks = setBlock(blocks, VARIABLE_NAMES.USER_DESC, 'USER_DESC_SAMPLE');
    blocks = setBlock(blocks, RECALL_CANDIDATE_KEYS_VAR, 'key_a\nkey_b');

    const messages = renderPreset(preset, blocks, {
        runHostMacros: (t) => t,
    });
    const joined = messages.map((m) => m.content).join('\n');
    /** 插件登记变量：中文主名 + 召回候选 */
    const known = [
        VARIABLE_NAMES.WORLDINFO,
        VARIABLE_NAMES.CONTEXT,
        VARIABLE_NAMES.CHARACTER,
        VARIABLE_NAMES.COMPOSITION,
        VARIABLE_NAMES.FEATURE,
        VARIABLE_NAMES.CONSTANT,
        VARIABLE_NAMES.RECENT_SLOTS,
        VARIABLE_NAMES.USER_DESC,
        RECALL_CANDIDATE_KEYS_VAR,
    ];
    const leftovers = [];
    for (const m of joined.matchAll(/\{\{([^{}]+)\}\}/g)) {
        const name = String(m[1]).trim();
        const hit = known.some((k) => k === name);
        if (hit) {
            leftovers.push(m[0]);
        }
    }
    return { ok: leftovers.length === 0, messages, leftovers };
}
