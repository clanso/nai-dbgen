import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    extractPreviewRows,
    filterImportPayload,
} from '../../src/ui/common/import-export.js';

describe('ui/common/import-export extractPreviewRows', () => {
    it('accepts top-level array', () => {
        const rows = extractPreviewRows([{ id: '1' }, { id: '2' }]);
        assert.equal(rows.length, 2);
    });

    it('reads common envelope keys', () => {
        assert.equal(extractPreviewRows({ entries: [{ id: 'a' }] }).length, 1);
        assert.equal(extractPreviewRows({ items: [{ id: 'b' }] }).length, 1);
        assert.equal(extractPreviewRows({ tags: [{ id: 'c' }] }).length, 1);
    });

    it('flattens character groups', () => {
        const rows = extractPreviewRows({
            groups: [
                { name: 'G1', characters: [{ id: 'c1', name: 'A' }] },
                { name: 'G2', characters: [{ id: 'c2', name: 'B' }] },
            ],
        });
        assert.equal(rows.length, 2);
        assert.equal(rows[0]._groupName, 'G1');
    });

    it('flattens tag libraries', () => {
        const rows = extractPreviewRows({
            libraries: [
                { name: 'L1', entries: [{ id: 't1', key: 'k' }] },
            ],
        });
        assert.equal(rows.length, 1);
        assert.equal(rows[0]._libraryName, 'L1');
    });

    it('falls back to single root object', () => {
        const rows = extractPreviewRows({ id: 'solo', name: 'x' });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].id, 'solo');
    });

    it('returns empty for nullish / non-object', () => {
        assert.deepEqual(extractPreviewRows(null), []);
        assert.deepEqual(extractPreviewRows('x'), []);
    });
});

describe('ui/common/import-export filterImportPayload (D44)', () => {
    it('filters flat items envelope by checkbox', () => {
        const data = {
            kind: 'artist',
            items: [
                { id: 'a1', name: 'keep' },
                { id: 'a2', name: 'drop' },
                { id: 'a3', name: 'keep2' },
            ],
        };
        const out = filterImportPayload(data, [true, false, true]);
        assert.ok(out && !Array.isArray(out));
        assert.deepEqual(
            /** @type {any} */ (out).items.map((x) => x.id),
            ['a1', 'a3'],
        );
        assert.equal(/** @type {any} */ (out).kind, 'artist');
    });

    it('returns null when all unchecked (must not call importJson with empty pack)', () => {
        assert.equal(
            filterImportPayload({ items: [{ id: 'x' }] }, [false]),
            null,
        );
        assert.equal(filterImportPayload([{ id: 'x' }], [false]), null);
    });

    it('flat character envelope: drops unchecked chars and orphan groups', () => {
        const data = {
            kind: 'character',
            groups: [
                { id: 'g1', name: 'G1' },
                { id: 'g2', name: 'G2' },
            ],
            characters: [
                { id: 'c1', name: 'A', groupId: 'g1' },
                { id: 'c2', name: 'B', groupId: 'g1' },
                { id: 'c3', name: 'C', groupId: 'g2' },
            ],
        };
        // uncheck all of g1 → only c3 / g2 remain
        const out = /** @type {any} */ (filterImportPayload(data, [false, false, true]));
        assert.deepEqual(out.characters.map((c) => c.id), ['c3']);
        assert.deepEqual(out.groups.map((g) => g.id), ['g2']);
    });

    it('nested groups: unchecking all children of a parent omits that parent', () => {
        const data = {
            kind: 'character',
            groups: [
                {
                    id: 'g1',
                    name: 'G1',
                    characters: [
                        { id: 'c1', name: 'A' },
                        { id: 'c2', name: 'B' },
                    ],
                },
                {
                    id: 'g2',
                    name: 'G2',
                    characters: [{ id: 'c3', name: 'C' }],
                },
            ],
        };
        // preview order: c1, c2, c3 — uncheck c1+c2 (= cancel parent G1)
        const out = /** @type {any} */ (filterImportPayload(data, [false, false, true]));
        assert.equal(out.groups.length, 1);
        assert.equal(out.groups[0].id, 'g2');
        assert.deepEqual(out.groups[0].characters.map((c) => c.id), ['c3']);
    });

    it('nested libraries: partial child keep retains parent', () => {
        const data = {
            kind: 'tag',
            libraries: [
                {
                    id: 'l1',
                    name: 'L1',
                    entries: [
                        { id: 't1', key: 'a' },
                        { id: 't2', key: 'b' },
                    ],
                },
            ],
        };
        const out = /** @type {any} */ (filterImportPayload(data, [true, false]));
        assert.equal(out.libraries.length, 1);
        assert.deepEqual(out.libraries[0].entries.map((e) => e.id), ['t1']);
    });

    it('flat tag envelope mirrors character parent pruning', () => {
        const data = {
            kind: 'tag',
            libraries: [
                { id: 'l1', name: 'L1' },
                { id: 'l2', name: 'L2' },
            ],
            entries: [
                { id: 'e1', key: 'a', libraryId: 'l1' },
                { id: 'e2', key: 'b', libraryId: 'l2' },
            ],
        };
        const out = /** @type {any} */ (filterImportPayload(data, [false, true]));
        assert.deepEqual(out.entries.map((e) => e.id), ['e2']);
        assert.deepEqual(out.libraries.map((l) => l.id), ['l2']);
    });
});
