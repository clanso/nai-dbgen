import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    clearParseFailures,
    listLatestGenerations,
    listParseFailures,
    recordLatestGeneration,
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
        assert.equal(listLatestGenerations()[0].stage, '生图');
        assert.equal(listLatestGenerations()[0].ok, false);
        assert.equal(listLatestGenerations()[0].rawText, 'slotid: 2\nscene: a');
    });

    it('keeps the latest recall and imagegen text even when they succeed', () => {
        recordLatestGeneration({ stage: '召回', ok: true, message: '已生成', rawText: 'first recall' });
        recordLatestGeneration({ stage: '召回', ok: true, message: '已生成', rawText: 'second recall' });
        recordLatestGeneration({ stage: '生图', ok: true, message: '已生成', rawText: 'image one' });
        const rows = listLatestGenerations();
        assert.deepEqual(rows.map((row) => row.stage), ['召回', '生图']);
        assert.equal(rows[0].rawText, 'second recall');
        assert.equal(rows[0].ok, true);
        assert.equal(rows[1].rawText, 'image one');
        assert.equal(listParseFailures().length, 0);
        rows[0].rawText = 'ui mutated';
        assert.equal(listLatestGenerations()[0].rawText, 'second recall');
    });
});
