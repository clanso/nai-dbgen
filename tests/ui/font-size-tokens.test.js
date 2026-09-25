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

describe('D64 font-size tokens (no nested em)', () => {
    const cssFiles = walkCss(uiRoot);
    const allCss = cssFiles.map((p) => ({ path: p, text: readFileSync(p, 'utf8') }));
    const tokensCss = allCss.find((f) => f.path.endsWith('tokens.css'))?.text ?? '';

    it('src/ui/** 样式表不得用 em 定 font-size（含 font 简写）', () => {
        assert.ok(cssFiles.length >= 5, 'expected ui css files');
        /** @type {string[]} */
        const hits = [];
        for (const { path, text } of allCss) {
            text.split(/\n/).forEach((line, i) => {
                if (/font-size\s*:\s*[^;]*\bem\b/.test(line)) {
                    hits.push(`${path}:${i + 1}: ${line.trim()}`);
                }
                if (/font\s*:\s*[^;]*\d[\d.]*em\b/.test(line)) {
                    hits.push(`${path}:${i + 1}: ${line.trim()}`);
                }
            });
        }
        assert.deepEqual(hits, [], `em font-size still present:\n${hits.join('\n')}`);
    });

    it('字号令牌从 --mainFontSize 直算并带 11px 下限', () => {
        for (const name of [
            '--nd-fs-base',
            '--nd-fs-xs',
            '--nd-fs-sm',
            '--nd-fs-md',
            '--nd-fs-lg',
            '--nd-fs-title',
            '--nd-fs-display',
        ]) {
            assert.match(tokensCss, new RegExp(`${name.replace(/-/g, '\\-')}\\s*:`));
        }
        assert.match(
            tokensCss,
            /--nd-fs-base:\s*max\(\s*11px\s*,\s*var\(--mainFontSize,\s*15px\)\s*\)/,
        );
        assert.match(
            tokensCss,
            /--nd-fs-sm:\s*max\(\s*11px\s*,\s*calc\(\s*var\(--mainFontSize,\s*15px\)\s*\*\s*11\s*\/\s*15\s*\)\s*\)/,
        );
        assert.match(
            tokensCss,
            /--nd-fs-md:\s*max\(\s*11px\s*,\s*calc\(\s*var\(--mainFontSize,\s*15px\)\s*\*\s*12\s*\/\s*15\s*\)\s*\)/,
        );
        assert.match(
            tokensCss,
            /--nd-fs-xs:\s*max\(\s*11px\s*,\s*calc\(\s*var\(--mainFontSize,\s*15px\)/,
        );
        // 不得写成 em 套 em
        assert.doesNotMatch(tokensCss, /--nd-fs-[a-z]+:\s*[^;]*\bem\b/);
    });

    it('components 控件字号读令牌（编辑组 / 删除组 / 导入导出）', () => {
        const components = allCss.find((f) => f.path.endsWith('components.css'))?.text ?? '';
        assert.match(components, /\.nd-button\s*\{[^}]*font-size:\s*var\(--nd-fs-md\)\s*!important/s);
        assert.match(
            components,
            /\.nd-text-button\s*\{[^}]*font-size:\s*var\(--nd-fs-sm\)\s*!important/s,
        );
        assert.match(components, /\.nd-text-button\s*\{[^}]*white-space:\s*nowrap/s);
    });
});
