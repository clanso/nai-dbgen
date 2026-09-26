/**
 * 演示页冒烟：与 preview 同款装配，覆盖主流程。
 * 演示页一坏，npm test 就红。
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { isOk, isErr } from '../../src/infra/result.js';
import { parseSlotIds } from '../../src/domain/slot/slot-token.js';
import { chatSlotFileName } from '../../src/domain/slot/session-files.js';
import { IDS, parseSlotIdsFromPromptMessages, parseCandidateKeysFromMessages } from '../../preview/fixtures.js';
import { classifyLlmRequest, pickRecallKeysFromCandidates } from '../../preview/fake-gateways.js';
import { bootPreviewRuntime } from './_boot.js';

describe('preview fixtures · slotid / candidate parsers', () => {
    it('parses slotids from 构图标签 section only', () => {
        const text = [
            '【当前上下文】',
            'slotid: 99 不要采',
            '',
            '【构图标签】',
            'slotid: 2',
            '生成点: Bob 招手。',
            'garden: flowers',
            '',
            'slotid: 3',
            '生成点: 又一句。',
            '',
            '【特征参考】',
            'slotid: 88 不要采',
        ].join('\n');
        assert.deepEqual(parseSlotIdsFromPromptMessages(text), [2, 3]);
    });

    it('parses candidate keys from 候选 key section', () => {
        const text = '【候选 key】\ngarden\nsoft_light\n\n【其它】\nx';
        assert.deepEqual(parseCandidateKeysFromMessages(text), ['garden', 'soft_light']);
    });

    it('pickRecallKeys：名称命中优先；无命中则中性背景而非性相关靠前项', () => {
        const candidates = [
            '全局：暴露/偷窥',
            '全局：群体共用·群体关系',
            '背景：卧室',
            '背景：公园/长椅',
            '背景：浴室',
        ];
        assert.deepEqual(
            pickRecallKeysFromCandidates(candidates, '爱丽丝在公园长椅边招手。'),
            ['背景：公园/长椅'],
        );
        const fallback = pickRecallKeysFromCandidates(
            candidates,
            '远处有人招手，喊了一声「爱丽丝，这边！」',
        );
        assert.deepEqual(fallback, ['背景：卧室', '背景：公园/长椅']);
        assert.ok(!fallback.some((k) => /暴露|群交/.test(k)));
    });

    it('classifyLlmRequest distinguishes single schemas', () => {
        assert.equal(classifyLlmRequest({ jsonSchema: { name: 'single_recall_keys' } }), 'single-recall');
        assert.equal(classifyLlmRequest({ jsonSchema: { name: 'single_imagegen_caption' } }), 'single-prompt');
        assert.equal(classifyLlmRequest({ jsonSchema: { name: 'slot_plan_array' } }), 'prompt');
        assert.equal(classifyLlmRequest({ jsonSchema: { name: 'nai_caption' } }), 'workbench');
        assert.equal(classifyLlmRequest({ jsonSchema: { name: 'recall_positions' } }), 'recall');
    });
});

describe('preview smoke · same assembly as demo page', () => {
    /** @type {Awaited<ReturnType<typeof bootPreviewRuntime>>|null} */
    let rt = null;

    before(async () => {
        rt = await bootPreviewRuntime();
    });

    after(async () => {
        if (rt) {
            await rt.destroy();
            rt = null;
        }
    });

    it('连续生图两次：slotid 递增且不撞号（楼 2 已有 1 → 先 2 再 3）', async () => {
        assert.ok(rt);
        const { host, container, llm } = rt;

        const mes2 = host.getMessage(2);
        assert.ok(mes2);
        assert.deepEqual(parseSlotIds(mes2.text), [1]);

        const r1 = await container.useCases.generateSlots.execute(3);
        assert.equal(isOk(r1), true, r1.ok ? '' : `${r1.error?.message} / ${r1.error?.hint}`);
        assert.equal(r1.value.records.length, 1);
        assert.equal(r1.value.records[0].slotId, 2);
        assert.equal(r1.value.llmCallCount, 2);

        const promptCall1 = llm._ctrl.getCalls().filter((c) => c.kind === 'prompt').at(-1);
        assert.ok(promptCall1);
        const joined1 = (promptCall1.messages || []).map((m) => m.content).join('\n');
        assert.deepEqual(parseSlotIdsFromPromptMessages(joined1), [2]);
        assert.ok(Array.isArray(promptCall1.result?.json));
        assert.equal(promptCall1.result.json[0].slotid, 2);

        const after1 = host.getMessage(3);
        assert.ok(after1);
        assert.ok(parseSlotIds(after1.text).includes(2));

        const r2 = await container.useCases.generateSlots.execute(3);
        assert.equal(isOk(r2), true, r2.ok ? '' : `${r2.error?.message} / ${r2.error?.hint}`);
        assert.equal(r2.value.records[0].slotId, 3);
        assert.equal(r2.value.records[0].slotId !== r1.value.records[0].slotId, true);

        const after2 = host.getMessage(3);
        const ids = parseSlotIds(after2.text);
        assert.ok(ids.includes(2) && ids.includes(3));
        assert.equal(new Set(ids).size, ids.length, '正文 slot 不撞号');
    });

    it('点 slot 出图 + 再点重出', async () => {
        assert.ok(rt);
        const { container, imageGen } = rt;
        imageGen._ctrl.clearCalls();

        const first = await container.useCases.renderSlot.execute(3, 2);
        assert.equal(isOk(first), true, first.ok ? '' : first.error?.message);
        assert.equal(imageGen._ctrl.getCalls().length, 1);

        // UI 再点「重新生成」会传 force: true
        const again = await container.useCases.renderSlot.execute(3, 2, { force: true });
        assert.equal(isOk(again), true, again.ok ? '' : again.error?.message);
        assert.equal(imageGen._ctrl.getCalls().length, 2);

        const stored = await container.repos.slot.get(3, 2);
        assert.equal(isOk(stored), true);
        assert.ok(stored.value);
        assert.ok(Array.isArray(stored.value.images));
        assert.ok(stored.value.images.length >= 1);
    });

    it('单图提示词接口 generateSinglePrompt', async () => {
        assert.ok(rt);
        const { api, llm } = rt;
        assert.ok(api && typeof api.generateSinglePrompt === 'function');

        const before = llm._ctrl.getCalls().length;
        const r = await api.generateSinglePrompt({ description: '画一张花园里的 Alice' });
        assert.equal(isOk(r), true, r.ok ? '' : r.error?.message);
        assert.ok(r.value.caption?.v4_prompt);
        assert.ok(r.value.llmCallCount >= 1);

        const kinds = llm._ctrl.getCalls().slice(before).map((c) => c.kind);
        assert.ok(kinds.includes('recall'));
        assert.ok(kinds.includes('prompt') || kinds.includes('workbench'));
    });

    it('工作台写提示词 + 出图', async () => {
        assert.ok(rt);
        const { container, imageGen, llm } = rt;

        const write = await container.services.workbench.writePrompt({
            naturalLanguage: 'Alice 在花园喷泉边',
            libraryIds: [IDS.tagLib, IDS.tagLibFeature],
        });
        assert.equal(isOk(write), true, write.ok ? '' : write.error?.message);
        assert.ok(write.value.caption?.v4_prompt);

        const wbCalls = llm._ctrl.getCalls().filter((c) => c.kind === 'workbench');
        assert.ok(wbCalls.length >= 1);

        imageGen._ctrl.clearCalls();
        const gen = await container.services.workbench.generateImage({
            caption: write.value.caption,
            replaceCharacterKeywords: false,
        });
        assert.equal(isOk(gen), true, gen.ok ? '' : gen.error?.message);
        assert.equal(imageGen._ctrl.getCalls().length, 1);
        assert.ok(Array.isArray(gen.value) && gen.value.length >= 1);
    });

    it('画师串手填预览写入服务器文件', async () => {
        assert.ok(rt);
        const { container, serverFiles } = rt;

        const r = await container.services.artistPreview.preview({
            artistId: IDS.artist,
            promptText: '1girl, garden',
            saveAsPreview: true,
        });
        assert.equal(isOk(r), true, r.ok ? '' : r.error?.message);
        assert.ok(r.value.referenceImageRef);
        assert.ok(r.value.cardImageRef);

        const artist = await container.repos.artist.get(IDS.artist);
        assert.equal(isOk(artist), true);
        assert.ok(artist.value?.referenceImageRef);
        assert.equal(artist.value.referenceImageRef, r.value.referenceImageRef);
        assert.equal(artist.value.cardImageRef, r.value.cardImageRef);

        const exists = await serverFiles.exists([
            String(r.value.referenceImageRef),
            String(r.value.cardImageRef),
        ]);
        assert.equal(isOk(exists), true);
        assert.equal(exists.value[String(r.value.referenceImageRef)], true);
        assert.equal(exists.value[String(r.value.cardImageRef)], true);
    });

    it('存储清理：孤儿会话删除，存活会话保留', async () => {
        assert.ok(rt);
        const { container, host, serverFiles } = rt;

        const aliveSid = host.getSessionId();
        assert.ok(aliveSid);

        // 当前会话应已有登记（前面生图写过）
        const indexBefore = await container.services.chatIndex.load();
        assert.equal(isOk(indexBefore), true);
        assert.ok(indexBefore.value.chats.some((c) => c.sessionId === aliveSid));

        const orphanSid = 'sess-orphan-gone';
        await container.services.chatIndex.register({
            sessionId: orphanSid,
            chatFileName: 'OrphanChat',
            avatarUrl: null,
            groupId: null,
        });
        await serverFiles.writeJson(chatSlotFileName(orphanSid), {
            schemaVersion: 1,
            sessionId: orphanSid,
            updatedAt: new Date().toISOString(),
            slots: [],
        });

        const cleaned = await container.services.storageCleanup.cleanup();
        assert.equal(isOk(cleaned), true, cleaned.ok ? '' : cleaned.error?.message);
        assert.ok(cleaned.value.removedSessionIds.includes(orphanSid));
        assert.equal(cleaned.value.removedSessionIds.includes(aliveSid), false);

        const orphanFile = await serverFiles.readJson(chatSlotFileName(orphanSid));
        assert.equal(orphanFile.value, null);

        const aliveFile = await serverFiles.readJson(chatSlotFileName(aliveSid));
        assert.notEqual(aliveFile.value, null);
    });

    it('假提示词 LLM 解析不到 slotid 时明确报错（不回落 1）', async () => {
        assert.ok(rt);
        const { llm } = rt;
        const r = await llm.complete({
            messages: [
                { role: 'user', content: '【构图标签】\n（空）\n\n请写生图内容' },
            ],
            config: { id: IDS.llm, name: 'x', baseUrl: '', secretId: null, model: '' },
            jsonSchema: { name: 'slot_plan_array' },
        });
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'FAKE_LLM_NO_SLOTID');
    });

    it('presets 格式导入：名称与正负向一致，导出仍为五字段', async () => {
        assert.ok(rt);
        const { container } = rt;
        const { readFileSync } = await import('node:fs');
        const { dirname, join } = await import('node:path');
        const { fileURLToPath } = await import('node:url');
        const here = dirname(fileURLToPath(import.meta.url));
        const sample = JSON.parse(readFileSync(
            join(here, '../fixtures/artists-presets-sample.json'),
            'utf8',
        ));
        const name = Object.keys(sample.presets)[0];
        const preset = sample.presets[name];

        const imp = await container.repos.artist.importJson(sample, { strategy: 'rename' });
        assert.equal(isOk(imp), true, imp.ok ? '' : imp.error?.message);
        assert.ok(imp.value.imported >= 1);

        const list = await container.repos.artist.list();
        assert.equal(isOk(list), true);
        const hit = list.value.find((a) => a.name === name || a.name.startsWith(`${name} ·`));
        assert.ok(hit);
        assert.equal(hit.positivePrompt, preset.fixedPrompt);
        assert.equal(hit.negativePrompt, preset.negativePrompt);
        assert.equal(hit.cardImageRef, null);

        const { ARTIST_EXPORT_FIELD_ORDER, buildArtistExportRow } = await import(
            '../../src/adapters/storage/artist-io.js'
        );
        const row = buildArtistExportRow({
            name: hit.name,
            sequence: hit.sequence,
            positivePrompt: hit.positivePrompt,
            negativePrompt: hit.negativePrompt,
            referenceImage: null,
        });
        assert.deepEqual(Object.keys(row), [...ARTIST_EXPORT_FIELD_ORDER]);
        assert.equal('thumbnail' in row, false);
    });
});
