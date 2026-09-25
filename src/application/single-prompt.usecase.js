/**
 * L4 应用层 · 4.16 单图提示词接口。
 *
 * 恰好 2 次 LLM（单图召回 + 单图写提示词）；构图候选为空时跳过召回（零信息不花钱），
 * 此时 llmCallCount=1。不写 slot、不改楼层、不存记录、不调 NAI、不改设置。
 *
 * 防重复计费：同一 chatId + 视点楼 + description（trim 后）并发共享 Promise。
 */

import { Ok, Err } from '../infra/result.js';
import { configError, contractError, domainError } from '../infra/errors.js';
import { createLogger } from '../infra/logger.js';
import { createBlockSet, setBlock } from '../domain/blocks/block-set.js';
import { VARIABLE_NAMES } from '../domain/template/variable-map.js';
import { formatSingleCompositionBlock } from '../domain/blocks/composition.block.js';
import { formatRecentSlotsBlock } from '../domain/blocks/recent-slots.block.js';
import { renderPreset } from '../domain/template/preset-renderer.js';
import { formatRecallCandidateLines, reconcileRecalledIds } from '../domain/matching/tag-recall.js';
import { parseFlatSingleCaption } from '../domain/model/flat-imagegen.js';
import { recordParseFailure } from './parse-debug-log.js';
import { validateNaiCaption } from '../domain/model/nai-params.js';
import { normalizeTagLibraryKind } from '../domain/model/tag.js';
import {
    abortErrIfNeeded,
    attachTraceId,
    extractRecalledKeyList,
    extractSingleCaption,
    extractOptionalSizeAnalysis,
    RECALL_CANDIDATE_KEYS_VAR,
} from './_helpers.js';
import { singlePromptGateKey } from './_gate-key.js';

export { extractSingleCaption, extractOptionalSizeAnalysis };

const log = createLogger('application/single-prompt');

/** 单图召回：{"key":[...]} */
export const SINGLE_RECALL_JSON_SCHEMA = Object.freeze({
    name: 'single_recall_keys',
    schema: {
        type: 'object',
        properties: {
            key: { type: 'array', items: { type: 'string' } },
        },
        required: ['key'],
    },
});

/** 单图写提示词：{"caption": caption}，可选 size / analysis */
export const SINGLE_IMAGEGEN_JSON_SCHEMA = Object.freeze({
    name: 'single_imagegen_caption',
    schema: {
        type: 'object',
        properties: {
            caption: {
                type: 'object',
                properties: {
                    v4_prompt: { type: 'object' },
                    v4_negative_prompt: { type: 'object' },
                },
                required: ['v4_prompt', 'v4_negative_prompt'],
            },
            size: { type: 'string' },
            analysis: { type: 'string' },
        },
        required: ['caption'],
    },
});

/**
 * @typedef {import('../domain/model/plugin-settings.js').PluginSettings} PluginSettings
 * @typedef {import('../domain/model/nai-params.js').NaiCaption} NaiCaption
 * @typedef {import('../domain/model/tag.js').TagEntry} TagEntry
 */

/**
 * @typedef {object} SinglePromptDeps
 * @property {import('../ports/host.port.js').HostPort} host
 * @property {import('../ports/llm.port.js').LlmPort} llm
 * @property {import('../ports/repository.port.js').TagRepository} tagRepo
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/preset.js').Preset>} presetRepo
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/api-config.js').LlmApiConfig>} llmConfigRepo
 * @property {import('../ports/repository.port.js').SlotRepository} slotRepo
 * @property {ReturnType<import('./viewpoint-blocks.js').createViewpointBlocksBuilder>} viewpointBlocks
 * @property {() => PluginSettings} loadSettings
 * @property {(template: string) => string} runHostMacros
 * @property {() => string} newTraceId
 */

/**
 * @typedef {object} SinglePromptInput
 * @property {string} description 用户描述（必填）
 * @property {number} [messageId] 视点楼；缺省 = 最新 AI 回复楼
 * @property {AbortSignal} [signal]
 */

