import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildExpectedRegexScripts,
    regexScriptMatchesExpected,
    findOwnedRegexScriptIndex,
    upsertOwnedRegexScript,
    toFindRegexLiteral,
    REGEX_SCRIPT_NAME_WIDGET,
    REGEX_SCRIPT_NAME_STRIP,
    REGEX_PLACEMENT_AI_OUTPUT,
    createRegexScriptInstaller,
} from '../../src/adapters/host/regex-script.installer.js';
import { SLOT_TOKEN_PATTERN_SOURCE, slotWidgetReplaceTemplate } from '../../src/domain/slot/slot-token.js';
import { isOk, isErr } from '../../src/infra/result.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const assetsDir = join(dirname(fileURLToPath(import.meta.url)), '../../assets/regex');

describe('regex-script.installer pure helpers', () => {
    it('toFindRegexLiteral 转义 </IMG> 中的斜杠', () => {
        assert.equal(
            toFindRegexLiteral(SLOT_TOKEN_PATTERN_SOURCE, 'gi'),
            '/<IMG>\\s*(\\d+)\\s*<\\/IMG>/gi',
        );
    });

    it('buildExpectedRegexScripts 与 domain slot-token 同源', () => {
        const { widget, strip } = buildExpectedRegexScripts();
        assert.equal(widget.findRegex, toFindRegexLiteral(SLOT_TOKEN_PATTERN_SOURCE, 'gi'));
        assert.equal(strip.findRegex, widget.findRegex);
        assert.equal(widget.replaceString, slotWidgetReplaceTemplate());
        assert.equal(widget.replaceString.startsWith('```'), false);
        assert.equal(widget.replaceString.endsWith('```'), false);
        assert.equal(strip.replaceString, '');
        assert.equal(widget.markdownOnly, true);
        assert.equal(widget.promptOnly, false);
        assert.equal(strip.markdownOnly, false);
        assert.equal(strip.promptOnly, true);
        assert.deepEqual(widget.placement, [REGEX_PLACEMENT_AI_OUTPUT]);
        assert.deepEqual(strip.placement, [REGEX_PLACEMENT_AI_OUTPUT]);
        assert.equal(widget.scriptName, REGEX_SCRIPT_NAME_WIDGET);
        assert.equal(strip.scriptName, REGEX_SCRIPT_NAME_STRIP);
    });

    it('regexScriptMatchesExpected 拒绝 disabled / 被改坏的脚本', () => {
        const { widget } = buildExpectedRegexScripts();
        assert.equal(regexScriptMatchesExpected(widget, widget), true);
        assert.equal(regexScriptMatchesExpected({ ...widget, disabled: true }, widget), false);
        assert.equal(regexScriptMatchesExpected({ ...widget, findRegex: '/x/' }, widget), false);
        assert.equal(regexScriptMatchesExpected({ ...widget, markdownOnly: false }, widget), false);
        assert.equal(regexScriptMatchesExpected({ ...widget, placement: [1] }, widget), false);
    });

    it('upsertOwnedRegexScript 幂等：不产生重复', () => {
        const { widget } = buildExpectedRegexScripts();
        /** @type {object[]} */
        const scripts = [];
        assert.equal(upsertOwnedRegexScript(scripts, widget), 'inserted');
        assert.equal(scripts.length, 1);
        assert.equal(upsertOwnedRegexScript(scripts, widget), 'unchanged');
        assert.equal(scripts.length, 1);
        scripts[0] = { ...scripts[0], replaceString: 'tampered' };
        assert.equal(upsertOwnedRegexScript(scripts, widget), 'updated');
        assert.equal(scripts.length, 1);
        assert.equal(scripts[0].replaceString, widget.replaceString);
    });

    it('findOwnedRegexScriptIndex 可按 id 或 scriptName 定位', () => {
        const { widget } = buildExpectedRegexScripts();
        const scripts = [{ id: 'other', scriptName: 'x' }, { ...widget, id: 'legacy' }];
        // id 优先；此处 id 不同但 scriptName 命中
        assert.equal(findOwnedRegexScriptIndex(scripts, widget), 1);
        scripts[1].id = widget.id;
        assert.equal(findOwnedRegexScriptIndex(scripts, widget), 1);
    });

    it('createRegexScriptInstaller ensureInstalled 写入 extension_settings.regex', async () => {
        /** @type {{ extensionSettings: { regex: object[], disabledExtensions: string[] }, saveSettingsDebouncedCalls: number, powerUserSettings: object }} */
        const state = {
            extensionSettings: { regex: [], disabledExtensions: [] },
            saveSettingsDebouncedCalls: 0,
            powerUserSettings: { encode_tags: false },
        };
        const installer = createRegexScriptInstaller({
            getContext: () => ({
                extensionSettings: state.extensionSettings,
                powerUserSettings: state.powerUserSettings,
                saveSettingsDebounced: () => {
                    state.saveSettingsDebouncedCalls += 1;
                },
            }),
        });

        const r1 = await installer.ensureInstalled();
        assert.equal(isOk(r1), true);
        assert.equal(state.extensionSettings.regex.length, 2);
        assert.equal(state.saveSettingsDebouncedCalls, 1);

        const r2 = await installer.ensureInstalled();
        assert.equal(isOk(r2), true);
        assert.equal(state.extensionSettings.regex.length, 2);

        const v = installer.verify();
        assert.equal(v.ok, true);
        assert.deepEqual(v.missing, []);
    });

    it('regex 扩展禁用时返回 ConfigError', async () => {
        const installer = createRegexScriptInstaller({
            getContext: () => ({
                extensionSettings: { regex: [], disabledExtensions: ['regex'] },
                powerUserSettings: {},
                saveSettingsDebounced: () => {},
            }),
        });
        const r = await installer.ensureInstalled();
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'REGEX_EXTENSION_DISABLED');
    });

    it('assets/regex/*.json 与 buildExpectedRegexScripts 关键字段一致', () => {
        const exp = buildExpectedRegexScripts();
        const widget = JSON.parse(readFileSync(join(assetsDir, 'slot-to-widget.json'), 'utf8'));
        const strip = JSON.parse(readFileSync(join(assetsDir, 'slot-strip.json'), 'utf8'));
        for (const k of ['id', 'scriptName', 'findRegex', 'replaceString', 'markdownOnly', 'promptOnly', 'placement']) {
            assert.deepEqual(widget[k], exp.widget[k], `widget.${k}`);
            assert.deepEqual(strip[k], exp.strip[k], `strip.${k}`);
        }
    });
});
