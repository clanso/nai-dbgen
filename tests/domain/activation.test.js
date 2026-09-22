import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { activateCharacters } from '../../src/domain/matching/activation.js';

const GLOBALS = { caseSensitive: false, matchWholeWords: false };

function group(id, order, active) {
    return { id, name: id, active, order, schemaVersion: 1, createdAt: '', updatedAt: '' };
}

function character(id, groupId, keywords) {
    return {
        id,
        groupId,
        name: id,
        keywords,
        fixedFeatures: 'dna',
        variableFeatures: [],
        matchOverrides: null,
        schemaVersion: 1,
        createdAt: '',
        updatedAt: '',
    };
}

describe('activation', () => {
    it('filters inactive groups before matching', () => {
        const groups = [group('g1', 0, true), group('g2', 1, false)];
        const chars = [
            character('a', 'g1', ['Alice']),
            character('b', 'g2', ['Alice']),
        ];
        const hit = activateCharacters(groups, chars, 'Alice arrived', GLOBALS);
        assert.deepEqual(hit.map((c) => c.id), ['a']);
    });

    it('orders by group.order then character array order within group', () => {
        const groups = [group('g2', 10, true), group('g1', 1, true)];
        const chars = [
            character('late', 'g2', ['x']),
            character('first', 'g1', ['x']),
            character('second', 'g1', ['x']),
        ];
        const hit = activateCharacters(groups, chars, 'x marks', GLOBALS);
        assert.deepEqual(hit.map((c) => c.id), ['first', 'second', 'late']);
    });

    it('returns empty for bad inputs / no hits', () => {
        assert.deepEqual(activateCharacters(null, [], 'a', GLOBALS), []);
        assert.deepEqual(
            activateCharacters([group('g', 0, true)], [character('c', 'g', ['zzz'])], 'hello', GLOBALS),
            [],
        );
    });
});
