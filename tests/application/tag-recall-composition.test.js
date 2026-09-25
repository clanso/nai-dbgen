/**
 * 构图召回新流程：候选过滤、无候选仍调 LLM、锚点丢弃、slotid、旧格式报错。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isOk, isErr, Ok, Err } from '../../src/infra/result.js';
import { extractRecalledPositions } from '../../src/application/_helpers.js';
import {
    buildPipeline,
    makeCaption,
} from './_fakes.js';

describe('extractRecalledPositions', () => {
    it('parses position array and wrapped object', () => {
        const a = extractRecalledPositions([
            { 生成点: '一句。', key: ['a', 'b'] },
        ]);
        assert.equal(a.status, 'ok');
        assert.equal(a.positions.length, 1);
        assert.equal(a.positions[0].anchorSentence, '一句。');
        assert.deepEqual(a.positions[0].keys, ['a', 'b']);

        const b = extractRecalledPositions({
            positions: [{ 生成点: 'x', keys: ['k'] }],
        });
        assert.equal(b.status, 'ok');
        assert.deepEqual(b.positions[0].keys, ['k']);
    });

    it('detects legacy pure key list', () => {
        assert.equal(extractRecalledPositions(['garden', 'soft']).status, 'legacy-key-list');
        assert.equal(extractRecalledPositions({ keys: ['a'] }).status, 'legacy-key-list');
    });
});

describe('composition tag recall', () => {
    it('candidates only include active composition libraries (not feature)', async () => {
        const p = buildPipeline();
        const r = await p.generateSlots.execute(2);
        assert.equal(isOk(r), true, r.ok ? '' : r.error?.message);
        const recallMsg = p.llmCalls[0].messages.map((m) => m.content).join('\n');
        assert.ok(recallMsg.includes('garden'));
        assert.equal(recallMsg.includes('night'), false);
        // 特征库条目不得出现在候选区（上下文里可以有 Alice）
        assert.equal(recallMsg.includes('silver hair'), false);
        const keysSection = recallMsg.split('keys=')[1] || recallMsg.split('候选 key')[1] || '';
        assert.equal(keysSection.includes('Alice'), false, '特征库 key 不进召回候选');
    });

    it('constant library entries never enter recall candidates', async () => {
        const p = buildPipeline({
            libraries: [
                {
                    schemaVersion: 1, id: 'lib-comp', name: 'c', active: true,
                    kind: 'composition', createdAt: '', updatedAt: '',
                },
                {
                    schemaVersion: 1, id: 'lib-const', name: '常驻', active: true,
                    kind: 'constant', createdAt: '', updatedAt: '',
                },
            ],
            tagEntries: [
                {
                    schemaVersion: 1, id: 't1', libraryId: 'lib-comp',
                    key: 'garden', value: 'garden tags', createdAt: '', updatedAt: '',
                },
                {
                    schemaVersion: 1, id: 't-const', libraryId: 'lib-const',
                    key: '常驻杂项', value: 'CONSTANT_ONLY_VALUE', createdAt: '', updatedAt: '',
                },
            ],
        });
        const r = await p.generateSlots.execute(2);
        assert.equal(isOk(r), true, r.ok ? '' : r.error?.message);
        const recallMsg = p.llmCalls[0].messages.map((m) => m.content).join('\n');
        assert.ok(recallMsg.includes('garden'));
        assert.equal(recallMsg.includes('常驻杂项'), false);
        assert.equal(recallMsg.includes('CONSTANT_ONLY_VALUE'), false);
        const promptMsg = p.llmCalls[1].messages.map((m) => m.content).join('\n');
        assert.ok(promptMsg.includes('常驻杂项: CONSTANT_ONLY_VALUE'));
    });

    it('still calls recall LLM when composition candidates are empty', async () => {
        const p = buildPipeline({
            libraries: [
                {
                    schemaVersion: 1, id: 'lib-feat', name: 'f', active: true,
                    kind: 'feature', createdAt: '', updatedAt: '',
                },
            ],
            tagEntries: [
                {
                    schemaVersion: 1, id: 't3', libraryId: 'lib-feat',
                    key: 'Alice', value: 'feat', createdAt: '', updatedAt: '',
                },
            ],
            llmComplete: async (req) => {
                if (req.config.id === 'llm-recall') {
                    const positions = [{
                        生成点: 'Alice walked into the garden.',
                        key: [],
                    }];
                    return Ok({ text: JSON.stringify(positions), json: positions });
                }
                return Ok({
                    text: '[]',
                    json: [{ slotid: 1, 生图内容: makeCaption('empty keys scene') }],
                });
            },
        });
        const r = await p.generateSlots.execute(2);
        assert.equal(isOk(r), true, r.ok ? '' : r.error?.message);
        assert.equal(r.value.llmCallCount, 2);
        assert.equal(p.llmCalls.length, 2);
        assert.equal(p.llmCalls[0].config.id, 'llm-recall');
    });

    it('recall failure returns Err (no degrade) with llmCalled', async () => {
        const p = buildPipeline({
            llmComplete: async (req) => {
                if (req.config.id === 'llm-recall') {
                    return Err({
                        category: 'upstream',
                        code: 'LLM_FAIL',
                        message: 'boom',
                        retryable: false,
                        context: {},
                    });
                }
                return Ok({ text: '[]', json: [] });
            },
        });
        const r = await p.generateSlots.execute(2);
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'LLM_FAIL');
        assert.equal(r.error.context?.llmCalled, true);
        assert.equal(p.llmCalls.length, 1);
    });

    it('discards unmatched anchors; all discarded → Err', async () => {
        const p = buildPipeline({
            llmComplete: async (req) => {
                if (req.config.id === 'llm-recall') {
                    const positions = [{
                        生成点: '这句话根本不在楼里。',
                        key: ['1'],
                    }];
                    return Ok({ text: JSON.stringify(positions), json: positions });
                }
                return Ok({ text: '[]', json: [{ slotid: 1, 生图内容: makeCaption('x') }] });
            },
        });
        const r = await p.generateSlots.execute(2);
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'RECALL_ALL_POSITIONS_DISCARDED');
        assert.ok(Array.isArray(r.error.context?.discardedAnchors));
        assert.equal(r.error.context.discardedAnchors[0], '这句话根本不在楼里。');
    });

    it('assigns slotid 1..n in order; ignores model 生成点 on prompt step', async () => {
        const p = buildPipeline({
            llmComplete: async (req) => {
                if (req.config.id === 'llm-recall') {
                    const positions = [
                        { 生成点: 'Alice walked into the garden.', key: ['1'] },
                    ];
                    return Ok({ text: JSON.stringify(positions), json: positions });
                }
                return Ok({
                    text: '[]',
                    json: [{
                        slotid: 1,
                        生成点: '模型瞎编的生成点，应被忽略',
                        生图内容: makeCaption('a garden scene'),
                    }],
                });
            },
        });
        const r = await p.generateSlots.execute(2);
        assert.equal(isOk(r), true, r.ok ? '' : r.error?.message);
        assert.equal(r.value.records[0].slotId, 1);
        assert.equal(r.value.records[0].anchorSentence, 'Alice walked into the garden.');
        assert.equal(r.value.records[0].anchorSentence.includes('瞎编'), false);
    });

    it('extra slotids discarded; missing slotids not written; zero valid → Err', async () => {
        const p = buildPipeline({
            llmComplete: async (req) => {
                if (req.config.id === 'llm-recall') {
                    const positions = [{
                        生成点: 'Alice walked into the garden.',
                        key: ['1'],
                    }];
                    return Ok({ text: JSON.stringify(positions), json: positions });
                }
                return Ok({
                    text: '[]',
                    json: [
                        { slotid: 99, 生图内容: makeCaption('extra') },
                    ],
                });
            },
        });
        const r = await p.generateSlots.execute(2);
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'SLOT_PLAN_NO_VALID');
        assert.deepEqual(r.error.context?.extraSlotIds, [99]);
        assert.deepEqual(r.error.context?.missingSlotIds, [1]);
    });

    it('legacy recall key-list format returns clear Err', async () => {
        const p = buildPipeline({
            llmComplete: async (req) => {
                if (req.config.id === 'llm-recall') {
                    return Ok({ text: '["garden"]', json: ['garden'] });
                }
                return Ok({ text: '[]', json: [] });
            },
        });
        const r = await p.generateSlots.execute(2);
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'RECALL_LEGACY_FORMAT');
        assert.match(r.error.hint || '', /内置召回预设/);
    });

    it('exactly 2 LLM calls on happy path', async () => {
        const p = buildPipeline();
        const r = await p.generateSlots.execute(2);
        assert.equal(isOk(r), true);
        assert.equal(r.value.llmCallCount, 2);
        assert.equal(p.llmCalls.length, 2);
    });
});
