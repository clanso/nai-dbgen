import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../../src/ui/common/store.js';

describe('ui/common/store', () => {
    it('get returns initial state', () => {
        const store = createStore({ n: 1 });
        assert.deepEqual(store.get(), { n: 1 });
    });

    it('set replaces and notifies subscribers', () => {
        const store = createStore(0);
        /** @type {number[]} */
        const seen = [];
        store.subscribe((n) => seen.push(n));
        store.set(1);
        store.set((prev) => prev + 1);
        assert.deepEqual(seen, [1, 2]);
        assert.equal(store.get(), 2);
    });

    it('set with same reference is a no-op', () => {
        const value = { x: 1 };
        const store = createStore(value);
        let calls = 0;
        store.subscribe(() => {
            calls += 1;
        });
        store.set(value);
        assert.equal(calls, 0);
    });

    it('unsubscribe is idempotent', () => {
        const store = createStore(0);
        let calls = 0;
        const unsub = store.subscribe(() => {
            calls += 1;
        });
        store.set(1);
        unsub();
        unsub();
        unsub();
        store.set(2);
        assert.equal(calls, 1);
        assert.equal(store.get(), 2);
    });

    it('subscriber throw does not break others', () => {
        const store = createStore(0);
        let second = false;
        store.subscribe(() => {
            throw new Error('boom');
        });
        store.subscribe(() => {
            second = true;
        });
        assert.doesNotThrow(() => store.set(1));
        assert.equal(second, true);
    });

    it('subscribe non-function returns noop unsub', () => {
        const store = createStore(0);
        const unsub = store.subscribe(/** @type {any} */ (null));
        assert.equal(typeof unsub, 'function');
        assert.doesNotThrow(() => unsub());
    });
});
