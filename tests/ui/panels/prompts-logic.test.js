/**
 * 提示词面板纯函数：分层展示 / 搜索 / 复制分类文本。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildCopyPromptText,
    buildPromptDisplayModel,
    filterFloorGroups,
    isUsableArtist,
    recordSearchBlob,
    resolveArtistIdForRecord,
} from '../../../src/ui/panels/prompts/prompts-logic.js';
import { formatPromptText } from '../../../src/ui/common/prompt-text.js';

/**
 * @param {object} [opts]
 */
function makeCaption(opts = {}) {
    return {
        v4_prompt: {
            caption: {
                base_caption: opts.positive ?? 'scene base',
                char_captions: opts.chars ?? [],
            },
        },
        v4_negative_prompt: {
            caption: {
                base_caption: opts.negative ?? 'scene neg',
                char_captions: opts.negChars ?? [],
            },
        },
    };
}

describe('ui/panels/prompts-logic · search', () => {
    it('recordSearchBlob matches categorized text including artist', () => {
        const record = {
            caption: makeCaption({
                positive: 'alpha wolf',
                chars: [{ char_caption: '1girl', centers: [{ x: 0.5, y: 0.5 }] }],
            }),
        };
        const artist = { positive: 'artist:example', negative: 'lowres' };
        const blob = recordSearchBlob(record, artist);
        assert.ok(blob.includes('画师串'));
        assert.ok(blob.includes('alpha wolf'));
        assert.ok(blob.includes('角色1'));
        assert.ok(blob.includes('位置：0.50, 0.50'));
        assert.ok(!blob.includes('image###'));
        assert.ok(!blob.includes('scene:'));
        assert.ok(!blob.includes('centers:'));
    });

    it('filterFloorGroups searches categorized text', () => {
        const groups = [{
            messageId: 1,
            summary: 'x',
            status: /** @type {'ok'} */ ('ok'),
            records: [{
                caption: makeCaption({
                    positive: 'scene',
                    negChars: [{ char_caption: 'unique-neg-token' }],
                    chars: [{ char_caption: 'hero' }],
                }),
            }],
        }];
        const hit = filterFloorGroups(groups, 'unique-neg-token');
        assert.equal(hit.length, 1);
        assert.equal(filterFloorGroups(groups, 'nope').length, 0);
    });
});

describe('ui/panels/prompts-logic · display model / copy', () => {
    it('buildPromptDisplayModel hides empty rows and empty categories', () => {
        const emptyArtist = buildPromptDisplayModel(makeCaption({
            positive: '',
            negative: '',
            chars: [],
            negChars: [],
        }), null);
        assert.deepEqual(emptyArtist.sections, []);
        assert.equal(emptyArtist.hasArtist, false);

        const sceneOnly = buildPromptDisplayModel(makeCaption({
            positive: 'garden',
            negative: '',
            chars: [],
            negChars: [],
        }), { positive: '', negative: '  ' });
        assert.equal(sceneOnly.hasArtist, false);
        assert.deepEqual(sceneOnly.sections, [{
            title: '场景',
            rows: [{ label: '正面', text: 'garden' }],
        }]);

        const withArtistAndChars = buildPromptDisplayModel(makeCaption({
            positive: 'scene',
            negative: 'uc',
            chars: [
                { char_caption: 'alice' },
                { char_caption: '' },
            ],
            negChars: [
                { char_caption: '' },
                { char_caption: 'bob-neg' },
            ],
        }), { positive: 'a+', negative: 'a-' });
        assert.equal(withArtistAndChars.hasArtist, true);
        assert.equal(withArtistAndChars.sections[0].title, '画师串');
        assert.equal(withArtistAndChars.sections[1].title, '场景');
        assert.equal(withArtistAndChars.sections[2].title, '角色');
        assert.deepEqual(withArtistAndChars.sections[2].children, [
            { title: '角色1', rows: [{ label: '正面', text: 'alice' }] },
            { title: '角色2', rows: [{ label: '负面', text: 'bob-neg' }] },
        ]);
    });

    it('buildPromptDisplayModel omits 角色 when no char text and never shows 位置', () => {
        const model = buildPromptDisplayModel(makeCaption({
            positive: 's',
            negative: 'n',
            chars: [{ char_caption: '   ', centers: [{ x: 0.5, y: 0.5 }] }],
            negChars: [{ char_caption: '' }],
        }), null);
        assert.equal(model.sections.length, 1);
        assert.equal(model.sections[0].title, '场景');
        assert.ok(!JSON.stringify(model).includes('位置'));
    });

    it('isUsableArtist / resolveArtistIdForRecord', () => {
        assert.equal(isUsableArtist(null), false);
        assert.equal(isUsableArtist({ positive: '', negative: '' }), false);
        assert.equal(isUsableArtist({ positive: 'x', negative: '' }), true);

        assert.equal(resolveArtistIdForRecord({ images: [] }, 'active-1'), 'active-1');
        assert.equal(resolveArtistIdForRecord({
            images: [
                { imageRef: 'a', createdAt: '', naiConfigId: null, artistId: null },
                { imageRef: 'b', createdAt: '', naiConfigId: null, artistId: 'img-artist' },
            ],
        }, 'active-1'), 'img-artist');
        assert.equal(resolveArtistIdForRecord({
            images: [{ imageRef: 'a', createdAt: '', naiConfigId: null, artistId: null }],
        }, null), null);
    });

    it('buildCopyPromptText without artist omits 画师串; with artist prepends it', () => {
        const caption = makeCaption({
            positive: 'garden',
            negative: 'lowres',
            chars: [{ char_caption: '1girl', centers: [{ x: 0.5, y: 0.5 }] }],
            negChars: [{ char_caption: 'bad hands', centers: [{ x: 0.5, y: 0.5 }] }],
        });
        const artist = { positive: 'artist:foo', negative: 'worst quality' };
        const plain = buildCopyPromptText(caption, {
            artist,
            includeArtist: false,
        });
        assert.equal(plain, formatPromptText(caption, { includeArtist: false }));
        assert.ok(!plain.includes('画师串'));
        assert.ok(!plain.includes('artist:foo'));

        const withArtist = buildCopyPromptText(caption, {
            artist,
            includeArtist: true,
        });
        assert.equal(withArtist, formatPromptText(caption, { artist, includeArtist: true }));
        assert.match(withArtist, /^画师串\n正面：artist:foo\n负面：worst quality\n\n场景\n正面：garden\n/s);
        assert.ok(!withArtist.includes('artist:foo, garden'));
        assert.ok(!withArtist.includes('image###'));
    });
});
