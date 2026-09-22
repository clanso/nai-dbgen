/**
 * W2-G · 视觉 inflight 表：chatId 作用域、切聊天清理（D36）。不计费防线。
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    _inflightKeysForTest,
    _inflightSizeForTest,
    attachSlotInflightPromise,
    beginSlotInflight,
    clearSlotInflight,
    clearSlotInflightOtherChats,
    peekSlotInflight,
    resolveSlotInflightAbort,
    resolveSlotInflightError,
    resolveSlotInflightOk,
    resolveVisualRuntime,
    slotRuntimeKey,
    slotRuntimeSnapshot,
    watchSlotInflight,
} from '../../src/ui/slot-widget/slot-mount.js';

describe('ui/slot slot-mount visual inflight', () => {
    beforeEach(() => {
        clearSlotInflight();
    });

    it('键带 chatId：同 (messageId,slotId) 不同聊天互不串台', () => {
        assert.equal(slotRuntimeKey('chat-a', 5, 1), 'chat-a:5:1');
        assert.equal(slotRuntimeKey('chat-b', 5, 1), 'chat-b:5:1');

        beginSlotInflight('chat-a', 5, 1);
        beginSlotInflight('chat-b', 5, 1);
        assert.equal(_inflightSizeForTest(), 2);
        assert.ok(peekSlotInflight('chat-a', 5, 1));
        assert.ok(peekSlotInflight('chat-b', 5, 1));
        assert.equal(peekSlotInflight('chat-a', 5, 1), peekSlotInflight('chat-a', 5, 1));
        assert.notEqual(peekSlotInflight('chat-a', 5, 1), peekSlotInflight('chat-b', 5, 1));

        resolveSlotInflightOk('chat-a', 5, 1);
        assert.equal(peekSlotInflight('chat-a', 5, 1), null);
        assert.ok(peekSlotInflight('chat-b', 5, 1));
    });

    it('切 chat 后清理其它聊天的 error / generating 条目', () => {
        beginSlotInflight('chat-a', 1, 1);
        resolveSlotInflightError('chat-a', 1, 2, { message: '旧错' }, 't');
        beginSlotInflight('chat-b', 1, 1);

        const removed = clearSlotInflightOtherChats('chat-b');
        assert.ok(removed >= 2);
        assert.equal(peekSlotInflight('chat-a', 1, 1), null);
        assert.equal(peekSlotInflight('chat-a', 1, 2), null);
        assert.ok(peekSlotInflight('chat-b', 1, 1));
        assert.deepEqual(_inflightKeysForTest(), ['chat-b:1:1']);
    });

    it('resolveVisualRuntime：应用层 busy 优先于本地表', () => {
        resolveSlotInflightError('c', 2, 3, { message: '本地错' }, null);
        const fromApp = resolveVisualRuntime({
            chatId: 'c',
            messageId: 2,
            slotId: 3,
            appRendering: true,
            appPendingWrite: false,
        });
        assert.equal(fromApp.status, 'generating');

        const pending = resolveVisualRuntime({
            chatId: 'c',
            messageId: 2,
            slotId: 3,
            appRendering: false,
            appPendingWrite: true,
        });
        assert.equal(pending.status, 'generating');

        const localErr = resolveVisualRuntime({
            chatId: 'c',
            messageId: 2,
            slotId: 3,
            appRendering: false,
            appPendingWrite: false,
        });
        assert.equal(localErr.status, 'error');
    });

    it('begin 同键附着；成功/Abort 清表', () => {
        const a = beginSlotInflight('c', 10, 1);
        assert.equal(a.created, true);
        const b = beginSlotInflight('c', 10, 1);
        assert.equal(b.created, false);
        assert.equal(b.entry, a.entry);

        resolveSlotInflightOk('c', 10, 1);
        assert.equal(peekSlotInflight('c', 10, 1), null);

        beginSlotInflight('c', 10, 1);
        resolveSlotInflightAbort('c', 10, 1);
        assert.deepEqual(slotRuntimeSnapshot('c', 10, 1), { status: undefined });
    });

    it('watch / attach promise', async () => {
        beginSlotInflight('c', 5, 1);
        let hits = 0;
        const unwatch = watchSlotInflight('c', 5, 1, () => {
            hits += 1;
        });
        resolveSlotInflightError('c', 5, 1, { message: 'e' }, null);
        assert.equal(hits, 1);
        unwatch();
        resolveSlotInflightError('c', 5, 1, { message: 'e2' }, null);
        assert.equal(hits, 1);

        const { entry } = beginSlotInflight('c', 9, 9);
        const p = Promise.resolve({ ok: true });
        attachSlotInflightPromise('c', 9, 9, p);
        assert.equal(entry.promise, p);
        await p;
        resolveSlotInflightOk('c', 9, 9);
    });
});
