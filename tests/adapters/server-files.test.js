/**
 * server-files 单测（fake fetch）：404→Ok(null)、500→Err、坏 JSON→Err、
 * 中文往返、非法名不发请求、同名写串行。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    SERVER_FILE_PREFIX,
    isValidServerFileName,
    createServerFiles,
    utf8ToBase64,
    base64ToUtf8,
    serverFilePath,
} from '../../src/adapters/storage/server-files.js';
import { isOk, isErr } from '../../src/infra/result.js';

function headers() {
    return { 'Content-Type': 'application/json', 'X-CSRF-Token': 'test' };
}

describe('server-files · name validation', () => {
    it('accepts prefixed alphanumeric names', () => {
        assert.equal(isValidServerFileName(`${SERVER_FILE_PREFIX}characters.json`), true);
        assert.equal(isValidServerFileName(`${SERVER_FILE_PREFIX}artist-preview_a__deadbeef.png`), true);
    });

    it('rejects missing prefix / illegal chars / empty', () => {
        assert.equal(isValidServerFileName('characters.json'), false);
        assert.equal(isValidServerFileName(`${SERVER_FILE_PREFIX}a b.json`), false);
        assert.equal(isValidServerFileName(`${SERVER_FILE_PREFIX}中文.json`), false);
        assert.equal(isValidServerFileName(''), false);
        assert.equal(isValidServerFileName(null), false);
    });
});

describe('server-files · utf8 base64', () => {
    it('round-trips Chinese', () => {
        const s = '{"name":"角色甲","note":"测试"}';
        assert.equal(base64ToUtf8(utf8ToBase64(s)), s);
    });
});

describe('server-files · createServerFiles', () => {
    it('readJson: 404 → Ok(null)', async () => {
        /** @type {string[]} */
        const urls = [];
        const sf = createServerFiles({
            getRequestHeaders: headers,
            fetch: async (url) => {
                urls.push(String(url));
                return {
                    ok: false,
                    status: 404,
                    text: async () => 'missing',
                };
            },
        });
        const r = await sf.readJson(`${SERVER_FILE_PREFIX}characters.json`);
        assert.equal(isOk(r), true);
        assert.equal(r.value, null);
        assert.match(urls[0], /\/user\/files\/nai-dbgen_characters\.json\?t=/);
        assert.match(urls[0], /cache|t=/);
    });

    it('readJson: 500 → Err（不当成空）', async () => {
        const sf = createServerFiles({
            getRequestHeaders: headers,
            fetch: async () => ({
                ok: false,
                status: 500,
                text: async () => 'boom',
            }),
        });
        const r = await sf.readJson(`${SERVER_FILE_PREFIX}characters.json`);
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'SERVER_FILE_READ_FAILED');
    });

    it('readJson: bad JSON → Err', async () => {
        const sf = createServerFiles({
            getRequestHeaders: headers,
            fetch: async () => ({
                ok: true,
                status: 200,
                text: async () => '{not-json',
            }),
        });
        const r = await sf.readJson(`${SERVER_FILE_PREFIX}presets.json`);
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'SERVER_FILE_JSON_INVALID');
    });

    it('writeJson / readJson Chinese round-trip via fake store', async () => {
        /** @type {Map<string, string>} */
        const disk = new Map();
        const sf = createServerFiles({
            getRequestHeaders: headers,
            fetch: async (url, init) => {
                const u = String(url);
                if (u.startsWith('/api/files/upload')) {
                    const body = JSON.parse(String(init.body));
                    disk.set(body.name, body.data);
                    return { ok: true, status: 200, json: async () => ({ path: serverFilePath(body.name) }) };
                }
                if (u.includes('/user/files/')) {
                    const name = u.replace(/^\/user\/files\//, '').split('?')[0];
                    if (!disk.has(name)) {
                        return { ok: false, status: 404, text: async () => '' };
                    }
                    const text = base64ToUtf8(/** @type {string} */ (disk.get(name)));
                    return { ok: true, status: 200, text: async () => text };
                }
                return { ok: false, status: 500, text: async () => 'unexpected' };
            },
        });
        const name = `${SERVER_FILE_PREFIX}artists.json`;
        const payload = { schemaVersion: 1, records: [{ id: 'a1', name: '画师甲「测试」' }] };
        const wr = await sf.writeJson(name, payload);
        assert.equal(isOk(wr), true);
        const rr = await sf.readJson(name);
        assert.equal(isOk(rr), true);
        assert.deepEqual(rr.value, payload);
    });

    it('illegal name does not send request', async () => {
        let called = 0;
        const sf = createServerFiles({
            getRequestHeaders: headers,
            fetch: async () => {
                called += 1;
                return { ok: true, status: 200, text: async () => '{}' };
            },
        });
        const bad = 'evil.json';
        assert.equal(isErr(await sf.readJson(bad)), true);
        assert.equal(isErr(await sf.writeJson(bad, {})), true);
        assert.equal(isErr(await sf.writeBase64(bad, 'aa')), true);
        assert.equal(isErr(await sf.remove(bad)), true);
        assert.equal(isErr(await sf.exists([bad])), true);
        assert.equal(called, 0);
    });

    it('same-name writes are serialized', async () => {
        /** @type {number[]} */
        const order = [];
        let inflight = 0;
        let maxInflight = 0;
        const name = `${SERVER_FILE_PREFIX}llm_configs.json`;
        const sf = createServerFiles({
            getRequestHeaders: headers,
            fetch: async (_url, init) => {
                const body = JSON.parse(String(init.body));
                const seq = JSON.parse(base64ToUtf8(body.data)).n;
                inflight += 1;
                maxInflight = Math.max(maxInflight, inflight);
                await new Promise((r) => setTimeout(r, 20));
                order.push(seq);
                inflight -= 1;
                return { ok: true, status: 200, json: async () => ({ path: serverFilePath(name) }) };
            },
        });
        await Promise.all([
            sf.writeJson(name, { n: 1 }),
            sf.writeJson(name, { n: 2 }),
            sf.writeJson(name, { n: 3 }),
        ]);
        assert.deepEqual(order, [1, 2, 3]);
        assert.equal(maxInflight, 1);
    });

    it('remove treats 404 as success', async () => {
        const sf = createServerFiles({
            getRequestHeaders: headers,
            fetch: async () => ({ ok: false, status: 404, text: async () => 'File not found' }),
        });
        const r = await sf.remove(`${SERVER_FILE_PREFIX}gone.json`);
        assert.equal(isOk(r), true);
    });

    it('exists maps verify urls back to names', async () => {
        const a = `${SERVER_FILE_PREFIX}a.json`;
        const b = `${SERVER_FILE_PREFIX}b.json`;
        const sf = createServerFiles({
            getRequestHeaders: headers,
            fetch: async (_url, init) => {
                const body = JSON.parse(String(init.body));
                assert.deepEqual(body.urls, [serverFilePath(a), serverFilePath(b)]);
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        [serverFilePath(a)]: true,
                        [serverFilePath(b)]: false,
                    }),
                };
            },
        });
        const r = await sf.exists([a, b]);
        assert.equal(isOk(r), true);
        assert.deepEqual(r.value, { [a]: true, [b]: false });
    });

    it('urlOf returns stable versioned path for images', () => {
        const sf = createServerFiles({
            getRequestHeaders: headers,
            fetch: async () => ({ ok: true, status: 200 }),
        });
        const name = `${SERVER_FILE_PREFIX}x.webp`;
        assert.equal(sf.urlOf(name), `/user/files/${name}`);
        assert.equal(sf.urlOf(name, 'v1'), `/user/files/${name}?v=v1`);
        assert.equal(sf.urlOf(name, 'v1'), sf.urlOf(name, 'v1'));
        assert.notEqual(sf.urlOf(name, 'v1'), sf.urlOf(name, 'v2'));
    });
});
