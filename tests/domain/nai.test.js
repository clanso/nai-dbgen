import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { prefixArtist, prefixCaptionPart } from '../../src/domain/nai/artist-prefix.js';
import {
    substituteCharacterKeywords,
    substituteKeywordsInText,
} from '../../src/domain/nai/keyword-substitution.js';
import { assembleNaiPayload } from '../../src/domain/nai/payload-assembler.js';
import { officialQualityTags, officialUndesiredContent } from '../../src/domain/nai/param-options.js';
import { defaultNaiParams, emptyNaiCaption, FIXED_STRUCTURE } from '../../src/domain/model/nai-params.js';

const GLOBALS = { caseSensitive: false, matchWholeWords: false };

function caption(pos, neg = '', posChars = [], negChars = []) {
    return {
        v4_prompt: { caption: { base_caption: pos, char_captions: posChars } },
        v4_negative_prompt: { caption: { base_caption: neg, char_captions: negChars } },
    };
}

describe('artist-prefix', () => {
    it('prefixCaptionPart joins with comma-space; empty base = artist only', () => {
        assert.equal(prefixCaptionPart('scene', 'artist'), 'artist, scene');
        assert.equal(prefixCaptionPart('', 'artist'), 'artist');
        assert.equal(prefixCaptionPart('scene', ''), 'scene');
    });

    it('prefixArtist leaves char_captions untouched; null artist no-op', () => {
        const chars = [{ char_caption: 'girl', centers: [{ x: 0.2, y: 0.3 }] }];
        const src = caption('scene', 'uc', chars, [{ char_caption: 'bad' }]);
        const out = prefixArtist(src, { positivePrompt: 'A', negativePrompt: 'B' });
        assert.equal(out.v4_prompt.caption.base_caption, 'A, scene');
        assert.equal(out.v4_negative_prompt.caption.base_caption, 'B, uc');
        assert.deepEqual(out.v4_prompt.caption.char_captions, chars);
        assert.notEqual(out, src);
        assert.deepEqual(prefixArtist(src, null), caption('scene', 'uc', chars, [{ char_caption: 'bad' }]));
    });
});

describe('keyword-substitution', () => {
    const groups = [{ id: 'g', active: true, name: 'g', order: 0 }];
    const characters = [
        {
            id: 'c1',
            groupId: 'g',
            name: '张三',
            keywords: ['张三'],
            fixedFeatures: '黑发, 红瞳',
            variableFeatures: [{ name: '衣', prompt: '校服' }],
            matchOverrides: null,
        },
    ];

    it('replaces keyword with fixed features only; no second pass', () => {
        const text = '(其他,张三,其他)';
        const out = substituteKeywordsInText(text, characters, GLOBALS);
        assert.equal(out, '(其他,黑发, 红瞳,其他)');
        // 固定特征含「张三」也不会再换（单次区间扫描）
        const nested = substituteKeywordsInText('张三', [{
            ...characters[0],
            fixedFeatures: '前张三后',
        }], GLOBALS);
        assert.equal(nested, '前张三后');
    });

    it('inactive groups excluded; char_captions also substituted', () => {
        const cap = caption('张三', '张三', [{ char_caption: '张三 stand' }]);
        const out = substituteCharacterKeywords(
            cap,
            [{ id: 'g', active: false }],
            characters,
            GLOBALS,
        );
        assert.equal(out.v4_prompt.caption.base_caption, '张三');
        const out2 = substituteCharacterKeywords(cap, groups, characters, GLOBALS);
        assert.equal(out2.v4_prompt.caption.base_caption, '黑发, 红瞳');
        assert.equal(out2.v4_prompt.caption.char_captions[0].char_caption, '黑发, 红瞳 stand');
    });
});

