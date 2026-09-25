import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    clearParseFailures,
    listParseFailures,
    recordParseFailure,
} from '../../src/application/parse-debug-log.js';

describe('parse debug log', () => {
    beforeEach(() => {
        clearParseFailures();
    });

    it('keeps the text from the moment of the failure', () => {
        let source = 'slotid: 2\nscene: a';
        recordParseFailure({
            stage: '生图',
            code: 'SLOT_PLAN_EMPTY',
            message: '解析失败',
            rawText: source,
        });
        source = 'changed later';
        const rows = listParseFailures();
        assert.equal(rows.length, 1);
        assert.equal(rows[0].stage, '生图');
        assert.equal(rows[0].rawText, 'slotid: 2\nscene: a');
        rows[0].rawText = 'ui mutated';
        assert.equal(listParseFailures()[0].rawText, 'slotid: 2\nscene: a');
    });
});
