import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createEventBus } from '../../src/infra/event-bus.js';
import { setLogLevel } from '../../src/infra/logger.js';

describe('event-bus', () => {
    it('on / emit / unsubscribe', () => {
        const bus = createEventBus();
        /** @type {unknown[]} */
        const seen = [];
        const unsub = bus.on('ping', (p) => seen.push(p));
        bus.emit('ping', 1);
        unsub();
        bus.emit('ping', 2);
        assert.deepEqual(seen, [1]);
    });

    it('once fires only once', () => {
        const bus = createEventBus();
        let count = 0;
        bus.once('x', () => {
            count += 1;
        });
        bus.emit('x');
        bus.emit('x');
        assert.equal(count, 1);
    });

    it('off removes specific handler', () => {
        const bus = createEventBus();
        let a = 0;
        let b = 0;
        const fa = () => {
            a += 1;
        };
        const fb = () => {
            b += 1;
        };
        bus.on('t', fa);
        bus.on('t', fb);
        bus.off('t', fa);
        bus.emit('t');
        assert.equal(a, 0);
        assert.equal(b, 1);
    });

    it('subscriber throw does not stop others', () => {
        setLogLevel('error');
        const bus = createEventBus();
        let second = false;
        bus.on('e', () => {
            throw new Error('boom');
        });
        bus.on('e', () => {
            second = true;
        });
        assert.doesNotThrow(() => bus.emit('e'));
        assert.equal(second, true);
    });

    it('clear removes all', () => {
        const bus = createEventBus();
        let n = 0;
        bus.on('z', () => {
            n += 1;
        });
        bus.clear();
        bus.emit('z');
        assert.equal(n, 0);
    });
});
