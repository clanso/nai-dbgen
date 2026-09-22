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

function makeAuthorNote(value = '用户作者注释') {
    return {
        value,
        position: 1,
        depth: 4,
        scan: true,
        role: 0,
        filter: null,
    };
}

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

describe('worldinfo.source author-note snapshot helpers', () => {
    it('snapshot / restore 能还原 value 与元数据', () => {
        const prompts = { [NOTE_MODULE_NAME]: makeAuthorNote('原始作者注释') };
        const snap = snapshotAuthorNotePrompt(prompts);
        assert.equal(snap.existed, true);
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

    it('restore(null) 删除条目（仅在 didSnapshot 路径正当使用）', () => {
        const prompts = { [NOTE_MODULE_NAME]: makeAuthorNote('new') };
        restoreAuthorNotePrompt({ extensionPrompts: prompts }, null);
        assert.equal(Object.prototype.hasOwnProperty.call(prompts, NOTE_MODULE_NAME), false);
    });
});

describe('D21 resolve 不得在未快照时摧毁作者注释', () => {
    it('有作者注释 + 无 getWorldInfoPrompt → 注释原样保留', async () => {
        const prompts = { [NOTE_MODULE_NAME]: makeAuthorNote('必须保留') };
        const source = createWorldInfoSource({
            getContext: () => ({ extensionPrompts: prompts }),
        });
        const r = await source.resolve(['x'], 100, { trigger: 'normal' });
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'WORLDINFO_UNAVAILABLE');
        assert.equal(prompts[NOTE_MODULE_NAME].value, '必须保留');
        assert.equal(Object.prototype.hasOwnProperty.call(prompts, NOTE_MODULE_NAME), true);
    });

    it('有作者注释 + getContext() 抛错 → 注释原样保留', async () => {
        const prompts = { [NOTE_MODULE_NAME]: makeAuthorNote('ctx-throw-keep') };
        let calls = 0;
        const source = createWorldInfoSource({
            getContext: () => {
                calls += 1;
                if (calls === 1) {
                    throw new Error('getContext boom');
                }
                // 若 finally 错误地再调 getContext + restore(null)，会删掉注释
                return { extensionPrompts: prompts };
            },
        });
        const r = await source.resolve(['x'], 100, {});
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'WORLDINFO_RESOLVE_FAILED');
        assert.equal(calls, 1, 'finally 不得在未快照时再调 getContext');
        assert.equal(prompts[NOTE_MODULE_NAME].value, 'ctx-throw-keep');
        assert.equal(Object.prototype.hasOwnProperty.call(prompts, NOTE_MODULE_NAME), true);
    });

    it('有作者注释 + 扫描成功且被宿主改写 → 必须恢复成原值', async () => {
        const prompts = { [NOTE_MODULE_NAME]: makeAuthorNote('扫描前原文') };
        const source = createWorldInfoSource({
            getContext: () => ({
                extensionPrompts: prompts,
                setExtensionPrompt(key, value, position, depth, scan, role, filter) {
                    prompts[key] = { value, position, depth, scan, role, filter };
                },
                async getWorldInfoPrompt() {
                    prompts[NOTE_MODULE_NAME].value = 'WI dryRun 污染';
                    return { worldInfoString: 'WI-OK' };
                },
            }),
        });
        const r = await source.resolve(['hi'], 2048, { trigger: 'normal' });
        assert.equal(isOk(r), true);
        assert.equal(r.value, 'WI-OK');
        assert.equal(prompts[NOTE_MODULE_NAME].value, '扫描前原文');
    });

    it('调用前无作者注释 + 扫描后宿主新增 → 必须删掉', async () => {
        const prompts = {};
        const source = createWorldInfoSource({
            getContext: () => ({
                extensionPrompts: prompts,
                setExtensionPrompt(key, value, position, depth, scan, role, filter) {
                    prompts[key] = { value, position, depth, scan, role, filter };
                },
                async getWorldInfoPrompt() {
                    prompts[NOTE_MODULE_NAME] = makeAuthorNote('dryRun 新建的污染');
                    return { worldInfoString: '' };
                },
            }),
        });
        const r = await source.resolve(['x'], 100, {});
        assert.equal(isOk(r), true);
        assert.equal(Object.prototype.hasOwnProperty.call(prompts, NOTE_MODULE_NAME), false);
    });

    it('dryRun 抛错时仍恢复已快照的作者注释', async () => {
        const prompts = { [NOTE_MODULE_NAME]: makeAuthorNote('keep-me') };
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
});
