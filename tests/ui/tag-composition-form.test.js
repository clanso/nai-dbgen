/**
 * 标签库构图条目表单：分栏字段与校验入口（源码契约）。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const tagPanelSrc = readFileSync(
    join(__dirname, '../../src/ui/panels/tag/tag-panel.js'),
    'utf8',
);
const panelsCss = readFileSync(
    join(__dirname, '../../src/ui/panels/panels.css'),
    'utf8',
);

describe('tag panel composition entry form', () => {
    it('composition editor uses 分类/名称 + readonly key preview only', () => {
        assert.match(tagPanelSrc, /parseCompositionKey/);
        assert.match(tagPanelSrc, /composeCompositionKey/);
        assert.match(tagPanelSrc, /validateTagEntryWriting/);
        assert.match(tagPanelSrc, /label:\s*['"]分类['"]/);
        assert.match(tagPanelSrc, /label:\s*['"]名称['"]/);
        assert.doesNotMatch(tagPanelSrc, /label:\s*['"]触发词['"]/);
        assert.doesNotMatch(tagPanelSrc, /label:\s*['"]且涉及['"]/);
        assert.match(tagPanelSrc, /nd-key-preview/);
    });

    it('feature entry form has 次要关键字 + 且涉及任意/全部', () => {
        assert.match(tagPanelSrc, /label:\s*['"]次要关键字['"]/);
        assert.match(tagPanelSrc, /且涉及任意/);
        assert.match(tagPanelSrc, /且涉及全部/);
        assert.match(tagPanelSrc, /normalizeTagEntrySecondary/);
        assert.match(tagPanelSrc, /setDisabled/);
    });

    it('feature / constant keep single primary key field', () => {
        assert.match(tagPanelSrc, /keyFieldLabel\(kind\)/);
        assert.match(tagPanelSrc, /kind === ['"]composition['"]/);
    });

    it('key preview styles use tokens without !important', () => {
        assert.match(panelsCss, /\.nd-key-preview\s*\{/);
        assert.match(panelsCss, /border-radius:\s*var\(--nd-radius-sm\)/);
        assert.doesNotMatch(panelsCss, /\.nd-key-preview[^{]*\{[^}]*!important/s);
    });
});
