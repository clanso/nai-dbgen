import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    VARIABLE_NAMES,
    listVariableAliases,
    resolveVariableName,
} from '../../src/domain/template/variable-map.js';
import {
    injectBlockVariables,
    renderPreset,
} from '../../src/domain/template/preset-renderer.js';
import { createBlockSet, setBlock } from '../../src/domain/blocks/block-set.js';

describe('variable-map', () => {
    it('resolves Chinese canonical and ASCII aliases', () => {
        assert.equal(resolveVariableName('世界书'), VARIABLE_NAMES.WORLDINFO);
        assert.equal(resolveVariableName('worldbook'), VARIABLE_NAMES.WORLDINFO);
        assert.equal(resolveVariableName('CONTEXT'), VARIABLE_NAMES.CONTEXT);
        assert.equal(resolveVariableName('unknown_x'), null);
        assert.equal(resolveVariableName(''), null);
    });

    it('listVariableAliases covers four blocks', () => {
        const list = listVariableAliases();
        assert.equal(list.length, 4);
        assert.ok(list.every((x) => x.canonical && x.aliases.length > 0));
    });
});

describe('injectBlockVariables', () => {
    it('replaces only referenced vars; empty → empty string', () => {
        let blocks = createBlockSet();
        blocks = setBlock(blocks, '世界书', 'WI_TEXT');
        blocks = setBlock(blocks, '角色库', 'CHAR_TEXT');
        blocks = setBlock(blocks, '标签库', 'TAG_SHOULD_NOT_LEAK');
        const out = injectBlockVariables('前{{世界书}}中{{character}}后', blocks);
        assert.equal(out, '前WI_TEXT中CHAR_TEXT后');
        assert.equal(out.includes('TAG'), false);
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
});
