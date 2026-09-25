import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cssPath = join(__dirname, '../../src/ui/slot-widget/slot-widget.css');
const css = readFileSync(cssPath, 'utf8');

/** D61 白名单（img 额外三项） */
const ALLOWED_IMPORTANT = new Set([
    'appearance',
    '-webkit-appearance',
    '-moz-appearance',
    'box-sizing',
    'font-family',
    'font-size',
    'line-height',
    'color',
    'background',
    'border',
    'border-color',
    'border-radius',
    'padding',
    'width',
    'height',
    'min-height',
    // img only
    'filter',
    'max-width',
    'object-fit',
]);

describe('D61 slot-widget.css harden', () => {
    it('keeps custom- only on mount-before placeholder', () => {
        assert.match(css, /\.custom-nai-slot\s*\{[^}]*min-height/s);
        // 挂载后类名不得写成 custom-nd-slot*
        assert.doesNotMatch(css, /\.custom-nd-slot/);
        assert.doesNotMatch(css, /\.custom-nai-slot__btn/);
    });

    it('hardens .nd-slot__btn with D61 whitelist props', () => {
        assert.match(css, /\.nd-slot\s+\.nd-slot__btn\s*\{[^}]*appearance:\s*none\s*!important/s);
        assert.match(css, /\.nd-slot\s+\.nd-slot__btn\s*\{[^}]*font-family:\s*inherit\s*!important/s);
        assert.match(css, /\.nd-slot\s+\.nd-slot__btn\s*\{[^}]*font-size:\s*var\(--nd-fs-md\)\s*!important/s);
        assert.match(css, /\.nd-slot\s+\.nd-slot__btn\s*\{[^}]*line-height:\s*1\.2\s*!important/s);
        assert.match(css, /\.nd-slot\s+\.nd-slot__btn\s*\{[^}]*color:[^;]+!important/s);
        assert.match(css, /\.nd-slot\s+\.nd-slot__btn\s*\{[^}]*background:[^;]+!important/s);
        assert.match(css, /\.nd-slot\s+\.nd-slot__btn\s*\{[^}]*border:[^;]+!important/s);
        assert.match(css, /\.nd-slot\s+\.nd-slot__btn\s*\{[^}]*border-radius:[^;]+!important/s);
        assert.match(css, /\.nd-slot\s+\.nd-slot__btn\s*\{[^}]*padding:[^;]+!important/s);
        assert.match(css, /\.nd-slot\s+\.nd-slot__btn\s*\{[^}]*height:[^;]+!important/s);
        assert.match(css, /\.nd-slot\s+\.nd-slot__btn\s*\{[^}]*min-height:[^;]+!important/s);
    });

    it('hardens slot img / thumb against host avatar skins', () => {
        assert.match(css, /\.nd-slot\s+(?:\.nd-slot__thumb|img)[^}]*filter:\s*none\s*!important/s);
        assert.match(css, /\.nd-slot\s+(?:\.nd-slot__thumb|img)[^}]*border-radius:[^;]+!important/s);
        assert.match(css, /\.nd-slot\s+(?:\.nd-slot__thumb|img)[^}]*max-width:[^;]+!important/s);
        assert.match(css, /\.nd-slot\s+(?:\.nd-slot__thumb|img)[^}]*object-fit:\s*contain\s*!important/s);
    });

    it('!important only on D61-allowed properties', () => {
        const all = [...css.matchAll(/([a-zA-Z-]+)\s*:\s*[^;{}]+!important/g)];
        assert.ok(all.length > 10, 'expected many !important declarations');
        for (const m of all) {
            const prop = m[1].toLowerCase();
            assert.ok(
                ALLOWED_IMPORTANT.has(prop),
                `disallowed !important property: ${prop} in "${m[0].slice(0, 80)}"`,
            );
        }
    });

    it('does not put !important on host selectors', () => {
        assert.doesNotMatch(css, /(?:^|})\s*:root[^{]*\{[^}]*!important/s);
        assert.doesNotMatch(css, /(?:^|})\s*body[^{]*\{[^}]*!important/s);
        assert.doesNotMatch(css, /(?:^|})\s*\.mes(?:_text)?[^{]*\{[^}]*!important/s);
        assert.doesNotMatch(css, /(?:^|})\s*#chat[^{]*\{[^}]*!important/s);
    });

    it('scopes catch-all natives under .nd-slot only', () => {
        assert.match(
            css,
            /\.nd-slot\s+button,\s*\n\.nd-slot\s+input,\s*\n\.nd-slot\s+select,\s*\n\.nd-slot\s+textarea/,
        );
    });
});
