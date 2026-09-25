/**
 * 演示页同款装配：导入转换标签/特征库/角色库/预设 → 假召回 → 假写提示词，
 * 核对 size/analysis、常驻标签、近期生图记录、长 key、阶段识别。
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isOk } from '../../src/infra/result.js';
import { VARIABLE_NAMES } from '../../src/domain/template/variable-map.js';
import {
    makeSlotPlanJson,
    parseCandidateKeysFromMessages,
    PREVIEW_SLOT_SIZES,
} from '../../preview/fixtures.js';
import { classifyLlmRequest } from '../../preview/fake-gateways.js';
import {
    loadRealConvertedIntoPreview,
    PREVIEW_FEATURE_TAG_JSON_URLS,
    PREVIEW_IMAGEGEN_PRESET_ID,
    PREVIEW_RECALL_PRESET_ID,
} from '../../preview/load-real-converted.js';
import { bootPreviewRuntime } from './_boot.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REF_DIR = join(HERE, '../../../ref/画师串、标签库等/转换后');
const TAG_PATH = join(REF_DIR, '标签库9.5-V5.tag.json');
const PRESET_PATH = join(REF_DIR, '文生图9.7-V5.preset.json');
const CHARACTER_PATH = join(REF_DIR, '同人库8.5.character.json');
const FEATURE_PATHS = [
    join(REF_DIR, '扩展库5.4.tag.json'),
    join(REF_DIR, 'SEX模板9.2.tag.json'),
    join(REF_DIR, '常规模板5.25.tag.json'),
];

describe('preview fixtures · size / analysis contract', () => {
    it('makeSlotPlanJson 轮换尺寸并带解析', () => {
        const plan = makeSlotPlanJson('花园里有人招手。', [1, 2, 3]);
        assert.equal(plan.length, 3);
        assert.equal(plan[0].size, PREVIEW_SLOT_SIZES[0]);
        assert.equal(plan[1].size, PREVIEW_SLOT_SIZES[1]);
        assert.equal(plan[2].size, PREVIEW_SLOT_SIZES[2]);
        for (const item of plan) {
            assert.equal(typeof item.analysis, 'string');
            assert.match(item.analysis, /①/);
            assert.match(item.analysis, /⑦/);
            assert.ok(item.caption?.v4_prompt);
        }
    });

    it('parseCandidateKeys 能吃转换后长 key', () => {
        const longKey = '场景·通过媒介：看手机/手机屏幕/远景长名称';
        const text = `【候选 key】\n${longKey}\n全局：暴露与偷窥\n\n【其它】\nx`;
        assert.deepEqual(parseCandidateKeysFromMessages(text), [
            longKey,
            '全局：暴露与偷窥',
        ]);
    });

    it('classifyLlmRequest：转换预设全文不被示例 slotid 骗阶段', () => {
        const preset = JSON.parse(readFileSync(PRESET_PATH, 'utf8'));
        const imagegen = preset.items.find((p) => p.id === PREVIEW_IMAGEGEN_PRESET_ID);
        const recall = preset.items.find((p) => p.id === PREVIEW_RECALL_PRESET_ID);
        assert.ok(imagegen);
        assert.ok(recall);

        const imagegenJoined = (imagegen.prompts || []).map((p) => p.content || '').join('\n');
        const recallJoined = (recall.prompts || []).map((p) => p.content || '').join('\n');

        // 生图预设含大量示例 "slotid": N，但没有【候选 key】注入段 → 不得判成 recall
        assert.notEqual(
            classifyLlmRequest({ messages: [{ role: 'system', content: imagegenJoined }] }),
            'recall',
        );

        // 渲染后的写提示词请求：带【构图标签】真实段 → prompt
        const promptRendered = `${imagegenJoined}\n\n【构图标签】\nslotid: 2\n生成点: 测试。\n`;
        assert.equal(
            classifyLlmRequest({ messages: [{ role: 'user', content: promptRendered }] }),
            'prompt',
        );

        // 召回预设 → recall
        assert.equal(
            classifyLlmRequest({ messages: [{ role: 'user', content: recallJoined }] }),
            'recall',
        );
    });
});

describe('preview · 导入转换数据后假召回/写提示词', () => {
    /** @type {Awaited<ReturnType<typeof bootPreviewRuntime>>|null} */
    let rt = null;
    /** @type {object|null} */
    let tagData = null;
    /** @type {object|null} */
    let presetData = null;
    /** @type {object[]} */
    let featureTagDataList = [];
    /** @type {object|null} */
    let characterData = null;

    before(async () => {
        tagData = JSON.parse(readFileSync(TAG_PATH, 'utf8'));
        presetData = JSON.parse(readFileSync(PRESET_PATH, 'utf8'));
        featureTagDataList = FEATURE_PATHS.map((p) => JSON.parse(readFileSync(p, 'utf8')));
        characterData = JSON.parse(readFileSync(CHARACTER_PATH, 'utf8'));
        assert.equal(featureTagDataList.length, PREVIEW_FEATURE_TAG_JSON_URLS.length);
        rt = await bootPreviewRuntime();
        const statuses = [];
        const loaded = await loadRealConvertedIntoPreview({
            container: rt.container,
            host: rt.host,
            setStatus: (t) => statuses.push(t),
            tagData,
            featureTagDataList,
            presetData,
            characterData,
        });
        assert.equal(loaded.ok, true, statuses.join(' | '));
        // 9.5 三个库 + 扩展 / SEX / 常规 各一
        assert.equal(loaded.tagLibs, 6);
        assert.ok((loaded.characterGroups || 0) >= 1);
        assert.ok((loaded.characters || 0) >= 1);
        assert.equal(loaded.activeImagegenPresetId, PREVIEW_IMAGEGEN_PRESET_ID);
        assert.equal(loaded.activeRecallPresetId, PREVIEW_RECALL_PRESET_ID);
    });

    after(async () => {
        if (rt) {
            await rt.destroy();
            rt = null;
        }
    });

    it('假召回能从长候选 key 里挑，假写提示词写入 size/analysis', async () => {
        assert.ok(rt);
        const { container, llm } = rt;
        llm._ctrl.clearCalls();

        const r1 = await container.useCases.generateSlots.execute(3);
        assert.equal(isOk(r1), true, r1.ok ? '' : `${r1.error?.message} / ${r1.error?.hint}`);
        assert.ok(r1.value.records.length >= 1);

        const rec = r1.value.records[0];
        assert.equal(typeof rec.size, 'string');
        assert.match(rec.size, /^\d+x\d+$/);
        assert.equal(typeof rec.analysis, 'string');
        assert.match(rec.analysis, /①/);

        const recallCall = llm._ctrl.getCalls().find((c) => c.kind === 'recall');
        assert.ok(recallCall);
        const recallJoined = (recallCall.messages || []).map((m) => m.content).join('\n');
        assert.match(recallJoined, /【候选 key】/);
        const candidateSection = recallJoined.split('【候选 key】')[1] || '';
        assert.match(candidateSection, /\n1 /);
        assert.doesNotMatch(candidateSection, /背景：/);

        const promptCall1 = llm._ctrl.getCalls().filter((c) => c.kind === 'prompt').at(-1);
        assert.ok(promptCall1);
        const plan = promptCall1.result?.json;
        assert.ok(Array.isArray(plan));
        assert.equal(typeof plan[0].size, 'string');
        assert.equal(typeof plan[0].analysis, 'string');

        const joined1 = (promptCall1.messages || []).map((m) => m.content).join('\n');
        assert.match(joined1, new RegExp(`【${VARIABLE_NAMES.CONSTANT}】`));
        // 第一轮近期生图记录可能为空或仅有楼 2 旧 slot；至少段要在
        assert.match(joined1, new RegExp(`【${VARIABLE_NAMES.RECENT_SLOTS}】`));
        // 常驻库有内容
        const constSection = joined1.match(
            new RegExp(`【${VARIABLE_NAMES.CONSTANT}】\\s*([\\s\\S]*?)(?=\\n【|$)`),
        );
        assert.ok(constSection);
        assert.ok(constSection[1].trim().length > 0, '常驻标签应有展开内容');
    });

    it('第二轮提示词请求含近期生图记录展开内容', async () => {
        assert.ok(rt);
        const { container, llm } = rt;
        llm._ctrl.clearCalls();

        const r2 = await container.useCases.generateSlots.execute(3);
        assert.equal(isOk(r2), true, r2.ok ? '' : `${r2.error?.message} / ${r2.error?.hint}`);

        const promptCall2 = llm._ctrl.getCalls().filter((c) => c.kind === 'prompt').at(-1);
        assert.ok(promptCall2);
        const joined2 = (promptCall2.messages || []).map((m) => m.content).join('\n');
        const recentSection = joined2.match(
            new RegExp(`【${VARIABLE_NAMES.RECENT_SLOTS}】\\s*([\\s\\S]*?)(?=\\n【|$)`),
        );
        assert.ok(recentSection);
        assert.ok(
            recentSection[1].trim().length > 0,
            '第二轮近期生图记录应有展开内容（含上一轮 size/analysis）',
        );
        assert.match(recentSection[1], /解析|尺寸|slotid|①/i);

        const constSection = joined2.match(
            new RegExp(`【${VARIABLE_NAMES.CONSTANT}】\\s*([\\s\\S]*?)(?=\\n【|$)`),
        );
        assert.ok(constSection);
        assert.ok(constSection[1].trim().length > 0);
    });
});
