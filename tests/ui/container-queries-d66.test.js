import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiRoot = join(__dirname, '../../src/ui');

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

describe('D66 container queries (no viewport layout breakpoints)', () => {
    const cssFiles = walkCss(uiRoot);
    const allCss = cssFiles.map((p) => ({
        path: p,
        text: readFileSync(p, 'utf8'),
    }));
    const tokens = allCss.find((f) => f.path.endsWith('tokens.css'))?.text ?? '';
    const components = allCss.find((f) => f.path.endsWith('components.css'))?.text ?? '';
    const slot = allCss.find((f) => f.path.endsWith('slot-widget.css'))?.text ?? '';

    it('nd-root establishes named container like nd-slot', () => {
        assert.match(tokens, /container-type:\s*inline-size/);
        assert.match(tokens, /container-name:\s*nd-root/);
        assert.match(slot, /container-name:\s*nd-slot/);
        assert.match(slot, /@container\s+nd-slot\s*\(/);
    });

    it('library/panel layout uses @container nd-root, not viewport width media', () => {
        assert.match(components, /@container\s+nd-root\s*\(\s*max-width:\s*720px\s*\)/);
        assert.match(components, /@container\s+nd-root\s*\(\s*max-width:\s*540px\s*\)/);
        assert.match(components, /@container\s+nd-root\s*\(\s*max-width:\s*420px\s*\)/);
        assert.doesNotMatch(
            components,
            /@media\s*\(\s*(?:max|min)-width/,
            'components.css must not use viewport width @media for layout',
        );
    });

    it('no src/ui CSS uses viewport width @media for layout', () => {
        /** @type {string[]} */
        const hits = [];
        for (const { path, text } of allCss) {
            // 剥注释后再扫，避免说明文字误报
            const stripped = text
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/\/\/[^\n]*/g, '');
            const blocks = stripped.matchAll(/@media\s*([^{]+)\{/g);
            for (const m of blocks) {
                const cond = m[1];
                if (/\b(?:max|min)-width\s*:/.test(cond)) {
                    hits.push(`${path}: @media ${cond.trim()}`);
                }
            }
        }
        assert.deepEqual(hits, [], `viewport width media still present:\n${hits.join('\n')}`);
    });

    it('toolbar uses flex + actions group (no boxed chrome)', () => {
        assert.match(
            components,
            /\.nd-library-toolbar\s*\{[^}]*display:\s*flex/s,
        );
        assert.match(components, /\.nd-library-toolbar__actions\s*\{/);
        assert.match(
            components,
            /@container\s+nd-root\s*\(\s*max-width:\s*720px\s*\)[\s\S]*?\.nd-library-toolbar__actions\s*\{[^}]*flex:\s*1\s+1\s+100%/s,
        );
    });
});
