/**
 * L4 应用层 · 步骤 4–5：准备四块、LLM 生提示词、写 slot。
 * 归属：W2-F。
 *
 * 裁决：
 * - D31：返回 unmatchedKeys
 * - D37：先 slotRepo.put，再 replaceMessageText（避免孤儿 token）
 * - D38：put 时保留已有 images，绝不抹掉已出图记录
 * - D41：用 tagRecall.llmCalled 计数，禁止改写共享 llm.complete
 */

import { Ok, Err } from '../infra/result.js';
import { configError, contractError, domainError } from '../infra/errors.js';
import { createLogger } from '../infra/logger.js';
import { createBlockSet, setBlock } from '../domain/blocks/block-set.js';
import { VARIABLE_NAMES } from '../domain/template/variable-map.js';
import { formatCharacterBlock } from '../domain/blocks/character.block.js';
import { formatTagBlock } from '../domain/blocks/tag.block.js';
import { activateCharacters } from '../domain/matching/activation.js';
import { renderPreset } from '../domain/template/preset-renderer.js';
import { placeSlots } from '../domain/slot/slot-placer.js';
import { createSlotRecord, slotPlanFromLlmItem } from '../domain/model/slot.js';
import {
    abortErrIfNeeded,
    attachTraceId,
    extractSlotPlanItems,
    loadAllCharacters,
    APP_EVENTS,
    SLOT_PLAN_JSON_SCHEMA,
} from './_helpers.js';

const log = createLogger('application/generate-slots');

/**
 * @typedef {import('../domain/model/plugin-settings.js').PluginSettings} PluginSettings
 */

/**
 * @typedef {object} GenerateSlotsDeps
 * @property {import('../ports/host.port.js').HostPort} host
 * @property {import('../ports/llm.port.js').LlmPort} llm
 * @property {import('../ports/repository.port.js').CharacterRepository} characterRepo
 * @property {import('../ports/repository.port.js').TagRepository} tagRepo
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/preset.js').Preset>} presetRepo
 * @property {import('../ports/repository.port.js').SlotRepository} slotRepo
 * @property {import('../ports/repository.port.js').Repository<import('../domain/model/api-config.js').LlmApiConfig>} llmConfigRepo
 * @property {ReturnType<import('./context-collector.js').createContextCollector>} contextCollector
 * @property {ReturnType<import('./worldinfo-resolver.js').createWorldInfoResolver>} worldInfoResolver
 * @property {ReturnType<import('./tag-recall.service.js').createTagRecallService>} tagRecall
 * @property {ReturnType<import('../infra/event-bus.js').createEventBus>} bus
 * @property {() => PluginSettings} loadSettings
 * @property {(template: string) => string} runHostMacros
 * @property {() => string} newId
 * @property {() => string} nowIso
 * @property {() => string} newTraceId
 */

/**
 * @typedef {object} GenerateSlotsOptions
 * @property {AbortSignal} [signal]
 * @property {string} [traceId]
 */

/**
 * @typedef {object} GenerateSlotsResult
 * @property {import('../domain/model/slot.js').SlotRecord[]} records
 * @property {string} traceId
 * @property {number} llmCallCount
 * @property {string[]} unmatchedKeys
 */

/**
 * @param {GenerateSlotsDeps} deps
 * @returns {{ execute: (messageId: number, opts?: GenerateSlotsOptions) => Promise<import('../infra/result.js').Ok<GenerateSlotsResult>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>> }}
 */
