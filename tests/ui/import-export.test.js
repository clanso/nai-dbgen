import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractPreviewRows } from '../../src/ui/common/import-export.js';

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
