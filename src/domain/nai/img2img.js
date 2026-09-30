/**
 * NovelAI 图生图。字段对齐桌面端：action=img2img，parameters.image 为去掉 data: 前缀的 base64，
 * strength / noise / extra_noise_seed。原图不经过语言模型。
 */

import { Ok, Err } from '../../infra/result.js';
import { domainError } from '../../infra/errors.js';
import { classifyNaiModel } from './param-options.js';

/**
 * 桌面端默认：V5 强度 0.7、噪声 0；其余强度 0.6、噪声 0.1。
 * @param {unknown} model
 * @returns {number}
 */
export function defaultImg2ImgStrength(model) {
    return classifyNaiModel(String(model || '')) === 'v5' ? 0.7 : 0.6;
}

/**
 * @param {unknown} model
 * @returns {number}
 */
export function defaultImg2ImgNoise(model) {
    return classifyNaiModel(String(model || '')) === 'v5' ? 0 : 0.1;
}

/**
 * @param {unknown} raw data URL 或纯 base64
 * @returns {string}
 */
export function naiImageBase64(raw) {
    const text = String(raw ?? '').trim();
    const comma = text.indexOf(',');
    const body = text.startsWith('data:') && comma >= 0 ? text.slice(comma + 1) : text;
    const compact = body.replace(/\s+/g, '');
    if (!compact || !/^[A-Za-z0-9+/=]+$/.test(compact)) {
        return '';
    }
    return compact;
}

/**
 * @param {number} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clamp(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, n));
}

/**
 * @returns {number}
 */
function randomNoiseSeed() {
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const buf = new Uint32Array(1);
        crypto.getRandomValues(buf);
        return buf[0];
    }
    return Math.floor(Math.random() * 0x100000000);
}

/**
 * @param {import('../model/nai-params.js').NaiRequest} request
 * @param {{ image?: unknown, strength?: unknown, noise?: unknown }} spec
 * @returns {import('../../infra/result.js').Ok<import('../model/nai-params.js').NaiRequest>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>}
 */
export function applyImg2Img(request, spec) {
    const image = naiImageBase64(spec?.image);
    if (!image) {
        return Err(domainError({
            code: 'IMG2IMG_IMAGE',
            message: '图生图需要一张图片',
            hint: '请重新选择 png、jpg 或 webp',
        }));
    }
    const sourceModel = String(request?.model || '');
    const parameters = {
        ...(request?.parameters && typeof request.parameters === 'object' ? request.parameters : {}),
        image,
        strength: clamp(spec?.strength, 0.01, 0.99, defaultImg2ImgStrength(sourceModel)),
        noise: clamp(spec?.noise, 0, 1, defaultImg2ImgNoise(sourceModel)),
        extra_noise_seed: randomNoiseSeed(),
    };
    return Ok({
        ...request,
        model: sourceModel,
        action: 'img2img',
        parameters,
    });
}
