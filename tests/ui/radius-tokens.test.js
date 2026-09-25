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

/** 单角允许：0 / 50% / var(--nd-radius-*) */
const CORNER = String.raw`(?:0|50%|var\(--nd-radius-(?:lg|md|sm|xs|pill)\))`;

describe('D69 radius tokens (no hardcoded px)', () => {
    const cssFiles = walkCss(uiRoot);
    const allCss = cssFiles.map((p) => ({ path: p, text: readFileSync(p, 'utf8') }));
    const tokensCss = allCss.find((f) => f.path.endsWith('tokens.css'))?.text ?? '';

    it('圆角令牌为四档递减 + pill，无旧别名', () => {
        assert.match(tokensCss, /--nd-radius-lg:\s*16px/);
        assert.match(tokensCss, /--nd-radius-md:\s*12px/);
        assert.match(tokensCss, /--nd-radius-sm:\s*8px/);
        assert.match(tokensCss, /--nd-radius-xs:\s*6px/);
        assert.match(tokensCss, /--nd-radius-pill:\s*999px/);
        assert.doesNotMatch(tokensCss, /--nd-radius-modal\s*:/);
        assert.doesNotMatch(tokensCss, /--nd-radius-card\s*:/);
        assert.doesNotMatch(tokensCss, /--nd-radius-control\s*:/);
        assert.doesNotMatch(tokensCss, /--nd-control-radius\s*:/);
        // 裸别名 --nd-radius: 不得再有
        assert.doesNotMatch(tokensCss, /--nd-radius\s*:/);
    });

    it('src/ui/** 的 border-radius 只允许 var(--nd-radius-*) / 50% / 0', () => {
        assert.ok(cssFiles.length >= 5, 'expected ui css files');
        /** @type {string[]} */
        const hits = [];
        const declRe = /border-radius\s*:\s*([^;]+);/g;
        for (const { path, text } of allCss) {
            // 去掉块注释，避免误报
            const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '');
            let m;
            while ((m = declRe.exec(stripped)) !== null) {
                const raw = m[1].replace(/\s*!important\s*$/i, '').trim();
                const parts = raw.split(/\s+/).filter(Boolean);
                const ok = parts.length >= 1
                    && parts.length <= 4
                    && parts.every((p) => new RegExp(`^${CORNER}$`).test(p));
                if (!ok) {
                    hits.push(`${path}: border-radius: ${m[1].trim()}`);
                }
            }
        }
        assert.deepEqual(hits, [], `illegal border-radius:\n${hits.join('\n')}`);
    });

    it('弹层 / 卡片 / 控件消费新档位', () => {
        const components = allCss.find((f) => f.path.endsWith('components.css'))?.text ?? '';
        assert.match(
            components,
            /dialog\.nd-popup\.nd-root\s*,\s*dialog\.nd-native-dialog\.nd-root\s*\{[^}]*border-radius:\s*var\(--nd-radius-lg\)\s*!important/s,
        );
        assert.match(
            components,
            /\.nd-style-card\s*\{[^}]*border-radius:\s*var\(--nd-radius-md\)/s,
        );
        assert.match(
            components,
            /\.nd-button\s*\{[^}]*border-radius:\s*var\(--nd-radius-sm\)\s*!important/s,
        );
        assert.match(
            components,
            /\.nd-native-dialog__close\s*\{[^}]*border-radius:\s*var\(--nd-radius-xs\)\s*!important/s,
        );
        assert.match(
            components,
            /\.nd-slot-viewer__img\s*\{[^}]*border-radius:\s*var\(--nd-radius-md\)/s,
        );
        assert.match(components, /\.nd-native-dialog__shell\s*\{[^}]*background:\s*transparent/s);
        assert.doesNotMatch(
            components,
            /\.nd-native-dialog__shell\s*\{[^}]*border-radius:\s*var\(--nd-radius-/s,
        );
    });
});
