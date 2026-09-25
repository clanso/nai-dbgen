/**
 * L3 领域层 · LLM「尺寸」字段解析（需求步骤 5：`"宽x高"`）。
 * 仅校验格式；宽高是否合 4.13（64 倍数、模型上限）由 mergeNaiParamsForGenerate 按显式参数处理。
 */

import { validationErr, validationOk } from '../../infra/validate.js';

/** 数字 x 数字（允许两侧空白；x / X / ×） */
const SIZE_SPEC_RE = /^(\d+)\s*[xX×]\s*(\d+)$/;

/**
 * @param {unknown} raw
 * @returns {{ ok: true, value: { width: number, height: number, spec: string } }
 *   | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function parseSizeSpec(raw) {
    if (typeof raw !== 'string') {
        return validationErr('SIZE_SPEC_FORMAT', '尺寸格式无效，须为「宽x高」如 832x1216');
    }
    const trimmed = raw.trim();
    if (!trimmed) {
        return validationErr('SIZE_SPEC_FORMAT', '尺寸格式无效，须为「宽x高」如 832x1216');
    }
    const m = SIZE_SPEC_RE.exec(trimmed);
    if (!m) {
        return validationErr('SIZE_SPEC_FORMAT', '尺寸格式无效，须为「宽x高」如 832x1216');
    }
    const width = Number(m[1]);
    const height = Number(m[2]);
    return validationOk({
        width,
        height,
        spec: `${width}x${height}`,
    });
}
