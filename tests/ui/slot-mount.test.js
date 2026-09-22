/**
 * W2-G · inflight 表：防重复计费、remount 附着、Abort 清理。
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    _inflightSizeForTest,
    attachSlotInflightPromise,
    beginSlotInflight,
    clearSlotInflight,
    peekSlotInflight,
    resolveSlotInflightAbort,
    resolveSlotInflightError,
    resolveSlotInflightOk,
    slotRuntimeSnapshot,
    watchSlotInflight,
} from '../../src/ui/slot-widget/slot-mount.js';

describe('ui/slot slot-mount inflight', () => {
    beforeEach(() => {
        clearSlotInflight();
    });

    it('begin 幂等：第二次 created=false，不覆盖既有 generating', () => {
        const a = beginSlotInflight(10, 1);
        assert.equal(a.created, true);
        assert.equal(a.entry.status, 'generating');

        const b = beginSlotInflight(10, 1);
        assert.equal(b.created, false);
        assert.equal(b.entry, a.entry);
        assert.equal(_inflightSizeForTest(), 1);
    });

    it('成功 / Abort 清表；失败保留供 remount', () => {
        beginSlotInflight(1, 2);
        resolveSlotInflightOk(1, 2);
        assert.equal(peekSlotInflight(1, 2), null);

        beginSlotInflight(1, 2);
        resolveSlotInflightAbort(1, 2);
        assert.equal(peekSlotInflight(1, 2), null);
        assert.deepEqual(slotRuntimeSnapshot(1, 2), { status: undefined });

        beginSlotInflight(1, 3);
        resolveSlotInflightError(1, 3, { message: '炸了', traceId: 't1' }, 't1');
        const snap = slotRuntimeSnapshot(1, 3);
        assert.equal(snap.status, 'error');
        assert.equal(/** @type {{ message: string }} */ (snap.error).message, '炸了');
        assert.equal(snap.traceId, 't1');
    });

    it('watch 在 clear 后不再收到；unwatch 后不再回调', () => {
        beginSlotInflight(5, 1);
        let hits = 0;
        const unwatch = watchSlotInflight(5, 1, () => {
            hits += 1;
        });
        resolveSlotInflightError(5, 1, { message: 'e' }, null);
        assert.equal(hits, 1);

        unwatch();
        resolveSlotInflightError(5, 1, { message: 'e2' }, null);
        assert.equal(hits, 1);

        resolveSlotInflightOk(5, 1);
        assert.equal(peekSlotInflight(5, 1), null);
    });

    it('attachSlotInflightPromise 挂上 promise 引用', async () => {
        const { entry } = beginSlotInflight(9, 9);
        const p = Promise.resolve({ ok: true });
        attachSlotInflightPromise(9, 9, p);
        assert.equal(entry.promise, p);
        await p;
        resolveSlotInflightOk(9, 9);
    });
});
