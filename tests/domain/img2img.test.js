import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyImg2Img,
    defaultImg2ImgNoise,
    defaultImg2ImgStrength,
    naiImageBase64,
} from '../../src/domain/nai/img2img.js';
import { attachReferenceImage } from '../../src/domain/llm/reverse-prompt.js';

describe('img2img', () => {
    it('strips a data URL down to base64', () => {
        assert.equal(naiImageBase64('data:image/png;base64,aGVsbG8='), 'aGVsbG8=');
        assert.equal(naiImageBase64(''), '');
    });

    it('uses the desktop strength and noise defaults', () => {
        assert.equal(defaultImg2ImgStrength('nai-diffusion-5-full'), 0.7);
        assert.equal(defaultImg2ImgNoise('nai-diffusion-5-full'), 0);
        assert.equal(defaultImg2ImgStrength('nai-diffusion-4-5-full'), 0.6);
        assert.equal(defaultImg2ImgNoise('nai-diffusion-4-5-full'), 0.1);
    });

    it('writes action, image, strength and noise without touching the prompt', () => {
        const applied = applyImg2Img({
            input: '1girl',
            model: 'nai-diffusion-4-5-full',
            parameters: { width: 832, seed: 3 },
        }, {
            image: 'data:image/png;base64,aGVsbG8=',
            strength: 0.4,
            noise: 0.2,
        });
        assert.equal(applied.ok, true);
        assert.equal(applied.value.action, 'img2img');
        assert.equal(applied.value.model, 'nai-diffusion-4-5-full');
        assert.equal(applied.value.input, '1girl');
        assert.equal(applied.value.parameters.image, 'aGVsbG8=');
        assert.equal(applied.value.parameters.strength, 0.4);
        assert.equal(applied.value.parameters.noise, 0.2);
        assert.equal(applied.value.parameters.width, 832);
        assert.equal(typeof applied.value.parameters.extra_noise_seed, 'number');
    });

    it('rejects a missing image', () => {
        const applied = applyImg2Img({ model: 'nai-diffusion-4-5-full', parameters: {} }, {});
        assert.equal(applied.ok, false);
        assert.equal(applied.error.code, 'IMG2IMG_IMAGE');
    });
});

describe('reverse prompt', () => {
    it('keeps the natural-language user text and attaches the image', () => {
        const messages = attachReferenceImage([
            { role: 'system', content: '按格式写生图提示词' },
            { role: 'user', content: '自然语言：雨夜车站' },
        ], 'data:image/png;base64,aGVsbG8=');
        assert.equal(messages[0].content, '按格式写生图提示词');
        assert.equal(messages[1].content[0].type, 'text');
        assert.match(messages[1].content[0].text, /雨夜车站/);
        assert.equal(messages[1].content[1].type, 'image_url');
        assert.equal(messages[1].content[1].image_url.url, 'data:image/png;base64,aGVsbG8=');
    });

    it('leaves messages unchanged when there is no image', () => {
        const messages = attachReferenceImage([
            { role: 'user', content: '只要文字' },
        ], '');
        assert.equal(messages[0].content, '只要文字');
    });
});
