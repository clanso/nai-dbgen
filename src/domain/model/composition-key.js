/**
 * L3 领域层 · 构图库 key 解析 / 拼接（需求 4.3 书写规则）。
 * 格式：`分类：名称`（不含全角括号触发词）。
 */

import { validationErr, validationOk } from '../../infra/validate.js';

const SEP = '：';
const HINT = '应为「分类：名称」';

/**
 * @typedef {object} CompositionKeyFields
 * @property {string} category
 * @property {string} name
 */

/**
 * @param {string} detail
 * @returns {{ ok: false, error: import('../../infra/errors.js').AppError }}
 */
function formatErr(detail) {
    return validationErr('COMPOSITION_KEY_FORMAT', `构图 key 格式不对：${detail}`);
}

/**
 * 解析构图 key。
 * @param {unknown} raw
 * @returns {{ ok: true, value: CompositionKeyFields }
 *   | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function parseCompositionKey(raw) {
    if (typeof raw !== 'string') {
        return formatErr(`缺少分类（${HINT}）`);
    }
    const key = raw.trim();
    if (!key) {
        return formatErr(`缺少分类（${HINT}）`);
    }
    if (key.includes('（') || key.includes('）')) {
        return formatErr(`不能含全角括号（${HINT}）`);
    }
    const sepIdx = key.indexOf(SEP);
    if (sepIdx < 0) {
        return formatErr(`缺少分类（${HINT}）`);
    }
    const category = key.slice(0, sepIdx).trim();
    const name = key.slice(sepIdx + SEP.length).trim();
    if (!category) {
        return formatErr(`缺少分类（${HINT}）`);
    }
    if (category.includes(SEP)) {
        return formatErr('分类里不能再有「：」');
    }
    if (!name) {
        return formatErr(`缺少名称（${HINT}）`);
    }
    return validationOk({ category, name });
}

/**
 * 由分栏字段拼回构图 key。
 * @param {unknown} fields
 * @returns {{ ok: true, value: string }
 *   | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function composeCompositionKey(fields) {
    if (fields == null || typeof fields !== 'object') {
        return formatErr(`缺少分类（${HINT}）`);
    }
    const category = String(/** @type {{ category?: unknown }} */ (fields).category ?? '').trim();
    const name = String(/** @type {{ name?: unknown }} */ (fields).name ?? '').trim();

    if (!category) {
        return formatErr(`缺少分类（${HINT}）`);
    }
    if (category.includes(SEP)) {
        return formatErr('分类里不能再有「：」');
    }
    if (!name) {
        return formatErr(`缺少名称（${HINT}）`);
    }
    if (category.includes('（') || category.includes('）')
        || name.includes('（') || name.includes('）')) {
        return formatErr(`不能含全角括号（${HINT}）`);
    }

    return validationOk(`${category}${SEP}${name}`);
}
