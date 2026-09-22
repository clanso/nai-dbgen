import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    matchKeyword,
    matchAnyKeyword,
    tryParseRegexKeyword,
} from '../../src/domain/matching/keyword-matcher.js';

const GLOBALS = { caseSensitive: false, matchWholeWords: false };

describe('keyword-matcher', () => {
    describe('tryParseRegexKeyword', () => {
        it('parses /pattern/flags', () => {
            const re = tryParseRegexKeyword('/foo.bar/i');
            assert.ok(re instanceof RegExp);
            assert.equal(re.flags.includes('i'), true);
            assert.equal(re.test('FOOXbar'), true);
        });

        it('returns null for plain text and unescaped slash', () => {
            assert.equal(tryParseRegexKeyword('plain'), null);
            assert.equal(tryParseRegexKeyword('/a/b/'), null);
            assert.equal(tryParseRegexKeyword(null), null);
        });

        it('unescapes \\/ inside pattern', () => {
            const re = tryParseRegexKeyword('/a\\/b/');
            assert.ok(re);
            assert.equal(re.test('a/b'), true);
        });
    });

    describe('matchKeyword', () => {
        it('matches plain case-insensitive by default', () => {
            assert.equal(matchKeyword('Hello Alice', 'alice', null, GLOBALS), true);
            assert.equal(matchKeyword('Hello Alice', 'bob', null, GLOBALS), false);
        });

        it('respects caseSensitive override', () => {
            assert.equal(
                matchKeyword('Hello Alice', 'alice', { caseSensitive: true }, GLOBALS),
                false,
            );
            assert.equal(
                matchKeyword('Hello Alice', 'Alice', { caseSensitive: true }, GLOBALS),
                true,
            );
        });

        it('empty needle never matches (includes empty pitfall)', () => {
            assert.equal(matchKeyword('anything', '', null, GLOBALS), false);
            assert.equal(matchKeyword('', '', null, GLOBALS), false);
        });

        it('regex needle ignores case/whole-word switches', () => {
            assert.equal(
                matchKeyword('abc123', '/abc\\d+/', { caseSensitive: true, matchWholeWords: true }, GLOBALS),
                true,
            );
        });

        it('whole-word uses \\W not \\b; multi-word bypasses', () => {
            const whole = { caseSensitive: false, matchWholeWords: true };
            assert.equal(matchKeyword('cat', 'cat', null, whole), true);
            assert.equal(matchKeyword('concatenate', 'cat', null, whole), false);
            assert.equal(matchKeyword('say:cat!', 'cat', null, whole), true);
            // multi-word → includes
            assert.equal(matchKeyword('hello world today', 'hello world', null, whole), true);
        });

        it('CJK whole-word: \\W treats CJK as non-word so substring can still hit', () => {
            // 宿主能力基线 §6.4：边界是 \\W。汉字彼此之间也是 \\W，
            // 因此「张」在「张三」中：(^|\\W)(张)($|\\W) —— 「三」是 \\W，会命中。
            const whole = { caseSensitive: false, matchWholeWords: true };
            assert.equal(matchKeyword('张三来了', '张', null, whole), true);
            assert.equal(matchKeyword('李四来了', '张', null, whole), false);
            assert.equal(matchKeyword('张三来了', '张三', null, whole), true);
        });

        it('rejects non-string haystack/needle', () => {
            assert.equal(matchKeyword(null, 'a', null, GLOBALS), false);
            assert.equal(matchKeyword('a', null, null, GLOBALS), false);
        });
    });

    describe('matchAnyKeyword', () => {
        it('true if any needle hits; skips empty', () => {
            assert.equal(matchAnyKeyword('see bob here', ['', 'bob'], null, GLOBALS), true);
            assert.equal(matchAnyKeyword('see bob here', ['alice', 'carol'], null, GLOBALS), false);
            assert.equal(matchAnyKeyword('x', [], null, GLOBALS), false);
            assert.equal(matchAnyKeyword('x', null, null, GLOBALS), false);
        });
    });
});
