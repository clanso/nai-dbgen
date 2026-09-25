/**
 * W3 · container 装配：必填 deps、三处同实例、dispose。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    createContainer,
    assertRequiredDeps,
    REQUIRED_APP_DEPS,
} from '../../src/bootstrap/container.js';
import { createMemoryIdb } from '../../src/adapters/storage/memory-idb.js';
import { createSillyTavernHost, PLUGIN_NS } from '../../src/adapters/host/sillytavern.host.js';
import { createEventBus } from '../../src/infra/event-bus.js';
import { createTagRecallService as createTagRecall } from '../../src/application/tag-recall.service.js';
import { createGenerateSlotsUseCase as createGenSlots } from '../../src/application/generate-slots.usecase.js';
import { createWorkbenchService as createWorkbench } from '../../src/application/workbench.service.js';
import { createRenderSlotUseCase as createRenderSlot } from '../../src/application/render-slot.usecase.js';
import { createAutoTriggerService as createAutoTrigger } from '../../src/application/auto-trigger.service.js';
import { createImageGenService as createImageGen } from '../../src/application/image-gen.service.js';
import { createArtistPreviewService as createArtistPreview } from '../../src/application/artist-preview.service.js';
import { createContextCollector as createCtx } from '../../src/application/context-collector.js';
import { createWorldInfoResolver as createWi } from '../../src/application/worldinfo-resolver.js';
import { emptyNaiCaption } from '../../src/domain/model/nai-params.js';

function makeFakeContext() {
    const slashNames = [];
    return {
        chat: [
            { name: 'User', mes: 'hi', is_user: true, is_system: false, extra: {} },
            { name: 'Char', mes: 'hello', is_user: false, is_system: false, extra: {} },
        ],
        chatId: 'chat-test',
        chatMetadata: { integrity: 'sess-container-test' },
        maxContext: 4096,
        extensionSettings: {
            regex: [],
            disabledExtensions: [],
            [PLUGIN_NS]: undefined,
        },
        extensionPrompts: {},
        powerUserSettings: { encode_tags: false },
        eventTypes: {
            CHAT_CHANGED: 'chat_id_changed',
            CHAT_DELETED: 'chat_deleted',
            GROUP_CHAT_DELETED: 'group_chat_deleted',
            CHAT_RENAMED: 'chat_renamed',
            CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
            MESSAGE_UPDATED: 'message_updated',
            MORE_MESSAGES_LOADED: 'more_messages_loaded',
        },
        eventSource: {
            on() {},
            removeListener() {},
        },
        getCurrentChatId: () => 'chat-test',
        getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
        characters: [],
        groups: [],
        saveSettingsDebounced() {},
        saveMetadataDebounced() {},
        async saveChat() {},
        updateMessageBlock() {},
        async getWorldInfoPrompt() {
            return { worldInfoString: '' };
        },
        setExtensionPrompt() {},
        SlashCommandParser: {
            addCommandObject(cmd) {
                slashNames.push(cmd?.name ?? 'unknown');
            },
        },
        SlashCommand: {
            fromProps(spec) {
                return spec;
            },
        },
        substituteParams: (t) => t,
        callGenericPopup: async () => {},
        _slashNames: slashNames,
    };
}

describe('bootstrap/assertRequiredDeps', () => {
    it('遗漏必填字段则抛错', () => {
        assert.throws(
            () => assertRequiredDeps('createTagRecallService', { llm: {} }, REQUIRED_APP_DEPS.createTagRecallService),
            /缺少必填 deps/,
        );
    });

    it('字段齐全则通过', () => {
        const deps = Object.fromEntries(
            REQUIRED_APP_DEPS.createTagRecallService.map((k) => [k, () => {}]),
        );
        assertRequiredDeps('createTagRecallService', deps, REQUIRED_APP_DEPS.createTagRecallService);
    });

    it('createRenderSlotUseCase 必填含 host（D36）', () => {
        assert.ok(REQUIRED_APP_DEPS.createRenderSlotUseCase.includes('host'));
    });
});

describe('bootstrap/createContainer', () => {
    it('组装能跑通，且三处同实例引用相等', async () => {
        /** @type {object[]} */
        const captured = [];
        const ctx = makeFakeContext();
        const getContext = () => ctx;
        const host = createSillyTavernHost({ getContext });
        const bus = createEventBus();
        const db = createMemoryIdb();

        const container = await createContainer({
            getContext,
            host,
            db,
            bus,
            factories: {
                createContextCollector: createCtx,
                createWorldInfoResolver: createWi,
                createTagRecallService: (deps) => {
                    captured.push({ name: 'tagRecall', deps });
                    return createTagRecall(deps);
                },
                createGenerateSlotsUseCase: (deps) => {
                    captured.push({ name: 'generateSlots', deps });
                    return createGenSlots(deps);
                },
                createWorkbenchService: (deps) => {
                    captured.push({ name: 'workbench', deps });
                    return createWorkbench(deps);
                },
                createRenderSlotUseCase: (deps) => {
                    captured.push({ name: 'renderSlot', deps });
                    return createRenderSlot(deps);
                },
                createAutoTriggerService: (deps) => {
                    captured.push({ name: 'autoTrigger', deps });
                    return createAutoTrigger(deps);
                },
                createImageGenService: createImageGen,
                createArtistPreviewService: createArtistPreview,
            },
        });

        const tagRecallCall = captured.find((c) => c.name === 'tagRecall');
        const genCall = captured.find((c) => c.name === 'generateSlots');
        const wbCall = captured.find((c) => c.name === 'workbench');
        const renderCall = captured.find((c) => c.name === 'renderSlot');
        const autoCall = captured.find((c) => c.name === 'autoTrigger');

        assert.ok(tagRecallCall && genCall && wbCall && renderCall && autoCall);

        // 同实例 #1：llm
        assert.equal(genCall.deps.llm, tagRecallCall.deps.llm);
        assert.equal(wbCall.deps.llm, tagRecallCall.deps.llm);
        assert.equal(container.shared.llm, tagRecallCall.deps.llm);

        // 同实例 #2：tagRecall（D33）
        assert.equal(genCall.deps.tagRecall, wbCall.deps.tagRecall);
        assert.equal(genCall.deps.tagRecall, container.shared.tagRecall);
        assert.equal(container.services.tagRecall, container.shared.tagRecall);

        // 同实例 #3：bus（D32）
        assert.equal(genCall.deps.bus, renderCall.deps.bus);
        assert.equal(genCall.deps.bus, autoCall.deps.bus);
        assert.equal(container.shared.bus, bus);

        // D36：renderSlot 拿到 host
        assert.equal(renderCall.deps.host, host);

        assert.equal(typeof container.useCases.generateSlots.execute, 'function');
        assert.equal(typeof container.useCases.renderSlot.execute, 'function');
        assert.equal(typeof container.useCases.generateFloor.execute, 'function');
        assert.equal(typeof container.useCases.generateFloor.isRunning, 'function');
        assert.equal(typeof container.services.workbench.writePrompt, 'function');
        assert.equal(typeof container.services.imageGen.generate, 'function');

        container.dispose();
        host.dispose();
    });

    it('generateFloor 与 generateSlots/renderSlot 同实例（D35/D54）', async () => {
        /** @type {object[]} */
        const captured = [];
        const ctx = makeFakeContext();
        const getContext = () => ctx;
        const host = createSillyTavernHost({ getContext });

        const container = await createContainer({
            getContext,
            host,
            db: createMemoryIdb(),
            factories: {
                createGenerateSlotsUseCase: (deps) => {
                    captured.push({ name: 'generateSlots', deps, inst: createGenSlots(deps) });
                    return captured[captured.length - 1].inst;
                },
                createRenderSlotUseCase: (deps) => {
                    captured.push({ name: 'renderSlot', deps, inst: createRenderSlot(deps) });
                    return captured[captured.length - 1].inst;
                },
                createGenerateFloorUseCase: (deps) => {
                    captured.push({ name: 'generateFloor', deps });
                    return {
                        execute: async () => ({ ok: true, value: {} }),
                        isRunning: () => false,
                    };
                },
            },
        });

        const gen = captured.find((c) => c.name === 'generateSlots');
        const render = captured.find((c) => c.name === 'renderSlot');
        const floor = captured.find((c) => c.name === 'generateFloor');
        assert.ok(gen && render && floor);
        assert.equal(floor.deps.generateSlots, gen.inst);
        assert.equal(floor.deps.renderSlot, render.inst);
        assert.equal(floor.deps.generateSlots, container.useCases.generateSlots);
        assert.equal(floor.deps.renderSlot, container.useCases.renderSlot);

        container.dispose();
        host.dispose();
    });

    it('generate 缺 replaceCharacterKeywords 报错而非默认', async () => {
        const ctx = makeFakeContext();
        const getContext = () => ctx;
        const host = createSillyTavernHost({ getContext });
        const container = await createContainer({
            getContext,
            host,
            db: createMemoryIdb(),
        });

        await assert.rejects(
            () => container.services.imageGen.generate({
                caption: emptyNaiCaption(),
            }),
            /replaceCharacterKeywords/,
        );

        container.dispose();
        host.dispose();
    });
});
