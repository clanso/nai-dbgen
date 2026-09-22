/**
 * L4 应用层 · 标签召回：一次 LLM，只传 key，回文对 key 后取 value。
 * 归属：W2-F 用例代理实现。
 * 裁决 D31：返回 `{ matched, unmatched }`；注入只用 matched；unmatched 必须上浮可观测。
 */

import { Ok, Err } from '../infra/result.js';
import { configError, contractError } from '../infra/errors.js';
import { createLogger } from '../infra/logger.js';
import { createBlockSet, setBlock } from '../domain/blocks/block-set.js';
import { VARIABLE_NAMES } from '../domain/template/variable-map.js';
import { renderPreset } from '../domain/template/preset-renderer.js';
import { reconcileRecalledKeys } from '../domain/matching/tag-recall.js';
import {
    abortErrIfNeeded,
    attachTraceId,
    extractRecalledKeyList,
    RECALL_CANDIDATE_KEYS_VAR,
    RECALL_KEYS_JSON_SCHEMA,
} from './_helpers.js';

const log = createLogger('application/tag-recall');

/**
 * @typedef {import('../domain/model/plugin-settings.js').PluginSettings} PluginSettings
 * @typedef {import('../domain/model/tag.js').TagEntry} TagEntry
 */

/**
 * @typedef {object} TagRecallDeps
 * @property {import('../ports/llm.port.js').LlmPort} llm
 * @property {import('../ports/repository.port.js').TagRepository} tagRepo
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/preset.js').Preset>} presetRepo
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/api-config.js').LlmApiConfig>} llmConfigRepo
 * @property {() => PluginSettings} loadSettings
 * @property {(template: string) => string} runHostMacros
 */

/**
 * @typedef {object} TagRecallInput
 * @property {string} contextText 当前上下文
 * @property {string[]} [libraryIds] 工作台可覆盖本次勾选的库；缺省用全局已激活库
 * @property {string} [traceId]
 * @property {AbortSignal} [signal]
 */

/**
 * 裁决 D31：召回结果。注入只用 matched；unmatched 必须交给上层（toast / 面板）。
 * @typedef {object} TagRecallResult
 * @property {TagEntry[]} matched
 * @property {string[]} unmatched
 */

/**
 * @param {TagRecallDeps} deps
 * @returns {{ recall: (input: TagRecallInput) => Promise<import('../infra/result.js').Ok<TagRecallResult>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>> }}
 */
export function createTagRecallService(deps) {
    return {
        /**
         * @param {TagRecallInput} input
         */
        async recall(input) {
            const traceId = input?.traceId;
            const aborted = abortErrIfNeeded(input?.signal, traceId);
            if (aborted) {
                return aborted;
            }

            const settings = deps.loadSettings();
            const libsR = await deps.tagRepo.listLibraries();
            if (!libsR.ok) {
                return attachTraceId(libsR, traceId);
            }

            /** @type {Set<string>|null} */
            let overrideIds = null;
            if (Array.isArray(input.libraryIds)) {
                overrideIds = new Set(input.libraryIds.map(String));
            }

            const activeLibs = libsR.value.filter((lib) => {
                if (!lib) {
                    return false;
                }
                if (overrideIds) {
                    return overrideIds.has(lib.id);
                }
                return lib.active === true;
            });

            /** @type {TagEntry[]} */
            const activeEntries = [];
            for (const lib of activeLibs) {
                const er = await deps.tagRepo.listEntries(lib.id);
                if (!er.ok) {
                    return attachTraceId(er, traceId);
                }
                activeEntries.push(...er.value);
            }

            const candidateKeys = activeEntries
                .map((e) => e?.key)
                .filter((k) => typeof k === 'string' && k.length > 0);

            // 无候选：不调用 LLM
            if (candidateKeys.length === 0) {
                return Ok({ matched: [], unmatched: [] });
            }

            if (!settings.recallLlmConfigId) {
                return Err(configError({
                    code: 'RECALL_LLM_UNSET',
                    message: '未选择标签召回用的 LLM 配置',
                    hint: '请在运行配置中为「标签召回」选定 LLM',
                    traceId: traceId ?? null,
                }));
            }
            if (!settings.activeRecallPresetId) {
                return Err(configError({
                    code: 'RECALL_PRESET_UNSET',
                    message: '未选择召回预设',
                    hint: '请先编写并选中一份召回预设',
                    traceId: traceId ?? null,
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
                    traceId: traceId ?? null,
                    context: { id: settings.recallLlmConfigId },
                }));
            }

            const presetR = await deps.presetRepo.get(settings.activeRecallPresetId);
            if (!presetR.ok) {
                return attachTraceId(presetR, traceId);
            }
            if (!presetR.value || presetR.value.kind !== 'recall') {
                return Err(configError({
                    code: 'RECALL_PRESET_MISSING',
                    message: '召回预设不存在或类型不对',
                    hint: '请选择 kind=recall 的预设',
                    traceId: traceId ?? null,
                    context: { id: settings.activeRecallPresetId },
                }));
            }

            let blocks = createBlockSet();
            blocks = setBlock(blocks, VARIABLE_NAMES.CONTEXT, String(input.contextText ?? ''));
            blocks = setBlock(blocks, RECALL_CANDIDATE_KEYS_VAR, candidateKeys.join('\n'));
            blocks = setBlock(blocks, 'candidate_keys', candidateKeys.join('\n'));
            blocks = setBlock(blocks, 'keys', candidateKeys.join('\n'));

            const messages = renderPreset(presetR.value, blocks, {
                runHostMacros: deps.runHostMacros,
            });

            const aborted2 = abortErrIfNeeded(input?.signal, traceId);
            if (aborted2) {
                return aborted2;
            }

            const llmR = await deps.llm.complete({
                messages,
                config: configR.value,
                jsonSchema: RECALL_KEYS_JSON_SCHEMA,
                signal: input?.signal,
                traceId,
            });
            if (!llmR.ok) {
                return attachTraceId(llmR, traceId);
            }

            const recalledKeys = extractRecalledKeyList(llmR.value.json, llmR.value.text);
            const { matched, unmatched } = reconcileRecalledKeys(recalledKeys, activeEntries);

            if (unmatched.length > 0) {
                log.warn('tag recall unmatched keys', {
                    traceId,
                    unmatched,
                    unmatchedCount: unmatched.length,
                    matchedCount: matched.length,
                });
            }

            if (llmR.value.json == null && matched.length === 0 && recalledKeys.length === 0) {
                if (!llmR.value.text || !String(llmR.value.text).trim()) {
                    return Err(contractError({
                        code: 'RECALL_EMPTY_RESPONSE',
                        message: '标签召回 LLM 回文为空',
                        hint: '请检查召回预设与模型是否按约定返回 key 列表',
                        traceId: traceId ?? null,
                        context: { rawText: llmR.value.text },
                    }));
                }
            }

            return Ok({ matched, unmatched });
        },
    };
}