/**
 * @typedef {object} SinglePromptResult
 * @property {NaiCaption} caption
 * @property {string} [size] 「尺寸」；无则不返回该键
 * @property {string} [analysis] 「解析」；无则不返回该键
 * @property {number} messageId
 * @property {string} traceId
 * @property {number} llmCallCount
 * @property {string[]} recalledKeys
 * @property {string[]} unmatchedKeys
 */

/**
 * @param {SinglePromptDeps} deps
 * @returns {{
 *   execute: (input: SinglePromptInput) => Promise<import('../infra/result.js').Ok<SinglePromptResult>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>,
 * }}
 */
export function createSinglePromptUseCase(deps) {
    /** @type {Map<string, Promise<import('../infra/result.js').Ok<SinglePromptResult>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>>} */
    const inflight = new Map();

    /**
     * @param {SinglePromptInput} input
     */
    async function runOnce(input) {
        const traceId = deps.newTraceId();
        const signal = input?.signal;
        const description = String(input?.description ?? '').trim();
        /** @type {number} */
        let llmCallCount = 0;

        const aborted0 = abortErrIfNeeded(signal, traceId);
        if (aborted0) {
            return aborted0;
        }

        if (!description) {
            return Err(domainError({
                code: 'SINGLE_DESC_EMPTY',
                message: '用户描述为空',
                hint: '请传入一段非空的描述',
                traceId,
            }));
        }

        const blocksR = await deps.viewpointBlocks.build({
            messageId: input?.messageId,
            extraScanText: description,
            signal,
            traceId,
        });
        if (!blocksR.ok) {
            return attachTraceId(blocksR, traceId);
        }
        const {
            messageId,
            worldInfoText,
            contextText,
            characterText,
            featureText,
            constantText,
        } = blocksR.value;

        // ── 单图召回 ★LLM #1（构图候选为空则跳过）──────────────────
        /** @type {TagEntry[]} */
        let matchedEntries = [];
        /** @type {string[]} */
        let unmatchedKeys = [];
        /** @type {string[]} */
        let recalledKeys = [];

        const candR = await loadCompositionCandidates(deps, traceId);
        if (!candR.ok) {
            return candR;
        }
        const { candidateKeys, activeEntries } = candR.value;

        if (candidateKeys.length === 0) {
            log.info('skip single recall: no composition candidates', { traceId });
        } else {
            const recallR = await runSingleRecall(deps, {
                contextText,
                description,
                candidateKeys,
                activeEntries,
                signal,
                traceId,
            });
            if (!recallR.ok) {
                return recallR;
            }
            llmCallCount += 1;
            matchedEntries = recallR.value.matched;
            unmatchedKeys = recallR.value.unmatched;
            recalledKeys = matchedEntries.map((e) => e.key);
        }

        const compositionText = formatSingleCompositionBlock(matchedEntries);

        let recentSlotsText = '';
        const retainedR = await deps.slotRepo.listRetained();
        if (!retainedR.ok) {
            return attachTraceId(retainedR, traceId);
        }
        recentSlotsText = formatRecentSlotsBlock(retainedR.value);

        // ── 单图写提示词 ★LLM #2 ───────────────────────────────────
        const promptR = await runSingleImagegen(deps, {
            worldInfoText,
            contextText,
            characterText,
            compositionText,
            featureText,
            constantText,
            recentSlotsText,
            description,
            signal,
            traceId,
        });
        if (!promptR.ok) {
            return promptR;
        }
        llmCallCount += 1;

        /** @type {SinglePromptResult} */
        const result = {
            caption: promptR.value.caption,
            messageId,
            traceId,
            llmCallCount,
            recalledKeys,
            unmatchedKeys,
        };
        if (promptR.value.size != null) {
            result.size = promptR.value.size;
        }
        if (promptR.value.analysis != null) {
            result.analysis = promptR.value.analysis;
        }
        return Ok(result);
    }

    return {
        /**
         * @param {SinglePromptInput} input
         */
        execute(input) {
            const description = String(input?.description ?? '').trim();
            if (!description) {
                return Promise.resolve(Err(domainError({
                    code: 'SINGLE_DESC_EMPTY',
                    message: '用户描述为空',
                    hint: '请传入一段非空的描述',
                })));
            }

            const messageId = resolveViewpointMessageId(deps.host, input?.messageId);
            if (messageId == null) {
                return Promise.resolve(Err(domainError({
                    code: 'VIEWPOINT_NOT_FOUND',
                    message: '找不到视点楼',
                    hint: '请确认当前聊天有 AI 回复，或传入有效的 messageId',
                    context: { messageId: input?.messageId ?? null },
                })));
            }

            const key = singlePromptGateKey(
                deps.host.getCurrentChatId(),
                messageId,
                description,
            );
            const existing = inflight.get(key);
            if (existing) {
                return existing;
            }
            const promise = runOnce({
                ...input,
                description,
                messageId,
            }).finally(() => {
                if (inflight.get(key) === promise) {
                    inflight.delete(key);
                }
            });
            inflight.set(key, promise);
            return promise;
        },
    };
}

