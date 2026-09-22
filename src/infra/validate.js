/**
 * L1 · 轻量校验器。用户数据失败 → Result.err(DomainError)；调用方写错 → throw。
 */

import { Ok, Err } from './result.js';
import { domainError } from './errors.js';

/**
 * @param {unknown} v
 * @returns {v is string}
 */
export function isNonEmptyString(v) {
    return typeof v === 'string' && v.trim().length > 0;
}

/**
 * @param {unknown} v
 * @returns {v is number}
 */
export function isFiniteNumber(v) {
    return typeof v === 'number' && Number.isFinite(v);
}

/**
 * @param {unknown} v
 * @param {number} min inclusive
 * @param {number} max inclusive
 * @returns {boolean}
 */
export function isIntInRange(v, min, max) {
    return typeof v === 'number'
        && Number.isInteger(v)
        && v >= min
        && v <= max;
}

/**
 * @param {unknown} v
 * @returns {v is Record<string, unknown>}
 */
export function isPlainObject(v) {
    return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * @template T
 * @param {unknown} v
 * @param {(item: unknown) => item is T} pred
 * @returns {v is T[]}
 */
export function isArrayOf(v, pred) {
    return Array.isArray(v) && v.every(pred);
}

/**
 * @param {unknown} v
 * @param {string[]} keys
 * @returns {boolean}
 */
export function hasKeys(v, keys) {
    if (!isPlainObject(v)) {
        return false;
    }
    return keys.every((k) => Object.prototype.hasOwnProperty.call(v, k));
}

/**
 * 编程错误：条件不满足直接 throw（不是用户数据问题）。
 * @param {unknown} cond
 * @param {string} name 参数名
 * @param {string} [msg]
 * @returns {asserts cond}
 */
export function requireArg(cond, name, msg) {
    if (!cond) {
        throw new Error(msg ?? `invalid argument: ${name}`);
    }
}

/**
 * 用户数据校验失败时的便捷构造。
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [context]
 * @returns {{ ok: false, error: import('./errors.js').AppError }}
 */
export function validationErr(code, message, context) {
    return Err(domainError({
        code,
        message,
        hint: '请检查并修正输入后重试',
        context: context ?? {},
    }));
}

/**
 * 包装成功值（供 model 层统一风格）。
 * @template T
 * @param {T} value
 * @returns {{ ok: true, value: T }}
 */
export function validationOk(value) {
    return Ok(value);
}
