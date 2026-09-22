/**
 * L4 应用层 · 生成工作台两个解耦功能：写提示词 / 用当前提示词出图。
 * 归属：W2-F 用例代理实现。
 *
 * 裁决 D13：工作台提示词为结构化 NaiCaption（base_caption + char_captions）。
 * 裁决 D33：显式注入 tagRecall，与主链路共用同一实例。
 */

import { Ok, Err } from '../infra/result.js';
import { configError, contractError } from '../infra/errors.js';
import { createLogger } from '../infra/logger.js';
import { newId } from '../infra/id.js';
import { createBlockSet, setBlock } from '../domain/blocks/block-set.js';
import { VARIABLE_NAMES } from '../domain/template/variable-map.js';
import { formatCharacterBlock } from '../domain/blocks/character.block.js';
import { formatTagBlock } from '../domain/blocks/tag.block.js';
import { activateCharacters } from '../domain/matching/activation.js';
import { renderPreset } from '../domain/template/preset-renderer.js';
import { validateNaiCaption, emptyNaiCaption } from '../domain/model/nai-params.js';
import {
    abortErrIfNeeded,
    attachTraceId,
    loadAllCharacters,
    WORKBENCH_CAPTION_JSON_SCHEMA,
} from './_helpers.js';

const log = createLogger('application/workbench');

/**
 * @typedef {import('../domain/model/nai-params.js').NaiCaption} NaiCaption
 * @typedef {import('../domain/model/nai-params.js').NaiParams} NaiParams
 * @typedef {import('../domain/model/plugin-settings.js').PluginSettings} PluginSettings
 * @typedef {import('../ports/image-gen.port.js').GeneratedImage} GeneratedImage
 */

/**
 * @typedef {object} WorkbenchDeps
 * @property {import('../ports/llm.port.js').LlmPort} llm
 * @property {import('./image-gen.service.js').ImageGenService} imageGen
 * @property {import('../ports/repository.port.js').CharacterRepository} characterRepo
 * @property {import('../ports/repository.port.js').TagRepository} tagRepo
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/preset.js').Preset>} [presetRepo]
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/api-config.js').LlmApiConfig>} llmConfigRepo
 * @property {ReturnType<import('./tag-recall.service.js').createTagRecallService>} tagRecall
 *   裁决 D33：与 generateSlots 共用同一实例，禁止现场 new
 * @property {() => PluginSettings} loadSettings
 * @property {(template: string) => string} runHostMacros
 */

/**
 * @typedef {object} WorkbenchWritePromptInput
 * @property {string} naturalLanguage
 * @property {string[]} libraryIds 本次勾选的标签库（不改全局激活）
 * @property {AbortSignal} [signal]
 * @property {string} [traceId]
 */

/**
 * @typedef {object} WorkbenchWritePromptResult
 * @property {NaiCaption} caption
 * @property {string[]} unmatchedKeys 裁决 D31：召回未命中，供 UI 展示
 */

/**
 * @typedef {object} WorkbenchGenerateInput
 * @property {NaiCaption} caption 当前工作台结构化提示词（裁决 D13）
 * @property {boolean} replaceCharacterKeywords 页面拨档，程序不自判
 * @property {Partial<NaiParams>} [params]
 * @property {AbortSignal} [signal]
 * @property {string} [traceId]
 */

/**
 * @param {WorkbenchDeps} deps
 * @returns {{
 *   writePrompt: (input: WorkbenchWritePromptInput) => Promise<import('../infra/result.js').Ok<WorkbenchWritePromptResult>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>,
 *   generateImage: (input: WorkbenchGenerateInput) => Promise<import('../infra/result.js').Ok<GeneratedImage[]>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>,
 * }}
 */
