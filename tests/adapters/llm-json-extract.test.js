/**
 * W1-C · LLM JSON 容错提取自测（不联网）
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractJson } from '../../src/adapters/llm/json-extract.js';
import { isOk, isErr } from '../../src/infra/result.js';
import { ERROR_CATEGORY } from '../../src/infra/errors.js';

describe('extractJson', () => {
    it('parses plain JSON object', () => {
        const r = extractJson('{"a":1}');
        assert.equal(isOk(r), true);
        assert.deepEqual(r.value, { a: 1 });
    });

    it('strips markdown fence', () => {
        const r = extractJson('```json\n{"keys":["x"]}\n```');
        assert.equal(isOk(r), true);
        assert.deepEqual(r.value, { keys: ['x'] });
    });

    it('extracts balanced object from surrounding prose', () => {
        const r = extractJson('好的，结果如下：\n{"slotid":1,"生成点":"x"}\n请查收');
        assert.equal(isOk(r), true);
        assert.equal(r.value.slotid, 1);
    });

    it('extracts array', () => {
        const r = extractJson('prefix [{"k":"v"}] suffix');
        assert.equal(isOk(r), true);
        assert.deepEqual(r.value, [{ k: 'v' }]);
    });

    it('ContractError keeps rawText', () => {
        const raw = '这不是 JSON，也没有大括号';
        const r = extractJson(raw);
        assert.equal(isErr(r), true);
        assert.equal(r.error.category, ERROR_CATEGORY.CONTRACT);
        assert.equal(r.error.context.rawText, raw);
    });
});
