import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    isNonEmptyString,
    isFiniteNumber,
    isIntInRange,
    isPlainObject,
    isArrayOf,
    hasKeys,
    requireArg,
    validationErr,
    validationOk,
} from '../../src/infra/validate.js';
import { isOk, isErr } from '../../src/infra/result.js';
import { ERROR_CATEGORY } from '../../src/infra/errors.js';

describe('validate', () => {
    it('isNonEmptyString', () => {
        assert.equal(isNonEmptyString('a'), true);
        assert.equal(isNonEmptyString('  '), false);
        assert.equal(isNonEmptyString(''), false);
        assert.equal(isNonEmptyString(1), false);
    });

    it('isFiniteNumber / isIntInRange', () => {
        assert.equal(isFiniteNumber(1.5), true);
        assert.equal(isFiniteNumber(Infinity), false);
        assert.equal(isFiniteNumber(NaN), false);
        assert.equal(isIntInRange(3, 1, 5), true);
        assert.equal(isIntInRange(3.1, 1, 5), false);
        assert.equal(isIntInRange(0, 1, 5), false);
    });

    it('isPlainObject / isArrayOf / hasKeys', () => {
        assert.equal(isPlainObject({ a: 1 }), true);
        assert.equal(isPlainObject([]), false);
        assert.equal(isPlainObject(null), false);
        assert.equal(isArrayOf([1, 2], (x) => typeof x === 'number'), true);
        assert.equal(isArrayOf([1, 'x'], (x) => typeof x === 'number'), false);
        assert.equal(hasKeys({ a: 1, b: 2 }, ['a', 'b']), true);
        assert.equal(hasKeys({ a: 1 }, ['a', 'b']), false);
    });

    it('requireArg throws on programming errors', () => {
        assert.throws(() => requireArg(false, 'foo'), /invalid argument: foo/);
        assert.doesNotThrow(() => requireArg(true, 'foo'));
    });

    it('validationErr returns DomainError Result', () => {
        const r = validationErr('BAD', '数据不合法', { field: 'name' });
        assert.equal(isErr(r), true);
        assert.equal(r.error.category, ERROR_CATEGORY.DOMAIN);
        assert.equal(r.error.code, 'BAD');
    });

    it('validationOk wraps value', () => {
        const r = validationOk({ id: '1' });
        assert.equal(isOk(r), true);
        assert.deepEqual(r.value, { id: '1' });
    });
});
