/**
 * L4 应用层 · 步骤 4–5：准备四块、LLM 生提示词、写 slot。
 * 归属：W2-F 用例代理实现。W0 仅冻结签名。
 * 断言：整条链路 LLM 调用恰为 2 次；同一次 execute 共用一个 traceId 串起两次 LLM。
 * （出图 / NAI 调用由 RenderSlotUseCase 另开 trace，不混在本链路。）
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
 * @property {string} [traceId] 若省略则 newTraceId()；须写入两次 LLM 调用的日志/错误
 */

/**
 * @typedef {object} GenerateSlotsResult
 * @property {import('../domain/model/slot.js').SlotRecord[]} records
 * @property {string} traceId
 * @property {number} llmCallCount 必须为 2
 * @property {string[]} unmatchedKeys 裁决 D31：召回未命中 key，供 UI toast / 面板
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

            const aborted0 = abortErrIfNeeded(signal, traceId);
            if (aborted0) {
                return aborted0;
            }

            // 与 tagRecall 共用同一 llm 对象引用时，包装 complete 可精确计数（验收 #6）
            const llm = deps.llm;
            const originalComplete = llm.complete.bind(llm);
            let llmCallCount = 0;
            llm.complete = async (req) => {
                llmCallCount += 1;
                return originalComplete(req);
            };

            try {
                const settings = deps.loadSettings();

                // ── 1. 同一窗口（剥 slot）────────────────────────────
                const window = deps.contextCollector.collect();
                const contextWindow = window.messages;
                const contextText = window.text;

                // ── 2. 世界书（同源窗口；失败已在 resolver 降级）──────
                const wiR = await deps.worldInfoResolver.resolve({
                    contextWindow,
                    messageId,
                });
                const worldInfoText = wiR.ok ? wiR.value.text : '';
                const worldInfoSnapshot = worldInfoText;

                // ── 3. 角色库（同源 contextText；仓库失败则空块）─────
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

                // ── 4. 标签召回 ★LLM #1（失败降级为空块）────────────
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

                // ── 5. 生图预设 + 提示词 LLM ★LLM #2 ─────────────────
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

                const promptR = await llm.complete({
                    messages,
                    config: llmCfgR.value,
                    jsonSchema: SLOT_PLAN_JSON_SCHEMA,
                    signal,
                    traceId,
                });
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

                // ── 6. 写 slot 进正文 ────────────────────────────────
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

                const placed = placeSlots(mes.text ?? '', plans);
                const replaceR = await deps.host.replaceMessageText(messageId, placed.text);
                if (!replaceR.ok) {
                    return attachTraceId(replaceR, traceId);
                }

                // ── 7. SlotRepo 落盘 ─────────────────────────────────
                const now = deps.nowIso();
                /** @type {import('../domain/model/slot.js').SlotRecord[]} */
                const records = plans.map((plan) => createSlotRecord({
                    messageId,
                    slotId: plan.slotId,
                    caption: plan.caption,
                    anchorSentence: plan.anchorSentence,
                    images: [],
                    presetId: settings.activeImagegenPresetId,
                    llmConfigId: settings.promptGenLlmConfigId,
                    worldInfoSnapshot,
                    traceId,
                }, { now }));

                const putR = await deps.slotRepo.put(messageId, records);
                if (!putR.ok) {
                    return attachTraceId(putR, traceId);
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
            } finally {
                llm.complete = originalComplete;
            }
        },
    };
}
