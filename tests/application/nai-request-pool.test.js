import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createNaiRequestPool, selectNaiPoolConfigs } from '../../src/application/nai-request-pool.js';
import { createImageGenService } from '../../src/application/image-gen.service.js';
import { defaultPluginSettings } from '../../src/domain/model/plugin-settings.js';
import { emptyNaiCaption } from '../../src/domain/model/nai-params.js';
const configs = ['a', 'b', 'c'].map((apiKey) => ({ apiKey, baseUrl: 'https://example.test' }));
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

it('image service shares the three-key pool across callers and refuses stale queued work', async () => {
    const used = new Set();
    let active = 0;
    let peak = 0;
    const service = createImageGenService({
        loadSettings: () => ({ ...defaultPluginSettings(), activeNaiConfigId: 'a', naiParallel: true }),
        naiConfigRepo: {
            get: async () => ({ ok: true, value: configs[0] }),
            list: async () => ({ ok: true, value: configs }),
        },
        artistRepo: {}, newTraceId: () => 'test',
        imageGenPort: { generate: async (_, { config }) => {
            used.add(config.apiKey);
            peak = Math.max(peak, ++active);
            await tick();
            active--;
            return { ok: true, value: [] };
        } },
    });
    const request = { caption: emptyNaiCaption(), replaceCharacterKeywords: false, artist: null };
    const results = await Promise.all(Array.from({ length: 6 }, () => service.generate(request)));
    assert.equal(results.every((result) => result.ok), true);
    assert.equal(peak, 3);
    assert.equal(used.size, 3);
    assert.equal((await service.generate({ ...request, shouldStart: () => false })).error.code, 'CHAT_CHANGED');
    service.dispose();
});

it('three credentials run three requests, with at most one request per credential', async () => {
    const pool = createNaiRequestPool();
    const keys = new Set();
    let peak = 0;
    await Promise.all(Array.from({ length: 9 }, () => pool.run(configs, async (config) => {
        assert.equal(keys.has(config.apiKey), false);
        keys.add(config.apiKey);
        peak = Math.max(peak, keys.size);
        await tick();
        keys.delete(config.apiKey);
    }, { parallel: true })));
    assert.equal(peak, 3);
});

it('serial mode limits the shared pool to one request', async () => {
    const pool = createNaiRequestPool();
    let active = 0;
    await Promise.all(configs.map(() => pool.run(configs, async () => {
        assert.equal(++active, 1);
        await tick();
        active--;
    })));
});

it('filters duplicate keys and other endpoints, keeping the active configuration first', () => {
    assert.deepEqual(selectNaiPoolConfigs(configs[0], [
        configs[0], configs[1], { ...configs[2], baseUrl: 'https://other.test' },
        { ...configs[1], apiKey: ' b ' },
    ], true), configs.slice(0, 2));
    assert.deepEqual(selectNaiPoolConfigs(configs[0], configs, false), [configs[0]]);
});

it('queued cancellation never starts an upstream request; errors release the key', async () => {
    const pool = createNaiRequestPool();
    let release;
    const first = pool.run([configs[0]], () => new Promise((r) => { release = r; }), { parallel: true });
    await tick();
    const controller = new AbortController();
    const second = pool.run([configs[0]], () => assert.fail('cancelled request ran'), {
        parallel: true, signal: controller.signal,
    });
    controller.abort();
    assert.equal((await second).ok, false);
    release();
    await first;
    await assert.rejects(pool.run(configs, () => { throw new Error('expected'); }));
    assert.equal(await pool.run(configs, () => 42), 42);
    pool.dispose();
    assert.equal((await pool.run(configs, () => assert.fail())).ok, false);
});
