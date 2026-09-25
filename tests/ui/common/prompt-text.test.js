/**
 * formatPromptText / parsePromptText 往返与宽容解析。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    formatPromptText,
    parsePromptText,
    findMatchingArtist,
    isUsableArtist,
} from '../../../src/ui/common/prompt-text.js';
import { resolvePasteArtistAction } from '../../../src/ui/workbench/workbench-logic.js';

/**
 * @param {object} [opts]
 */
function makeCaption(opts = {}) {
    return {
        v4_prompt: {
            caption: {
                base_caption: opts.positive ?? '',
                char_captions: opts.chars ?? [],
            },
        },
        v4_negative_prompt: {
            caption: {
                base_caption: opts.negative ?? '',
                char_captions: opts.negChars ?? [],
            },
        },
    };
}

describe('ui/common/prompt-text · format', () => {
    it('0 characters: scene only; omits empty lines', () => {
        const text = formatPromptText(makeCaption({
            positive: 'garden',
            negative: 'lowres',
        }));
        assert.equal(
            text,
            [
                '场景',
                '正面：garden',
                '负面：lowres',
            ].join('\n'),
        );
    });

    it('omits whole scene when both empty; keeps characters', () => {
        const text = formatPromptText(makeCaption({
            positive: '',
            negative: '  ',
            chars: [{ char_caption: '1girl', centers: [{ x: 0.42, y: 0.58 }] }],
            negChars: [{ char_caption: '', centers: [{ x: 0.42, y: 0.58 }] }],
        }));
        assert.equal(
            text,
            [
                '角色1',
                '正面：1girl',
                '位置：0.42, 0.58',
            ].join('\n'),
        );
    });

    it('two characters with positions; no artist when unchecked', () => {
        const caption = makeCaption({
            positive: 'scene',
            negative: 'uc',
            chars: [
                { char_caption: 'alice', centers: [{ x: 0.42, y: 0.58 }] },
                { char_caption: 'bob', centers: [{ x: 0.78, y: 0.52 }] },
            ],
            negChars: [
                { char_caption: 'negA', centers: [{ x: 0.42, y: 0.58 }] },
                { char_caption: 'negB', centers: [{ x: 0.78, y: 0.52 }] },
            ],
        });
        const artist = { positive: 'artist:foo', negative: 'worst' };
        const plain = formatPromptText(caption, { artist, includeArtist: false });
        assert.ok(!plain.includes('画师串'));
        assert.ok(!plain.includes('artist:foo'));
        assert.equal(
            plain,
            [
                '场景',
                '正面：scene',
                '负面：uc',
                '',
                '角色1',
                '正面：alice',
                '负面：negA',
                '位置：0.42, 0.58',
                '',
                '角色2',
                '正面：bob',
                '负面：negB',
                '位置：0.78, 0.52',
            ].join('\n'),
        );
    });

    it('includeArtist prepends 画师串; scene not prefixed', () => {
        const caption = makeCaption({
            positive: 'garden',
            negative: 'lowres',
            chars: [{ char_caption: '1girl', centers: [{ x: 0.5, y: 0.5 }] }],
            negChars: [{ char_caption: 'bad hands', centers: [{ x: 0.5, y: 0.5 }] }],
        });
        const withArtist = formatPromptText(caption, {
            artist: { positive: 'artist:foo', negative: 'worst quality' },
            includeArtist: true,
        });
        assert.match(withArtist, /^画师串\n正面：artist:foo\n负面：worst quality\n\n场景\n正面：garden\n/s);
        assert.ok(!withArtist.includes('artist:foo, garden'));
        assert.ok(!withArtist.includes('image###'));
        assert.ok(!withArtist.includes('Scene:'));
        assert.ok(!withArtist.includes('centers:'));
    });

    it('omits position when centers missing', () => {
        const text = formatPromptText(makeCaption({
            positive: 's',
            negative: 'n',
            chars: [{ char_caption: 'solo' }],
            negChars: [{ char_caption: 'uc' }],
        }));
        assert.equal(
            text,
            [
                '场景',
                '正面：s',
                '负面：n',
                '',
                '角色1',
                '正面：solo',
                '负面：uc',
            ].join('\n'),
        );
        assert.ok(!text.includes('位置'));
    });
});

