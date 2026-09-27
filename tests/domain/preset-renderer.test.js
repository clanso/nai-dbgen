import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    VARIABLE_NAMES,
    listRegisteredVariables,
    resolveVariableName,
} from '../../src/domain/template/variable-map.js';
import {
    injectBlockVariables,
    renderPreset,
} from '../../src/domain/template/preset-renderer.js';
import { createBlockSet, setBlock } from '../../src/domain/blocks/block-set.js';

describe('variable-map', () => {
    it('resolves only Chinese canonical names', () => {
        assert.equal(resolveVariableName('世界书'), VARIABLE_NAMES.WORLDINFO);
        assert.equal(resolveVariableName('当前上下文'), VARIABLE_NAMES.CONTEXT);
        assert.equal(resolveVariableName('角色库'), VARIABLE_NAMES.CHARACTER);
        assert.equal(resolveVariableName('构图标签'), VARIABLE_NAMES.COMPOSITION);
        assert.equal(resolveVariableName('特征参考'), VARIABLE_NAMES.FEATURE);
        assert.equal(resolveVariableName('常驻标签'), VARIABLE_NAMES.CONSTANT);
        assert.equal(resolveVariableName('近期生图记录'), VARIABLE_NAMES.RECENT_SLOTS);
        assert.equal(resolveVariableName('用户描述'), VARIABLE_NAMES.USER_DESC);
        assert.equal(resolveVariableName('worldbook'), null);
        assert.equal(resolveVariableName('标签库'), null);
        assert.equal(resolveVariableName('composition'), null);
        assert.equal(resolveVariableName('unknown_x'), null);
        assert.equal(resolveVariableName(''), null);
    });

    it('listRegisteredVariables covers blocks + user desc', () => {
        const list = listRegisteredVariables();
        assert.equal(list.length, 8);
        assert.ok(list.includes(VARIABLE_NAMES.COMPOSITION));
        assert.ok(list.includes(VARIABLE_NAMES.FEATURE));
        assert.ok(list.includes(VARIABLE_NAMES.CONSTANT));
        assert.ok(list.includes(VARIABLE_NAMES.RECENT_SLOTS));
        assert.ok(list.includes(VARIABLE_NAMES.USER_DESC));
        assert.ok(!('TAG' in VARIABLE_NAMES));
        assert.equal(VARIABLE_NAMES.COMPOSITION, '构图标签');
        assert.equal(VARIABLE_NAMES.CONSTANT, '常驻标签');
        assert.equal(VARIABLE_NAMES.RECENT_SLOTS, '近期生图记录');
    });
});

describe('injectBlockVariables', () => {
    it('replaces only referenced vars; empty → empty string', () => {
        let blocks = createBlockSet();
        blocks = setBlock(blocks, '世界书', 'WI_TEXT');
        blocks = setBlock(blocks, '角色库', 'CHAR_TEXT');
        blocks = setBlock(blocks, '构图标签', 'TAG_SHOULD_NOT_LEAK');
        const out = injectBlockVariables('前{{世界书}}中{{角色库}}后', blocks);
        assert.equal(out, '前WI_TEXT中CHAR_TEXT后');
        assert.equal(out.includes('TAG'), false);
        // 旧别名 / ASCII 不替换，保留原文
        assert.equal(
            injectBlockVariables('{{标签库}}/{{composition}}', blocks),
            '{{标签库}}/{{composition}}',
        );
    });

    it('renders 常驻标签 like other blocks', () => {
        let blocks = createBlockSet();
        blocks = setBlock(blocks, '常驻标签', '杂项: misc\n镜头: cinematic');
        assert.equal(
            injectBlockVariables('K={{常驻标签}}', blocks),
            'K=杂项: misc\n镜头: cinematic',
        );
    });

    it('renders 近期生图记录 like other blocks', () => {
        let blocks = createBlockSet();
        blocks = setBlock(blocks, '近期生图记录', 'slotid: 1\n尺寸: 832x1216');
        assert.equal(
            injectBlockVariables('R={{近期生图记录}}', blocks),
            'R=slotid: 1\n尺寸: 832x1216',
        );
    });

    it('unknown variables kept as-is; single-pass no recursion', () => {
        let blocks = createBlockSet();
        blocks = setBlock(blocks, '世界书', '见{{角色库}}嵌套');
        blocks = setBlock(blocks, '角色库', 'DNA');
        const out = injectBlockVariables('{{世界书}} / {{未知变量}}', blocks);
        assert.equal(out, '见{{角色库}}嵌套 / {{未知变量}}');
    });

    it('handles metacharacters in names via lookup not dynamic regex', () => {
        let blocks = createBlockSet([['a+b', 'OK']]);
        assert.equal(injectBlockVariables('{{a+b}}', blocks), 'OK');
    });

    it('throws on non-string template', () => {
        assert.throws(() => injectBlockVariables(null, createBlockSet()));
    });
});

describe('renderPreset', () => {
    it('runs host macros before block inject', () => {
        const order = [];
        const preset = {
            prompts: [
                {
                    identifier: 'main',
                    name: 'Main',
                    role: 'system',
                    content: 'char={{char}} wi={{世界书}}',
                    enabled: true,
                },
            ],
            prompt_order: [{ identifier: 'main', enabled: true }],
        };
        const blocks = createBlockSet([['世界书', '{{char}}leak']]);
        const messages = renderPreset(preset, blocks, {
            runHostMacros: (t) => {
                order.push('host');
                return t.replace(/\{\{char\}\}/gi, 'Alice');
            },
        });
        order.push('done');
        assert.deepEqual(order, ['host', 'done']);
        assert.equal(messages.length, 1);
        // 宿主宏先跑：模板里的 {{char}}→Alice；块内容里的 {{char}} 不再被宏扫到
        assert.equal(messages[0].content, 'char=Alice wi={{char}}leak');
        assert.equal(messages[0].role, 'system');
    });

    it('skips disabled order items', () => {
        const preset = {
            prompts: [
                { identifier: 'a', role: 'user', content: 'A', enabled: true },
                { identifier: 'b', role: 'user', content: 'B', enabled: true },
            ],
            prompt_order: [
                { identifier: 'a', enabled: true },
                { identifier: 'b', enabled: false },
            ],
        };
        const msgs = renderPreset(preset, createBlockSet(), {
            runHostMacros: (t) => t,
        });
        assert.deepEqual(msgs.map((m) => m.content), ['A']);
    });

    it('楼内生图跳过工作台专用段，工作台仍带上', () => {
        const preset = {
            prompts: [
                { identifier: 'a', role: 'system', content: '公共', enabled: true },
                { identifier: 'b', role: 'system', content: '工作台提示', enabled: true, workbenchOnly: true },
            ],
            prompt_order: [
                { identifier: 'a', enabled: true },
                { identifier: 'b', enabled: true },
            ],
        };
        const floor = renderPreset(preset, createBlockSet(), {
            runHostMacros: (t) => t,
            omitWorkbenchOnly: true,
        });
        const bench = renderPreset(preset, createBlockSet(), {
            runHostMacros: (t) => t,
        });
        assert.deepEqual(floor.map((m) => m.content), ['公共']);
        assert.deepEqual(bench.map((m) => m.content), ['公共', '工作台提示']);
    });
});