/**
 * @param {SinglePromptDeps} deps
 * @param {string} traceId
 * @returns {Promise<import('../infra/result.js').Ok<{ candidateKeys: string[], activeEntries: TagEntry[] }>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>}
 */
async function loadCompositionCandidates(deps, traceId) {
    const libsR = await deps.tagRepo.listLibraries();
    if (!libsR.ok) {
        return attachTraceId(libsR, traceId);
    }

    const activeLibs = libsR.value.filter(
        (lib) => lib
            && lib.active === true
            && normalizeTagLibraryKind(lib.kind) === 'composition',
    );

    /** @type {TagEntry[]} */
    const activeEntries = [];
    for (const lib of activeLibs) {
        const er = await deps.tagRepo.listEntries(lib.id);
        if (!er.ok) {
            return attachTraceId(er, traceId);
        }
        activeEntries.push(...er.value.filter((entry) => entry && entry.active !== false));
    }

    const { lines, ordered } = formatRecallCandidateLines(activeEntries);
    return Ok({ candidateKeys: lines, activeEntries: ordered });
}

/**
 * @param {SinglePromptDeps} deps
 * @param {object} opts
 * @param {string} opts.contextText
 * @param {string} opts.description
 * @param {string[]} opts.candidateKeys
 * @param {TagEntry[]} opts.activeEntries
 * @param {AbortSignal} [opts.signal]
 * @param {string} opts.traceId
 * @returns {Promise<import('../infra/result.js').Ok<{ matched: TagEntry[], unmatched: string[] }>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>}
 */
