import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildWorldInfoScanInput,
    snapshotAuthorNotePrompt,
    restoreAuthorNotePrompt,
    NOTE_MODULE_NAME,
    createWorldInfoSource,
} from '../../src/adapters/host/worldinfo.source.js';
import { isOk, isErr } from '../../src/infra/result.js';

describe('worldinfo.source scanInput', () => {
    it('新→旧窗口直接映射，不再 reverse', () => {
        const window = [
            { name: 'A', text: '最新' },
            { name: 'B', text: '更早' },
        ];
        assert.deepEqual(
            buildWorldInfoScanInput(window, true),
            ['A: 最新', 'B: 更早'],
        );
        assert.deepEqual(
            buildWorldInfoScanInput(window, false),
            ['最新', '更早'],
        );
    });

    it('空/非法输入得到空数组', () => {
        assert.deepEqual(buildWorldInfoScanInput(null, true), []);
        assert.deepEqual(buildWorldInfoScanInput([], true), []);
    });
});

describe('worldinfo.source author-note snapshot', () => {
    it('snapshot / restore 能还原 value 与元数据', () => {
        const prompts = {
            [NOTE_MODULE_NAME]: {
                value: '原始作者注释',
                position: 1,
                depth: 4,
                scan: true,
                role: 0,
                filter: null,
            },
        };
        const snap = snapshotAuthorNotePrompt(prompts);
        assert.equal(snap.existed, true);
        assert.equal(snap.value, '原始作者注释');

        prompts[NOTE_MODULE_NAME].value = '被 dryRun 污染';
        const ctx = {
            extensionPrompts: prompts,
            setExtensionPrompt(key, value, position, depth, scan, role, filter) {
                prompts[key] = { value, position, depth, scan, role, filter };
            },
        };
        restoreAuthorNotePrompt(ctx, snap);
        assert.equal(prompts[NOTE_MODULE_NAME].value, '原始作者注释');
        assert.equal(prompts[NOTE_MODULE_NAME].depth, 4);
    });

    it('调用前不存在时 restore 会删除条目', () => {
        const prompts = {
            [NOTE_MODULE_NAME]: { value: 'new', position: 0, depth: 0, scan: false, role: 0 },
        };
        const ctx = { extensionPrompts: prompts };
        restoreAuthorNotePrompt(ctx, null);
        assert.equal(Object.prototype.hasOwnProperty.call(prompts, NOTE_MODULE_NAME), false);
    });
});

describe('worldinfo.source resolve isolation', () => {
    it('dryRun 后作者注释被恢复（即使 getWorldInfoPrompt 抛错）', async () => {
        const prompts = {
            [NOTE_MODULE_NAME]: {
                value: 'keep-me',
                position: 1,
                depth: 2,
                scan: false,
                role: 0,
                filter: null,
            },
        };
        const source = createWorldInfoSource({
            getContext: () => ({
                extensionPrompts: prompts,
                setExtensionPrompt(key, value, position, depth, scan, role, filter) {
                    prompts[key] = { value, position, depth, scan, role, filter };
                },
                async getWorldInfoPrompt() {
                    prompts[NOTE_MODULE_NAME].value = 'polluted';
                    throw new Error('boom');
                },
            }),
        });
        const r = await source.resolve(['x'], 100, { trigger: 'normal' });
        assert.equal(isErr(r), true);
        assert.equal(prompts[NOTE_MODULE_NAME].value, 'keep-me');
    });

    it('成功时返回 worldInfoString', async () => {
        const source = createWorldInfoSource({
            getContext: () => ({
                extensionPrompts: {},
                setExtensionPrompt() {},
                async getWorldInfoPrompt() {
                    return { worldInfoString: 'WI-BEFOREWI-AFTER' };
                },
            }),
        });
        const r = await source.resolve(['hi'], 2048, { trigger: 'normal' });
        assert.equal(isOk(r), true);
        assert.equal(r.value, 'WI-BEFOREWI-AFTER');
    });

    it('缺少 getWorldInfoPrompt 时 HostError', async () => {
        const source = createWorldInfoSource({
            getContext: () => ({}),
        });
        const r = await source.resolve([], 0, {});
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'WORLDINFO_UNAVAILABLE');
    });
});