describe('ui/common/prompt-text · parse / round-trip', () => {
    it('round-trips 0/1/2 characters with and without artist / position', () => {
        const cases = [
            makeCaption({ positive: 'a', negative: 'b' }),
            makeCaption({
                positive: 's',
                negative: 'n',
                chars: [{ char_caption: 'c1', centers: [{ x: 0.42, y: 0.58 }] }],
                negChars: [{ char_caption: 'n1', centers: [{ x: 0.42, y: 0.58 }] }],
            }),
            makeCaption({
                positive: 's',
                negative: '',
                chars: [
                    { char_caption: 'a', centers: [{ x: 0.1, y: 0.2 }] },
                    { char_caption: 'b', centers: [{ x: 0.78, y: 0.52 }] },
                ],
                negChars: [
                    { char_caption: '', centers: [{ x: 0.1, y: 0.2 }] },
                    { char_caption: 'bn', centers: [{ x: 0.78, y: 0.52 }] },
                ],
            }),
            makeCaption({
                positive: 's',
                negative: 'n',
                chars: [{ char_caption: 'no-pos' }],
                negChars: [{ char_caption: 'no-pos-n' }],
            }),
        ];
        for (const caption of cases) {
            for (const includeArtist of [false, true]) {
                const artist = { positive: 'ap', negative: 'an' };
                const text = formatPromptText(caption, { artist, includeArtist });
                const parsed = parsePromptText(text);
                assert.equal(parsed.ok, true);
                if (!parsed.ok) continue;
                assert.equal(
                    formatPromptText(parsed.value.caption, {
                        artist: parsed.value.artist,
                        includeArtist: Boolean(parsed.value.artist),
                    }),
                    text,
                );
                if (includeArtist) {
                    assert.deepEqual(parsed.value.artist, artist);
                } else {
                    assert.equal(parsed.value.artist, null);
                }
            }
        }
    });

    it('tolerates halfwidth colon, CRLF, whitespace, non-contiguous 角色编号', () => {
        const text = [
            '画师串',
            '正面: art+',
            '负面:art-',
            '',
            '场景',
            '正面: scene pos',
            '负面：scene neg',
            '',
            '角色 3',
            '正面：third',
            '位置: 0.78, 0.52',
            '',
            '角色1',
            '正面：first',
            '负面：first-n',
        ].join('\r\n');
        const parsed = parsePromptText(text);
        assert.equal(parsed.ok, true);
        if (!parsed.ok) return;
        assert.deepEqual(parsed.value.artist, { positive: ' art+', negative: 'art-' });
        assert.equal(parsed.value.caption.v4_prompt.caption.base_caption, ' scene pos');
        assert.equal(parsed.value.caption.v4_negative_prompt.caption.base_caption, 'scene neg');
        const chars = parsed.value.caption.v4_prompt.caption.char_captions;
        assert.equal(chars.length, 2);
        assert.equal(chars[0].char_caption, 'third');
        assert.deepEqual(chars[0].centers, [{ x: 0.78, y: 0.52 }]);
        assert.equal(chars[1].char_caption, 'first');
    });

    it('rejects non-prompt text', () => {
        const bad = parsePromptText('hello world\nnot a prompt');
        assert.equal(bad.ok, false);
        if (bad.ok) return;
        assert.equal(bad.error.message, '剪贴板里不是提示词');

        const artistOnly = parsePromptText('画师串\n正面：x\n负面：y');
        assert.equal(artistOnly.ok, false);
    });

    it('truncates characters over max and reports message', () => {
        const lines = ['场景', '正面：s'];
        for (let i = 1; i <= 6; i += 1) {
            lines.push('', `角色${i}`, `正面：c${i}`);
        }
        const parsed = parsePromptText(lines.join('\n'), { maxCharacters: 4 });
        assert.equal(parsed.ok, true);
        if (!parsed.ok) return;
        assert.equal(parsed.value.truncated, true);
        assert.match(parsed.value.truncateMessage || '', /截断/);
        assert.equal(parsed.value.caption.v4_prompt.caption.char_captions.length, 4);
    });
});

describe('ui/common/prompt-text · artist match', () => {
    it('findMatchingArtist requires both sides trim-equal', () => {
        const list = [
            { id: 'a1', name: 'A', positive: '  foo  ', negative: 'bar' },
            { id: 'a2', name: 'B', positive: 'foo', negative: 'other' },
        ];
        assert.equal(isUsableArtist({ positive: 'x', negative: '' }), true);
        const hit = findMatchingArtist(list, { positive: 'foo', negative: 'bar' });
        assert.equal(hit?.id, 'a1');
        assert.equal(findMatchingArtist(list, { positive: 'foo', negative: 'nope' }), null);
    });

    it('resolvePasteArtistAction covers matched / missing / none', () => {
        const artists = [
            { id: 'a1', name: '示例', positive: 'p', negative: 'n' },
        ];
        assert.equal(
            resolvePasteArtistAction({ artist: null }, artists).artistAction,
            'none',
        );
        assert.equal(
            resolvePasteArtistAction({ artist: { positive: 'p', negative: 'n' } }, artists)
                .artistAction,
            'matched',
        );
        assert.equal(
            resolvePasteArtistAction({ artist: { positive: 'p', negative: 'x' } }, artists)
                .artistAction,
            'missing',
        );
    });
});
