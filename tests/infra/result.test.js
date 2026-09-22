import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    Ok, Err, isOk, isErr, map, mapErr, andThen, unwrapOr, all, collect,
} from '../../src/infra/result.js';

describe('result', () => {
    it('Ok / Err / isOk / isErr', () => {
        const ok = Ok(1);
        const err = Err('e');
        assert.equal(isOk(ok), true);
        assert.equal(isErr(ok), false);
        assert.equal(isOk(err), false);
        assert.equal(isErr(err), true);
        assert.deepEqual(ok, { ok: true, value: 1 });
        assert.deepEqual(err, { ok: false, error: 'e' });
    });

    it('map maps Ok and passes Err', () => {
        assert.deepEqual(map(Ok(2), (n) => n * 3), Ok(6));
        assert.deepEqual(map(Err('x'), (n) => n * 3), Err('x'));
    });

    it('mapErr maps Err and passes Ok', () => {
        assert.deepEqual(mapErr(Err('x'), (e) => e + '!'), Err('x!'));
        assert.deepEqual(mapErr(Ok(1), (e) => e + '!'), Ok(1));
    });

    it('andThen chains Results', () => {
        const doubleIfPos = (n) => (n > 0 ? Ok(n * 2) : Err('neg'));
        assert.deepEqual(andThen(Ok(3), doubleIfPos), Ok(6));
        assert.deepEqual(andThen(Ok(-1), doubleIfPos), Err('neg'));
        assert.deepEqual(andThen(Err('early'), doubleIfPos), Err('early'));
    });

    it('unwrapOr', () => {
        assert.equal(unwrapOr(Ok(5), 0), 5);
        assert.equal(unwrapOr(Err('e'), 0), 0);
    });

    it('all short-circuits on first Err', () => {
        assert.deepEqual(all([Ok(1), Ok(2)]), Ok([1, 2]));
        const fail = all([Ok(1), Err('boom'), Ok(3)]);
        assert.deepEqual(fail, Err('boom'));
    });

    it('collect gathers values and errors', () => {
        assert.deepEqual(
            collect([Ok(1), Err('a'), Ok(2), Err('b')]),
            { values: [1, 2], errors: ['a', 'b'] },
        );
        assert.deepEqual(collect([]), { values: [], errors: [] });
    });

    it('plain objects are JSON-serializable', () => {
        const roundtrip = JSON.parse(JSON.stringify(Ok({ a: 1 })));
        assert.deepEqual(roundtrip, { ok: true, value: { a: 1 } });
    });
});
