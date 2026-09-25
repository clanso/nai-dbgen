import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcRoot = join(__dirname, '../../src');

/** @param {string} dir */
function walkJs(dir) {
    /** @type {string[]} */
    const out = [];
    for (const name of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, name.name);
        if (name.isDirectory()) out.push(...walkJs(p));
        else if (name.name.endsWith('.js')) out.push(p);
    }
    return out;
}

describe('no native browser dialogs in src/**', () => {
    const files = walkJs(srcRoot);

    it('src/** 不得出现 window/globalThis confirm|alert|prompt 或裸调用', () => {
        assert.ok(files.length >= 20, 'expected src js files');
        /** @type {string[]} */
        const hits = [];
        const banned = [
            /\bwindow\.confirm\s*\(/,
            /\bwindow\.alert\s*\(/,
            /\bwindow\.prompt\s*\(/,
            /\bglobalThis\.confirm\s*\(/,
            /\bglobalThis\.alert\s*\(/,
            /\bglobalThis\.prompt\s*\(/,
            // 裸调用（排除 .confirm( / foo.confirm( 等方法调用）
            /(?<![.\w$])confirm\s*\(/,
            /(?<![.\w$])alert\s*\(/,
            /(?<![.\w$])prompt\s*\(/,
        ];
        for (const path of files) {
            const text = readFileSync(path, 'utf8')
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/^\s*\/\/.*$/gm, '');
            text.split(/\n/).forEach((line, i) => {
                // 注释里提 window.confirm 的说明也禁掉（src 内不留退回路径字样）
                for (const re of banned) {
                    if (re.test(line)) {
                        hits.push(`${path}:${i + 1}: ${line.trim()}`);
                        break;
                    }
                }
            });
        }
        assert.deepEqual(hits, [], `native dialog API still present:\n${hits.join('\n')}`);
    });
});