export function createGenerateSlotsUseCase(deps) {
    return {
        /**
         * @param {number} messageId
         * @param {GenerateSlotsOptions} [opts]
         */
        async execute(messageId, opts) {
            const traceId = opts?.traceId ?? deps.newTraceId();
            const signal = opts?.signal;
            /** @type {number} */
            let llmCallCount = 0;

            const aborted0 = abortErrIfNeeded(signal, traceId);
            if (aborted0) {
                return aborted0;
            }

            const settings = deps.loadSettings();

            // ── 1. 同一窗口（剥 slot）────────────────────────────────
            const window = deps.contextCollector.collect();
            const contextWindow = window.messages;
            const contextText = window.text;

            // ── 2. 世界书（resolver 失败已降为 Ok(degraded)）─────────
            const wiR = await deps.worldInfoResolver.resolve({
                contextWindow,
                messageId,
            });
            const worldInfoText = wiR.value.text;
            const worldInfoSnapshot = worldInfoText;

            // ── 3. 角色库 ────────────────────────────────────────────
            const charsBundle = await loadAllCharacters(deps.characterRepo);
            let characterText = '';
            if (charsBundle.ok) {
                const hit = activateCharacters(
                    charsBundle.value.groups,
                    charsBundle.value.characters,
                    contextText,
                    settings.matchDefaults ?? {
                        caseSensitive: false,
                        matchWholeWords: false,
                    },
                );
                characterText = formatCharacterBlock(hit);
            } else {
                log.warn('character repo failed; degrading character block', {
                    traceId,
                    code: charsBundle.error?.code,
                });
            }

            const aborted1 = abortErrIfNeeded(signal, traceId);
            if (aborted1) {
                return aborted1;
            }

            // ── 4. 标签召回 ★LLM #1 ──────────────────────────────────
            /** @type {import('../domain/model/tag.js').TagEntry[]} */
            let tagEntries = [];
            /** @type {string[]} */
            let unmatchedKeys = [];
            const tagR = await deps.tagRecall.recall({
                contextText,
                traceId,
                signal,
            });
            if (tagR.ok) {
                tagEntries = tagR.value.matched;
                unmatchedKeys = tagR.value.unmatched ?? [];
                if (tagR.value.llmCalled) {
                    llmCallCount += 1;
                }
                if (unmatchedKeys.length > 0) {
                    deps.bus.emit(APP_EVENTS.TAG_RECALL_UNMATCHED, {
                        messageId,
                        traceId,
                        unmatchedKeys,
                        matchedCount: tagEntries.length,
                    });
                }
            } else if (tagR.error?.code === 'UPSTREAM_ABORTED') {
                return attachTraceId(tagR, traceId);
            } else {
                // 失败也可能已调过 LLM（例如空回文 ContractError）
                if (tagR.error?.context?.llmCalled === true) {
                    llmCallCount += 1;
                }
                log.warn('tag recall failed; degrading tag block', {
                    traceId,
                    code: tagR.error?.code,
                    category: tagR.error?.category,
                });
            }

            const tagText = formatTagBlock(tagEntries);

            let blocks = createBlockSet();
            blocks = setBlock(blocks, VARIABLE_NAMES.WORLDINFO, worldInfoText);
            blocks = setBlock(blocks, VARIABLE_NAMES.CONTEXT, contextText);
            blocks = setBlock(blocks, VARIABLE_NAMES.CHARACTER, characterText);
            blocks = setBlock(blocks, VARIABLE_NAMES.TAG, tagText);

            // ── 5. 生图预设 + 提示词 LLM ★LLM #2 ─────────────────────
            if (!settings.promptGenLlmConfigId) {
                return Err(configError({
                    code: 'PROMPT_LLM_UNSET',
                    message: '未选择提示词生成用的 LLM 配置',
                    hint: '请在运行配置中为「提示词生成」选定 LLM',
                    traceId,
                }));
            }
            if (!settings.activeImagegenPresetId) {
                return Err(configError({
                    code: 'IMAGEGEN_PRESET_UNSET',
                    message: '未选择生图预设',
                    hint: '请先编写并选中一份生图预设',
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

            const presetR = await deps.presetRepo.get(settings.activeImagegenPresetId);
            if (!presetR.ok) {
                return attachTraceId(presetR, traceId);
            }
            if (!presetR.value || presetR.value.kind !== 'imagegen') {
                return Err(configError({
                    code: 'IMAGEGEN_PRESET_MISSING',
                    message: '生图预设不存在或类型不对',
                    hint: '请选择 kind=imagegen 的预设',
                    traceId,
                    context: { id: settings.activeImagegenPresetId },
                }));
            }

            const messages = renderPreset(presetR.value, blocks, {
                runHostMacros: deps.runHostMacros,
            });

            const aborted2 = abortErrIfNeeded(signal, traceId);
            if (aborted2) {
                return aborted2;
            }

            const promptR = await deps.llm.complete({
                messages,
                config: llmCfgR.value,
                jsonSchema: SLOT_PLAN_JSON_SCHEMA,
                signal,
                traceId,
            });
            llmCallCount += 1;
            if (!promptR.ok) {
                return attachTraceId(promptR, traceId);
            }

            const items = extractSlotPlanItems(promptR.value.json);
            if (items.length === 0) {
                return Err(contractError({
                    code: 'SLOT_PLAN_EMPTY',
                    message: '提示词生成未产出有效的生图计划',
                    hint: '请检查生图预设与模型是否按约定输出 JSON 数组',
                    traceId,
                    context: { rawText: promptR.value.text, json: promptR.value.json },
                }));
            }

            /** @type {import('../domain/model/slot.js').SlotPlan[]} */
            const plans = [];
            for (const item of items) {
                const pr = slotPlanFromLlmItem(item);
                if (!pr.ok) {
                    return attachTraceId(pr, traceId);
                }
                plans.push(pr.value);
            }

            const mes = deps.host.getMessage(messageId);
            if (!mes) {
                return Err(domainError({
                    code: 'MESSAGE_NOT_FOUND',
                    message: `找不到楼层 #${messageId}`,
                    hint: '请确认当前聊天仍打开且该楼存在',
                    traceId,
                    context: { messageId },
                }));
            }

            // D38：读取已有记录，保留 images（绝不用空数组抹掉）
            /** @type {Map<number, import('../domain/model/slot.js').SlotRecord>} */
            const existingById = new Map();
            const existingR = await deps.slotRepo.getByMessage(messageId);
            if (!existingR.ok) {
                // D39：读失败不得当空；中止写入以免覆盖未知状态
                log.warn('getByMessage failed before put; abort write', {
                    traceId,
                    messageId,
                    code: existingR.error?.code,
                });
                return attachTraceId(existingR, traceId);
            }
            for (const rec of existingR.value) {
                existingById.set(rec.slotId, rec);
            }

            const now = deps.nowIso();
            /** @type {import('../domain/model/slot.js').SlotRecord[]} */
            const records = plans.map((plan) => {
                const prev = existingById.get(plan.slotId);
                return createSlotRecord({
                    messageId,
                    slotId: plan.slotId,
                    caption: plan.caption,
                    anchorSentence: plan.anchorSentence,
                    images: prev?.images ?? [],
                    presetId: settings.activeImagegenPresetId,
                    llmConfigId: settings.promptGenLlmConfigId,
                    worldInfoSnapshot,
                    traceId,
                }, { now });
            });

            // D37：先写权威记录，再改正文
            const putR = await deps.slotRepo.put(messageId, records);
            if (!putR.ok) {
                return attachTraceId(putR, traceId);
            }

            const placed = placeSlots(mes.text ?? '', plans);
            const replaceR = await deps.host.replaceMessageText(messageId, placed.text);
            if (!replaceR.ok) {
                // 记录已在；正文未改 → 无孤儿 token；可重试覆盖
                return attachTraceId(replaceR, traceId);
            }

            deps.bus.emit(APP_EVENTS.SLOTS_WRITTEN, {
                messageId,
                records,
                traceId,
                llmCallCount,
                unmatchedKeys,
                placements: placed.placements,
            });

            if (llmCallCount !== 2) {
                log.warn('llmCallCount != 2 (empty candidate keys skip recall LLM)', {
                    traceId,
                    llmCallCount,
                });
            }

            return Ok({ records, traceId, llmCallCount, unmatchedKeys });
        },
    };
}