async function runSingleRecall(deps, opts) {
    const { traceId, signal } = opts;
    const settings = deps.loadSettings();

    if (!settings.recallLlmConfigId) {
        return Err(configError({
            code: 'RECALL_LLM_UNSET',
            message: '未选择标签召回用的 LLM 配置',
            hint: '请在运行配置中为「标签召回」选定 LLM',
            traceId,
        }));
    }
    if (!settings.activeSingleRecallPresetId) {
        return Err(configError({
            code: 'SINGLE_RECALL_PRESET_UNSET',
            message: '未选择单图召回预设',
            hint: '请在预设管理中为「单图召回」设为当前',
            traceId,
        }));
    }

    const configR = await deps.llmConfigRepo.get(settings.recallLlmConfigId);
    if (!configR.ok) {
        return attachTraceId(configR, traceId);
    }
    if (!configR.value) {
        return Err(configError({
            code: 'RECALL_LLM_MISSING',
            message: '标签召回 LLM 配置不存在',
            hint: '请重新选择召回用的 LLM 配置',
            traceId,
            context: { id: settings.recallLlmConfigId },
        }));
    }

    const presetR = await deps.presetRepo.get(settings.activeSingleRecallPresetId);
    if (!presetR.ok) {
        return attachTraceId(presetR, traceId);
    }
    if (!presetR.value || presetR.value.kind !== 'single-recall') {
        return Err(configError({
            code: 'SINGLE_RECALL_PRESET_MISSING',
            message: '单图召回预设不存在或类型不对',
            hint: '请选择一份单图召回预设并设为当前',
            traceId,
            context: { id: settings.activeSingleRecallPresetId },
        }));
    }

    const keysText = opts.candidateKeys.join('\n');
    let blocks = createBlockSet();
    blocks = setBlock(blocks, VARIABLE_NAMES.CONTEXT, opts.contextText);
    blocks = setBlock(blocks, VARIABLE_NAMES.USER_DESC, opts.description);
    blocks = setBlock(blocks, RECALL_CANDIDATE_KEYS_VAR, keysText);

    const messages = renderPreset(presetR.value, blocks, {
        runHostMacros: deps.runHostMacros,
    });

    const aborted = abortErrIfNeeded(signal, traceId);
    if (aborted) {
        return aborted;
    }

    const llmR = await deps.llm.complete({
        messages,
        config: configR.value,
        jsonSchema: SINGLE_RECALL_JSON_SCHEMA,
        signal,
        traceId,
    });
    if (!llmR.ok) {
        if (llmR.error?.context?.rawText != null) {
            recordParseFailure({
                stage: '召回',
                code: llmR.error.code,
                message: llmR.error.message,
                rawText: llmR.error.context.rawText,
            });
        }
        return attachTraceId(llmR, traceId);
    }

    const recallRawText = llmR.value.text;
    const rawKeys = extractRecalledKeyList(llmR.value.json, recallRawText);
    const { matched, unmatched } = reconcileRecalledIds(rawKeys, opts.activeEntries);

    if (unmatched.length > 0) {
        log.warn('single recall unmatched keys', {
            traceId,
            unmatched,
            matchedCount: matched.length,
        });
    }

    return Ok({ matched, unmatched });
}

/**
 * @param {SinglePromptDeps} deps
 * @param {object} opts
 * @param {string} opts.worldInfoText
 * @param {string} opts.contextText
 * @param {string} opts.characterText
 * @param {string} opts.compositionText
 * @param {string} opts.featureText
 * @param {string} opts.constantText
 * @param {string} opts.recentSlotsText
 * @param {string} opts.description
 * @param {AbortSignal} [opts.signal]
 * @param {string} opts.traceId
 * @returns {Promise<import('../infra/result.js').Ok<{ caption: NaiCaption, size?: string, analysis?: string }>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>}
 */
