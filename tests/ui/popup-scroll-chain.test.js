import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const componentsCss = readFileSync(join(here, '../../src/ui/common/components.css'), 'utf8');
const panelsCss = readFileSync(join(here, '../../src/ui/panels/panels.css'), 'utf8');
const libraryViewSrc = readFileSync(join(here, '../../src/ui/panels/library-view.js'), 'utf8');

describe('popup scroll chain (management / modal)', () => {
    it('dialog overrides host min-height:fit-content and constrains height', () => {
        assert.match(
            componentsCss,
            /dialog\.nd-popup\.nd-root\s*,\s*dialog\.nd-native-dialog\.nd-root\s*\{[^}]*min-height:\s*0\s*!important/s,
        );
        assert.match(
            componentsCss,
            /dialog\.nd-popup\.nd-root\s*,\s*dialog\.nd-native-dialog\.nd-root\s*\{[^}]*max-height:\s*min\(\s*90vh\s*,\s*820px\s*\)/s,
        );
        assert.match(
            componentsCss,
            /dialog\.nd-popup\.nd-root\.large_dialogue_popup[\s\S]*?height:\s*min\(\s*92vh\s*,\s*960px\s*\)/s,
        );
        assert.match(
            componentsCss,
            /dialog\.nd-popup\.nd-root\.large_dialogue_popup[\s\S]*?min-height:\s*0\s*!important/s,
        );
        // 防回归：不得再让 dialog 继承宿主 fit-content 撑开
        assert.match(
            componentsCss,
            /min-height:\s*fit-content|宿主 `min-height: fit-content`/,
        );
        assert.match(
            componentsCss,
            /dialog\.nd-popup\.nd-root:has\(\.nd-confirm\)[\s\S]*?height:\s*auto\s*!important/,
        );
        assert.match(
            componentsCss,
            /dialog\.nd-popup\.nd-root:has\(\.nd-confirm\) \.nd-modal-title[\s\S]*?white-space:\s*nowrap\s*!important/,
        );
        assert.doesNotMatch(
            componentsCss,
            /\.nd-button--primary\s*\{[^}]*height:/s,
        );
    });

    it('management shell: body does not scroll; library scroller does', () => {
        assert.match(
            panelsCss,
            /\.nd-shell__body\s*\{[^}]*overflow:\s*hidden/s,
        );
        assert.match(
            panelsCss,
            /\.nd-library-view__scroller\s*\{[^}]*overflow:\s*auto/s,
        );
        assert.match(
            panelsCss,
            /\.nd-library-view__scroller\s*\{[^}]*min-height:\s*0/s,
        );
        assert.match(
            panelsCss,
            /\.nd-library-view\s*\{[^}]*overflow:\s*hidden/s,
        );
        assert.match(libraryViewSrc, /nd-library-view__scroller/);
    });

    it('flex children in scroll chain use min-height:0', () => {
        assert.match(panelsCss, /\.nd-shell\s*\{[^}]*min-height:\s*0/s);
        assert.match(panelsCss, /\.nd-shell__body\s*\{[^}]*min-height:\s*0/s);
        assert.match(panelsCss, /\.nd-shell__panel\s*\{[^}]*min-height:\s*0/s);
        assert.match(panelsCss, /\.nd-library-view\s*\{[^}]*min-height:\s*0/s);
        assert.match(
            componentsCss,
            /\.nd-popup-scroll\s*\{[^}]*min-height:\s*0/s,
        );
        assert.match(
            componentsCss,
            /\.nd-modal-root\s*\{[^}]*min-height:\s*0/s,
        );
        assert.match(
            componentsCss,
            /\.popup-body[\s\S]*?min-height:\s*0/s,
        );
    });

    it('dedicated list scrollers for character/tag/prompts', () => {
        assert.match(
            panelsCss,
            /\.nd-panel__list\s*\{[^}]*overflow:\s*auto/s,
        );
        assert.match(
            panelsCss,
            /\.nd-panel__list\s*\{[^}]*min-height:\s*0/s,
        );
        assert.match(
            panelsCss,
            /\.nd-prompts-list\s*\{[^}]*overflow:\s*auto/s,
        );
        assert.match(
            panelsCss,
            /\.nd-prompts-list\s*\{[^}]*min-height:\s*0/s,
        );
        // 库面板自身不滚，避免与 scroller 双条
        assert.match(
            panelsCss,
            /\.nd-panel--artist[\s\S]*?overflow:\s*hidden/s,
        );
    });
});
