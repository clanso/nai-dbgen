import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStMacroBridge } from '../../src/adapters/host/st-macro.bridge.js';

describe('st-macro.bridge', () => {
    it('runHostMacros 委托 substituteParams；缺失时原样返回', () => {
        const bridge = createStMacroBridge({
            getContext: () => ({
                substituteParams: (s) => s.replace('{{char}}', 'Alice'),
            }),
        });
        assert.equal(bridge.runHostMacros('hi {{char}}'), 'hi Alice');
        assert.equal(bridge.runHostMacros(null), '');

        const bare = createStMacroBridge({ getContext: () => ({}) });
        assert.equal(bare.runHostMacros('{{char}}'), '{{char}}');
    });

    it('无 renderSlotMacroHtml 时 register/unregister 为空操作且幂等', () => {
        const bridge = createStMacroBridge({ getContext: () => ({}) });
        bridge.registerMacros();
        bridge.registerMacros();
        bridge.unregisterMacros();
        bridge.unregisterMacros();
    });
});