export function createWorkbenchService(deps) {
    return {
        /**
         * 只填工作台提示词：不出图、不改 replaceCharacterKeywords。
         * @param {WorkbenchWritePromptInput} input
         */
        async writePrompt(input) {
            const traceId = input?.traceId ?? newId('trace');
            const aborted = abortErrIfNeeded(input?.signal, traceId);
            if (aborted) {
                return aborted;
            }

            const settings = deps.loadSettings();
            const nl = String(input?.naturalLanguage ?? '');

            const charsBundle = await loadAllCharacters(deps.characterRepo);
            let characterText = '';
            if (charsBundle.ok) {
                const hit = activateCharacters(
                    charsBundle.value.groups,
                    charsBundle.value.characters,
                    nl,
                    settings.matchDefaults ?? { caseSensitive: false, matchWholeWords: false },
                );
                characterText = formatCharacterBlock(hit);
            }

            /** @type {import('../domain/model/tag.js').TagEntry[]} */
            let tagEntries = [];
            /** @type {string[]} */
            let unmatchedKeys = [];
            if (Array.isArray(input.libraryIds) && input.libraryIds.length > 0) {
                const tagR = await deps.tagRecall.recall({
                    contextText: nl,
                    libraryIds: input.libraryIds,
                    traceId,
                    signal: input.signal,
                });
                if (tagR.ok) {
                    tagEntries = tagR.value.matched;
                    unmatchedKeys = tagR.value.unmatched ?? [];
                } else if (tagR.error?.code === 'UPSTREAM_ABORTED') {
                    return attachTraceId(tagR, traceId);
                } else {
                    log.warn('workbench tag recall failed; degrading', {
                        traceId,
                        code: tagR.error?.code,
                    });
                }
            }

            const tagText = formatTagBlock(tagEntries);

            if (!settings.promptGenLlmConfigId) {
                return Err(configError({
                    code: 'PROMPT_LLM_UNSET',
                    message: '未选择提示词生成用的 LLM 配置',
                    hint: '请在运行配置中为「提示词生成」选定 LLM',
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
                }));
            }

            /** @type {import('../ports/llm.port.js').ChatMessage[]} */
            let messages;

            if (deps.presetRepo && settings.activeImagegenPresetId) {
                const presetR = await deps.presetRepo.get(settings.activeImagegenPresetId);
                if (presetR.ok && presetR.value && presetR.value.kind === 'imagegen') {
                    let blocks = createBlockSet();
                    blocks = setBlock(blocks, VARIABLE_NAMES.WORLDINFO, '');
                    blocks = setBlock(blocks, VARIABLE_NAMES.CONTEXT, nl);
                    blocks = setBlock(blocks, VARIABLE_NAMES.CHARACTER, characterText);
                    blocks = setBlock(blocks, VARIABLE_NAMES.TAG, tagText);
                    messages = renderPreset(presetR.value, blocks, {
                        runHostMacros: deps.runHostMacros,
                    });
                }
            }

            if (!messages) {
                messages = [
                    {
                        role: 'system',
                        content: '请根据用户自然语言、角色库注入块与标签库注入块，'
                            + '输出一份 NaiCaption JSON（含 v4_prompt / v4_negative_prompt）。'
                            + '不要输出 slot 数组。',
                    },
                    {
                        role: 'user',
                        content: [
                            `自然语言：\n${nl}`,
                            characterText ? `角色库：\n${characterText}` : '',
                            tagText ? `标签库：\n${tagText}` : '',
                        ].filter(Boolean).join('\n\n'),
                    },
                ];
            }

            const aborted2 = abortErrIfNeeded(input?.signal, traceId);
            if (aborted2) {
                return aborted2;
            }

            const llmR = await deps.llm.complete({
                messages,
                config: llmCfgR.value,
                jsonSchema: WORKBENCH_CAPTION_JSON_SCHEMA,
                signal: input.signal,
                traceId,
            });
            if (!llmR.ok) {
                return attachTraceId(llmR, traceId);
            }

            const capR = validateNaiCaption(llmR.value.json ?? emptyNaiCaption());
            if (!capR.ok) {
                return Err(contractError({
                    code: 'WORKBENCH_CAPTION_INVALID',
                    message: '工作台提示词生成结果格式无效',
                    hint: '请检查模型是否按 NaiCaption 结构输出',
                    traceId,
                    cause: capR.error,
                    context: { rawText: llmR.value.text, json: llmR.value.json },
                }));
            }

            return Ok({ caption: capR.value, unmatchedKeys });
        },

        /**
         * 用当前工作台提示词出图；replaceCharacterKeywords 必须由调用方显式传入。
         * @param {WorkbenchGenerateInput} input
         */
        async generateImage(input) {
            if (!input || typeof input !== 'object') {
                throw new Error('invalid argument: input');
            }
            if (typeof input.replaceCharacterKeywords !== 'boolean') {
                throw new Error('invalid argument: replaceCharacterKeywords');
            }

            const traceId = input.traceId ?? newId('trace');
            return deps.imageGen.generate({
                caption: input.caption,
                params: input.params,
                replaceCharacterKeywords: input.replaceCharacterKeywords,
                signal: input.signal,
                traceId,
            });
        },
    };
}