describe('assembleNaiPayload', () => {
    it('requires explicit boolean replaceCharacterKeywords', () => {
        assert.throws(() => assembleNaiPayload({
            caption: emptyNaiCaption(),
            params: defaultNaiParams(),
            artist: null,
        }));
    });

    it('order: replace → artist → FIXED_STRUCTURE → input/negative', () => {
        const params = defaultNaiParams();
        const artist = { positivePrompt: 'art+', negativePrompt: 'art-', id: 'a', name: 'a' };
        const result = assembleNaiPayload({
            caption: caption('张三 scene', 'uc'),
            params,
            artist,
            replaceCharacterKeywords: true,
            groups: [{ id: 'g', active: true }],
            characters: [{
                id: 'c',
                groupId: 'g',
                keywords: ['张三'],
                fixedFeatures: '黑发',
                variableFeatures: [],
                matchOverrides: null,
            }],
            matchGlobals: GLOBALS,
        });

        const quality = officialQualityTags(true);
        const uc = officialUndesiredContent(params.model, params.ucPreset);
        assert.equal(result.input, `art+, 黑发 scene, ${quality}`);
        assert.equal(result.negative_prompt, `${uc}, art-, uc`);
        assert.equal(result.negative_prompt.startsWith('nsfw'), false);
        assert.equal(result.parameters.v4_prompt.caption.base_caption, result.input);
        assert.equal(result.parameters.v4_negative_prompt.caption.base_caption, result.negative_prompt);
        assert.deepEqual(
            {
                use_coords: result.parameters.v4_prompt.use_coords,
                use_order: result.parameters.v4_prompt.use_order,
            },
            { use_coords: false, use_order: true },
        );
        assert.deepEqual(
            { legacy_uc: result.parameters.v4_negative_prompt.legacy_uc },
            FIXED_STRUCTURE.v4_negative_prompt,
        );
        assert.equal('use_coords' in result.parameters.v4_negative_prompt, false);
        assert.equal(result.parameters.use_coords, false);
        // 4.5 默认模型不带 sm
        assert.equal('sm' in result.parameters, false);
        assert.equal(result.parameters.skip_cfg_above_sigma, null);
        assert.equal(result.parameters.qualityToggle, true);
    });

    it('seed -1 becomes a new uint32; a fixed seed is kept', () => {
        const random = assembleNaiPayload({
            caption: emptyNaiCaption(),
            params: { ...defaultNaiParams(), seed: -1 },
            artist: null,
            replaceCharacterKeywords: false,
        });
        const again = assembleNaiPayload({
            caption: emptyNaiCaption(),
            params: { ...defaultNaiParams(), seed: -1 },
            artist: null,
            replaceCharacterKeywords: false,
        });
        assert.equal(Number.isInteger(random.parameters.seed), true);
        assert.ok(random.parameters.seed >= 0 && random.parameters.seed <= 4294967295);
        assert.equal('seedRandom' in random.parameters, false);
        assert.notEqual(random.parameters.seed, again.parameters.seed);
        const fixed = assembleNaiPayload({
            caption: emptyNaiCaption(),
            params: { ...defaultNaiParams(), seed: 42 },
            artist: null,
            replaceCharacterKeywords: false,
        });
        assert.equal(fixed.parameters.seed, 42);
    });

    it('replaceCharacterKeywords=false leaves keywords; overrides merge', () => {
        const result = assembleNaiPayload({
            caption: caption('张三', ''),
            params: defaultNaiParams(),
            artist: null,
            replaceCharacterKeywords: false,
            groups: [{ id: 'g', active: true }],
            characters: [{
                id: 'c',
                groupId: 'g',
                keywords: ['张三'],
                fixedFeatures: '黑发',
                variableFeatures: [],
                matchOverrides: null,
            }],
            paramOverrides: { steps: 20, custom_field: 1 },
        });
        assert.equal(result.input, `张三, ${officialQualityTags(true)}`);
        assert.equal(result.parameters.steps, 20);
        assert.equal(result.parameters.custom_field, 1);
    });

    it('empty char_captions stay empty arrays', () => {
        const result = assembleNaiPayload({
            caption: emptyNaiCaption(),
            params: defaultNaiParams(),
            artist: null,
            replaceCharacterKeywords: false,
        });
        assert.deepEqual(result.parameters.v4_prompt.caption.char_captions, []);
        assert.deepEqual(result.parameters.v4_negative_prompt.caption.char_captions, []);
    });
});
