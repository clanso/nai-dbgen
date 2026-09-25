/**
 * L3 领域层 · 标签 value 书写规则（需求 4.3）。
 * value 不得以「可选的 `- ` + 中文小标题 + 冒号」开头。
 */

import { validationErr, validationOk } from '../../infra/validate.js';
import { parseCompositionKey } from './composition-key.js';

/** 小标题：无 ASCII 字母数字，且含汉字 */
const SUBTITLE_HEAD_RE = /^(?:- )?([^\n:：]+)[:：]/;
const HAS_ASCII_ALNUM = /[A-Za-z0-9]/;
const HAS_CJK = /[\u3400-\u9FFF\uF900-\uFAFF]/;

/**
 * value 是否以违规的中文小标题开头。
 * @param {unknown} value
 * @returns {boolean}
 */
export function hasForbiddenValueSubtitle(value) {
    if (typeof value !== 'string') {
        return false;
    }
    const s = value.trimStart();
    if (!s) {
        return false;
    }
    // 方括号 / 花括号开头的占位或分组，不按小标题处理
    if (s.startsWith('[') || s.startsWith('{') || s.startsWith('（') || s.startsWith('(')) {
        return false;
    }
    const m = SUBTITLE_HEAD_RE.exec(s);
    if (!m) {
        return false;
    }
    const title = m[1].trim();
    if (!title) {
        return false;
    }
    if (HAS_ASCII_ALNUM.test(title)) {
        return false;
    }
    if (!HAS_CJK.test(title)) {
        return false;
    }
    return true;
}

/**
 * @param {unknown} value
 * @returns {{ ok: true, value: string }
 *   | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function validateTagValueWriting(value) {
    if (typeof value !== 'string') {
        return validationErr('TAG_VALUE_TYPE', '标签内容必须是文本');
    }
    if (hasForbiddenValueSubtitle(value)) {
        return validationErr(
            'TAG_VALUE_SUBTITLE',
            '标签内容不要用「名称：」这类中文小标题开头（名称已在 key 里）',
        );
    }
    return validationOk(value);
}

/**
 * 按库类型校验条目 key / value 书写规则（保存与导入共用）。
 * @param {'composition'|'feature'|'constant'|string} kind
 * @param {unknown} key
 * @param {unknown} value
 * @returns {{ ok: true, value: { key: string, value: string } }
 *   | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function validateTagEntryWriting(kind, key, value) {
    const valueCheck = validateTagValueWriting(value);
    if (!valueCheck.ok) {
        return valueCheck;
    }
    if (kind === 'composition') {
        const parsed = parseCompositionKey(key);
        if (!parsed.ok) {
            return parsed;
        }
        return validationOk({
            key: typeof key === 'string' ? key.trim() : String(key ?? ''),
            value: valueCheck.value,
        });
    }
    if (typeof key !== 'string' || !key.trim()) {
        return validationErr(
            'TAG_ENTRY_KEY',
            kind === 'feature' ? '请填写触发关键字' : '请填写条目名',
        );
    }
    return validationOk({ key: key.trim(), value: valueCheck.value });
}
