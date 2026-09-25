/**
 * L4 应用层 · 生成工作台两个解耦功能：写提示词 / 用当前提示词出图。
 * 归属：W2-F / 代理 A。
 *
 * 裁决 D13：工作台提示词为结构化 NaiCaption（base_caption + char_captions）。
 * 裁决 D33：仍注入 tagRecall 同实例（装配契约），但写提示词按 4.15 不跑召回。
 * 需求 4.15：勾选构图库/特征库/常驻库整库交给提示词 LLM；特征库不做关键字匹配。
 */

import { Ok, Err } from '../infra/result.js';
import { configError, contractError } from '../infra/errors.js';
import { createLogger } from '../infra/logger.js';
import { newId } from '../infra/id.js';
import { createBlockSet, setBlock } from '../domain/blocks/block-set.js';
import { VARIABLE_NAMES } from '../domain/template/variable-map.js';
import { formatCharacterBlock } from '../domain/blocks/character.block.js';
import { formatSingleCompositionBlock } from '../domain/blocks/composition.block.js';
import { formatFeatureBlock } from '../domain/blocks/feature.block.js';
import { formatConstantBlock } from '../domain/blocks/constant.block.js';
import { activateCharacters } from '../domain/matching/activation.js';
import { normalizeTagLibraryKind } from '../domain/model/tag.js';
import { renderPreset } from '../domain/template/preset-renderer.js';
import { validateNaiCaption, emptyNaiCaption } from '../domain/model/nai-params.js';
import { parseFlatSingleCaption } from '../domain/model/flat-imagegen.js';
import { recordParseFailure } from './parse-debug-log.js';
import { parseSizeSpec } from '../domain/model/size-spec.js';
import {
    abortErrIfNeeded,
    attachTraceId,
    loadAllCharacters,
    extractSingleCaption,
    extractOptionalSizeAnalysis,
} from './_helpers.js';

const log = createLogger('application/workbench');

/**
 * @typedef {import('../domain/model/nai-params.js').NaiCaption} NaiCaption
 * @typedef {import('../domain/model/nai-params.js').NaiParams} NaiParams
 * @typedef {import('../domain/model/plugin-settings.js').PluginSettings} PluginSettings
 * @typedef {import('../ports/image-gen.port.js').GeneratedImage} GeneratedImage
 * @typedef {import('../domain/model/tag.js').TagEntry} TagEntry
 */

/**
 * @typedef {object} WorkbenchDeps
 * @property {import('../ports/llm.port.js').LlmPort} llm
 * @property {import('./image-gen.service.js').ImageGenService} imageGen
 * @property {import('../ports/repository.port.js').CharacterRepository} characterRepo
 * @property {import('../ports/repository.port.js').TagRepository} tagRepo
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/preset.js').Preset>} [presetRepo]
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/api-config.js').LlmApiConfig>} llmConfigRepo
 * @property {ReturnType<import('./tag-recall.service.js').createTagRecallService>} [tagRecall]
 *   裁决 D33：装配仍注入同实例；本服务写提示词路径不调用（需求 4.15）
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
 * @property {string[]} unmatchedKeys 工作台不跑召回，恒为空（供 UI 展示）
 * @property {number} [width] 模型回了合法「尺寸」时填入
 * @property {number} [height]
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
         * 只填工作台提示词：不出图、不改 replaceCharacterKeywords、不跑召回。
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
            } else {
                log.warn('workbench character repo failed', {
                    traceId,
                    code: charsBundle.error?.code,
                });
                return attachTraceId(charsBundle, traceId);
            }

            /** @type {TagEntry[]} */
            const compositionEntries = [];
            /** @type {TagEntry[]} */
            const featureEntries = [];
            /** @type {TagEntry[]} */
            const constantEntries = [];

            if (Array.isArray(input.libraryIds) && input.libraryIds.length > 0) {
                const libsR = await deps.tagRepo.listLibraries();
                if (!libsR.ok) {
                    return attachTraceId(libsR, traceId);
                }
                const idSet = new Set(input.libraryIds.map(String));
                const selected = libsR.value.filter((lib) => lib && idSet.has(String(lib.id)));
                for (const lib of selected) {
                    const er = await deps.tagRepo.listEntries(lib.id);
                    if (!er.ok) {
                        return attachTraceId(er, traceId);
                    }
                    const kind = normalizeTagLibraryKind(lib.kind);
                    const live = er.value.filter((entry) => entry && entry.active !== false);
                    if (kind === 'feature') {
                        featureEntries.push(...live);
                    } else if (kind === 'constant') {
                        constantEntries.push(...live);
                    } else {
                        compositionEntries.push(...live);
                    }
                }
            }

            const compositionText = formatSingleCompositionBlock(compositionEntries);
            const featureText = formatFeatureBlock(featureEntries);
            const constantText = formatConstantBlock(constantEntries);

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
                    blocks = setBlock(blocks, VARIABLE_NAMES.COMPOSITION, compositionText);
                    blocks = setBlock(blocks, VARIABLE_NAMES.FEATURE, featureText);
                    blocks = setBlock(blocks, VARIABLE_NAMES.CONSTANT, constantText);
                    // 工作台不走聊天会话，近期生图记录为空
                    blocks = setBlock(blocks, VARIABLE_NAMES.RECENT_SLOTS, '');
                    messages = renderPreset(presetR.value, blocks, {
                        runHostMacros: deps.runHostMacros,
                    });
                }
            }

            if (!messages) {
                messages = [
                    {
                        role: 'system',
                        content: '请根据用户自然语言、角色库注入块、构图标签、特征参考与常驻标签，'
                            + '输出一份生图提示词 JSON（含正负面场景与角色）。'
                            + '不要输出多图数组。',
                    },
                    {
                        role: 'user',
                        content: [
                            `自然语言：\n${nl}`,
                            characterText ? `角色库：\n${characterText}` : '',
                            compositionText ? `构图标签：\n${compositionText}` : '',
                            featureText ? `特征参考：\n${featureText}` : '',
                            constantText ? `常驻标签：\n${constantText}` : '',
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
                signal: input.signal,
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

            const rawJson = llmR.value.json;
            const imagegenRawText = llmR.value.text;
            const flat = parseFlatSingleCaption(imagegenRawText);
            const fromWrapped = extractSingleCaption(rawJson);
            const captionCandidate = flat?.caption ?? (fromWrapped != null ? fromWrapped : rawJson);
            const capR = validateNaiCaption(captionCandidate ?? emptyNaiCaption());
            if (!capR.ok) {
                recordParseFailure({
                    stage: '生图',
                    code: 'WORKBENCH_CAPTION_INVALID',
                    message: '工作台提示词生成结果格式无效',
                    rawText: imagegenRawText,
                });
                return Err(contractError({
                    code: 'WORKBENCH_CAPTION_INVALID',
                    message: '工作台提示词生成结果格式无效',
                    hint: '请检查模型是否按生图提示词结构输出',
                    traceId,
                    cause: capR.error,
                    context: { rawText: imagegenRawText, json: rawJson },
                }));
            }

            /** @type {WorkbenchWritePromptResult} */
            const result = { caption: capR.value, unmatchedKeys: [] };
            const extras = flat
                ? { size: flat.size, analysis: flat.analysis }
                : extractOptionalSizeAnalysis(rawJson);
            if (extras.size) {
                const sizeR = parseSizeSpec(extras.size);
                if (sizeR.ok) {
                    result.width = sizeR.value.width;
                    result.height = sizeR.value.height;
                }
            }
            return Ok(result);
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
