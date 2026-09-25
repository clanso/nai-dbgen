import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const uiRoot = join(here, '../../src/ui');
const tokensCss = readFileSync(join(uiRoot, 'common/tokens.css'), 'utf8');
const componentsCss = readFileSync(join(uiRoot, 'common/components.css'), 'utf8');

/** @param {string} dir */
function walkCss(dir) {
    /** @type {string[]} */
    const out = [];
    for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, name.name);
        if (name.isDirectory()) out.push(...walkCss(p));
        else if (name.name.endsWith('.css')) out.push(p);
    }
    return out;
}

describe('themed scrollbars in .nd-root', () => {
    it('defines scroll tokens and scoped webkit/firefox rules', () => {
        assert.match(tokensCss, /--nd-scroll-size:\s*8px/);
        assert.match(tokensCss, /--nd-scroll-thumb:/);
        assert.match(tokensCss, /--nd-scroll-thumb-hover:/);
        assert.match(tokensCss, /--nd-scroll-thumb-active:/);
        assert.match(tokensCss, /--nd-scroll-track:\s*transparent/);
        assert.match(
            componentsCss,
            /:is\(#nai-dbgen-root,\s*\.nd-root\)\s*,\s*:is\(#nai-dbgen-root,\s*\.nd-root\)\s+\*\s*\{[^}]*scrollbar-width:\s*thin/s,
        );
        assert.match(
            componentsCss,
            /scrollbar-color:\s*var\(--nd-scroll-thumb\)\s+var\(--nd-scroll-track\)/,
        );
        assert.match(
            componentsCss,
            /scrollbar-gutter:\s*auto/,
        );
        assert.match(
            componentsCss,
            /\.nd-root\)\s+\*::-webkit-scrollbar\s*\{[^}]*width:\s*var\(--nd-scroll-size\)\s*!important/s,
        );
        assert.match(
            componentsCss,
            /\*::-webkit-scrollbar-track[\s\S]*?background:\s*var\(--nd-scroll-track\)\s*!important/,
        );
        assert.match(
            componentsCss,
            /\*::-webkit-scrollbar-thumb[\s\S]*?background:\s*var\(--nd-scroll-thumb\)\s*!important/,
        );
        assert.match(
            componentsCss,
            /\*::-webkit-scrollbar-thumb[\s\S]*?border-radius:\s*var\(--nd-radius-pill\)\s*!important/,
        );
        assert.match(
            componentsCss,
            /\*::-webkit-scrollbar-thumb[\s\S]*?background-clip:\s*content-box/,
        );
        assert.match(
            componentsCss,
            /\*::-webkit-scrollbar-thumb[\s\S]*?border:\s*2px\s+solid\s+transparent\s*!important/,
        );
        assert.match(
            componentsCss,
            /\*::-webkit-scrollbar-thumb:hover[\s\S]*?background:\s*var\(--nd-scroll-thumb-hover\)[\s\S]*?background-clip:\s*content-box/s,
        );
        assert.match(
            componentsCss,
            /\*::-webkit-scrollbar-thumb:active[\s\S]*?background:\s*var\(--nd-scroll-thumb-active\)[\s\S]*?background-clip:\s*content-box/s,
        );
    });

    it('src/ui CSS must not use scrollbar-gutter:stable (empty gutter)', () => {
        /** @type {string[]} */
        const hits = [];
        for (const p of walkCss(uiRoot)) {
            const text = readFileSync(p, 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/\/\/[^\n]*/g, '');
            if (/scrollbar-gutter\s*:\s*stable/.test(text)) {
                hits.push(p);
            }
        }
        assert.deepEqual(hits, [], `scrollbar-gutter:stable still present:\n${hits.join('\n')}`);
    });

    it('style.css @import cache-bust covers tokens/components/panels', () => {
        const styleCss = readFileSync(join(uiRoot, '../../style.css'), 'utf8');
        assert.match(styleCss, /tokens\.css\?v=\d{8}/);
        assert.match(styleCss, /components\.css\?v=\d{8}/);
        assert.match(styleCss, /panels\.css\?v=\d{8}/);
    });
});
