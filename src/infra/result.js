/**
 * L1 · Result 判别联合。跨层错误传递，不用异常。
 * 形状为普通对象，可安全结构化克隆 / JSON 化。
 */

/**
 * @template T
 * @param {T} value
 * @returns {{ ok: true, value: T }}
 */
export function Ok(value) {
    return { ok: true, value };
}

/**
 * @template E
 * @param {E} error
 * @returns {{ ok: false, error: E }}
 */
export function Err(error) {
    return { ok: false, error };
}

/**
 * @template T, E
 * @param {{ ok: boolean }} r
 * @returns {r is { ok: true, value: T }}
 */
export function isOk(r) {
    return r != null && r.ok === true;
}

/**
 * @template T, E
 * @param {{ ok: boolean }} r
 * @returns {r is { ok: false, error: E }}
 */
export function isErr(r) {
    return r != null && r.ok === false;
}

/**
 * Ok 时映射 value，Err 原样透传。
 * @template T, U, E
 * @param {{ ok: true, value: T } | { ok: false, error: E }} r
 * @param {(value: T) => U} fn
 * @returns {{ ok: true, value: U } | { ok: false, error: E }}
 */
export function map(r, fn) {
    if (isOk(r)) {
        return Ok(fn(r.value));
    }
    return r;
}

/**
 * Err 时映射 error，Ok 原样透传。
 * @template T, E, F
 * @param {{ ok: true, value: T } | { ok: false, error: E }} r
 * @param {(error: E) => F} fn
 * @returns {{ ok: true, value: T } | { ok: false, error: F }}
 */
export function mapErr(r, fn) {
    if (isErr(r)) {
        return Err(fn(r.error));
    }
    return r;
}

/**
 * Ok 时把 fn 返回的 Result 接上；Err 原样透传。用于串联。
 * @template T, U, E
 * @param {{ ok: true, value: T } | { ok: false, error: E }} r
 * @param {(value: T) => { ok: true, value: U } | { ok: false, error: E }} fn
 * @returns {{ ok: true, value: U } | { ok: false, error: E }}
 */
export function andThen(r, fn) {
    if (isOk(r)) {
        return fn(r.value);
    }
    return r;
}

/**
 * Ok 取 value，Err 返回 fallback。
 * @template T, E
 * @param {{ ok: true, value: T } | { ok: false, error: E }} r
 * @param {T} fallback
 * @returns {T}
 */
export function unwrapOr(r, fallback) {
    if (isOk(r)) {
        return r.value;
    }
    return fallback;
}

/**
 * Result&lt;T&gt;[] → Result&lt;T[]&gt;。遇第一个 Err 短路（传输失败就中止）。
 * @template T, E
 * @param {Array<{ ok: true, value: T } | { ok: false, error: E }>} results
 * @returns {{ ok: true, value: T[] } | { ok: false, error: E }}
 */
export function all(results) {
    /** @type {T[]} */
    const values = [];
    for (const r of results) {
        if (isErr(r)) {
            return r;
        }
        values.push(r.value);
    }
    return Ok(values);
}

/**
 * Result&lt;T&gt;[] → { values, errors }。部分失败仍继续（取不到就降级）。
 * @template T, E
 * @param {Array<{ ok: true, value: T } | { ok: false, error: E }>} results
 * @returns {{ values: T[], errors: E[] }}
 */
export function collect(results) {
    /** @type {T[]} */
    const values = [];
    /** @type {E[]} */
    const errors = [];
    for (const r of results) {
        if (isOk(r)) {
            values.push(r.value);
        } else {
            errors.push(r.error);
        }
    }
    return { values, errors };
}