async function runSingleImagegen(deps, opts) {
    const { traceId, signal } = opts;
    const settings = deps.loadSettings();

    if (!settings.promptGenLlmConfigId) {
        return Err(configError({
            code: 'PROMPT_LLM_UNSET',
            message: '未选择提示词生成用的 LLM 配置',
            hint: '请在运行配置中为「提示词生成」选定 LLM',
            traceId,
        }));
    }
    if (!settings.activeSingleImagegenPresetId) {
        return Err(configError({
            code: 'SINGLE_IMAGEGEN_PRESET_UNSET',
            message: '未选择单图生图预设',
            hint: '请在预设管理中为「单图生图」设为当前',
            traceId,
        }));
    }

    const llmCfgR = await deps.llmConfigRepo.get(settings.promptGenLlmConfigId);
    if (!llmCfgR.ok) {
        return attachTraceId(llmCfgR, traceId);
    }
    if (!llmCfgR.value) {
        return Err(configError({
            code: 'PROMPT_LLM_MISSING',
            message: '提示词生成 LLM 配置不存在',
            hint: '请重新选择提示词生成用的 LLM',
            traceId,
            context: { id: settings.promptGenLlmConfigId },
        }));
    }

    const presetR = await deps.presetRepo.get(settings.activeSingleImagegenPresetId);
    if (!presetR.ok) {
        return attachTraceId(presetR, traceId);
    }
    if (!presetR.value || presetR.value.kind !== 'single-imagegen') {
        return Err(configError({
            code: 'SINGLE_IMAGEGEN_PRESET_MISSING',
            message: '单图生图预设不存在或类型不对',
            hint: '请选择一份单图生图预设并设为当前',
            traceId,
            context: { id: settings.activeSingleImagegenPresetId },
        }));
    }

    let blocks = createBlockSet();
    blocks = setBlock(blocks, VARIABLE_NAMES.WORLDINFO, opts.worldInfoText);
    blocks = setBlock(blocks, VARIABLE_NAMES.CONTEXT, opts.contextText);
    blocks = setBlock(blocks, VARIABLE_NAMES.CHARACTER, opts.characterText);
    blocks = setBlock(blocks, VARIABLE_NAMES.COMPOSITION, opts.compositionText);
    blocks = setBlock(blocks, VARIABLE_NAMES.FEATURE, opts.featureText);
    blocks = setBlock(blocks, VARIABLE_NAMES.CONSTANT, opts.constantText);
    blocks = setBlock(blocks, VARIABLE_NAMES.RECENT_SLOTS, opts.recentSlotsText ?? '');
    blocks = setBlock(blocks, VARIABLE_NAMES.USER_DESC, opts.description);

    const messages = renderPreset(presetR.value, blocks, {
        runHostMacros: deps.runHostMacros,
    });

    const aborted = abortErrIfNeeded(signal, traceId);
    if (aborted) {
        return aborted;
    }

    const llmR = await deps.llm.complete({
        messages,
        config: llmCfgR.value,
        signal,
        traceId,
    });
    if (!llmR.ok) {
        if (llmR.error?.context?.rawText != null) {
            recordParseFailure({
                stage: '生图',
                code: llmR.error.code,
                message: llmR.error.message,
                rawText: llmR.error.context.rawText,
            });
        }
        return attachTraceId(llmR, traceId);
    }

    const imagegenRawText = llmR.value.text;
    const flat = parseFlatSingleCaption(imagegenRawText);
    const rawCaption = flat?.caption ?? extractSingleCaption(llmR.value.json);
    if (rawCaption == null) {
        recordParseFailure({
            stage: '生图',
            code: 'SINGLE_CAPTION_SHAPE',
            message: '单图提示词返回格式不对',
            rawText: imagegenRawText,
        });
        return Err(contractError({
            code: 'SINGLE_CAPTION_SHAPE',
            message: '单图提示词返回格式不对',
            hint: '模型应按约定返回生图内容',
            traceId,
            context: { rawText: imagegenRawText, json: llmR.value.json },
        }));
    }

    const capR = validateNaiCaption(rawCaption);
    if (!capR.ok) {
        return Err(contractError({
            code: 'SINGLE_CAPTION_INVALID',
            message: '单图生图内容校验未通过',
            hint: capR.error?.message
                ? `${capR.error.message}；请检查生图内容结构是否完整`
                : '请检查生图内容结构是否完整',
            traceId,
            context: { rawCaption, cause: capR.error },
        }));
    }

    /** @type {{ caption: NaiCaption, size?: string, analysis?: string }} */
    const out = { caption: capR.value };
    const extras = flat
        ? { size: flat.size, analysis: flat.analysis }
        : extractOptionalSizeAnalysis(llmR.value.json);
    if (extras.size != null) {
        out.size = extras.size;
    }
    if (extras.analysis != null) {
        out.analysis = extras.analysis;
    }
    return Ok(out);
}

/**
 * @param {import('../ports/host.port.js').HostPort} host
 * @param {number} [explicitId]
 * @returns {number|null}
 */
function resolveViewpointMessageId(host, explicitId) {
    if (explicitId != null && Number.isInteger(Number(explicitId))) {
        const id = Number(explicitId);
        const msg = typeof host.getMessage === 'function' ? host.getMessage(id) : null;
        if (msg) {
            return id;
        }
        const all = host.getMessages() ?? [];
        if (all.some((m) => m && m.messageId === id)) {
            return id;
        }
        if (id >= 0 && id < all.length && all[id]) {
            return id;
        }
        return null;
    }
    const recent = host.getRecentAiMessages(1) ?? [];
    if (recent.length === 0) {
        return null;
    }
    const mid = recent[0].messageId;
    return Number.isInteger(mid) ? mid : null;
}
