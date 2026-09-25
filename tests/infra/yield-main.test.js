import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { yieldMain } from '../../src/infra/yield-main.js';

describe('infra/yield-main', () => {
    it('resolves via MessageChannel when document.hidden and setTimeout never fires', async () => {
        assert.equal(typeof MessageChannel, 'function');
        const realSetTimeout = globalThis.setTimeout;
        const prevDoc = globalThis.document;
        /** @type {Function[]} */
        const stalled = [];
        globalThis.document = { hidden: true };
        globalThis.setTimeout = (fn) => {
            stalled.push(fn);
            return 0;
        };
        try {
            await Promise.race([
                yieldMain(),
                new Promise((_, reject) => {
                    realSetTimeout(() => reject(new Error('yieldMain timed out without MessageChannel')), 500);
                }),
            ]);
            assert.equal(stalled.length, 0, 'hidden path must not fall back to setTimeout');
        } finally {
            globalThis.setTimeout = realSetTimeout;
            if (prevDoc === undefined) delete globalThis.document;
            else globalThis.document = prevDoc;
        }
    });

    it('uses setTimeout when document is visible (setTimeout stub records a call)', async () => {
        const realSetTimeout = globalThis.setTimeout;
        const prevDoc = globalThis.document;
        let scheduled = 0;
        globalThis.document = { hidden: false };
        globalThis.setTimeout = (fn, ms) => {
            scheduled += 1;
            return realSetTimeout(fn, ms);
        };
        try {
            await yieldMain();
            assert.equal(scheduled, 1);
        } finally {
            globalThis.setTimeout = realSetTimeout;
            if (prevDoc === undefined) delete globalThis.document;
            else globalThis.document = prevDoc;
        }
    });

    it('resolves in Node without document', async () => {
        const prevDoc = globalThis.document;
        delete globalThis.document;
        try {
            await yieldMain();
        } finally {
            if (prevDoc !== undefined) globalThis.document = prevDoc;
        }
    });
});
