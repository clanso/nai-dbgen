/**
 * live-server：缺字段 / 不回显密钥 / 拒绝发出 local.json（不访问外网）。
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIVE_SERVER = path.resolve(HERE, '../../preview/live-server.py');

/**
 * @returns {Promise<number>}
 */
function freePort() {
    return new Promise((resolve, reject) => {
        const srv = createServer();
        srv.listen(0, '127.0.0.1', () => {
            const addr = srv.address();
            const port = typeof addr === 'object' && addr ? addr.port : 0;
            srv.close((err) => (err ? reject(err) : resolve(port)));
        });
        srv.on('error', reject);
    });
}

/**
 * @param {object} opts
 * @param {string} opts.configPath
 * @param {string} opts.root
 * @param {number} opts.port
 */
function startLiveServer(opts) {
    const child = spawn('python3', [LIVE_SERVER, opts.root], {
        env: {
            ...process.env,
            ND_LIVE_API_CONFIG: opts.configPath,
            ND_LIVE_PORT: String(opts.port),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    /** @type {string} */
    let stderr = '';
    child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
    });
    return {
        child,
        getStderr: () => stderr,
        async waitReady(timeoutMs = 8000) {
            const started = Date.now();
            while (Date.now() - started < timeoutMs) {
                try {
                    const res = await fetch(`http://127.0.0.1:${opts.port}/nai-dbgen/preview/live/status`);
                    if (res.ok || res.status === 200) {
                        return;
                    }
                } catch {
                    // retry
                }
                await new Promise((r) => setTimeout(r, 80));
            }
            throw new Error(`live-server 未就绪\n${stderr}`);
        },
        async stop() {
            if (child.exitCode != null) {
                return;
            }
            child.kill('SIGTERM');
            await new Promise((resolve) => {
                const t = setTimeout(() => {
                    try {
                        child.kill('SIGKILL');
                    } catch {
                        // ignore
                    }
                    resolve();
                }, 2000);
                child.once('exit', () => {
                    clearTimeout(t);
                    resolve();
                });
            });
        },
    };
}

describe('preview live-server', () => {
    /** @type {string} */
    let tmpDir = '';
    /** @type {string} */
    let staticRoot = '';
    /** @type {ReturnType<typeof startLiveServer>|null} */
    let server = null;
    let port = 0;

    before(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nd-live-'));
        staticRoot = path.join(tmpDir, 'root');
        const previewDir = path.join(staticRoot, 'nai-dbgen', 'preview');
        await fs.mkdir(previewDir, { recursive: true });
        await fs.writeFile(
            path.join(previewDir, 'live-api.local.json'),
            JSON.stringify({
                llm: {
                    baseUrl: 'http://127.0.0.1:9/v1',
                    model: 'secret-model-name',
                    apiKey: 'SECRET_LLM_KEY_DO_NOT_ECHO',
                },
                nai: { apiKey: 'SECRET_NAI_KEY_DO_NOT_ECHO' },
            }),
            'utf8',
        );
        await fs.writeFile(path.join(previewDir, 'index.html'), '<html>ok</html>', 'utf8');

        const incompletePath = path.join(tmpDir, 'incomplete.json');
        await fs.writeFile(
            incompletePath,
            JSON.stringify({
                llm: { baseUrl: 'http://127.0.0.1:9/v1', model: 'm' },
                nai: {},
            }),
            'utf8',
        );

        port = await freePort();
        server = startLiveServer({
            configPath: incompletePath,
            root: staticRoot,
            port,
        });
        await server.waitReady();
    });

    after(async () => {
        await server?.stop();
        if (tmpDir) {
            await fs.rm(tmpDir, { recursive: true, force: true });
        }
    });

    it('缺字段时 ok:false，并列出缺项名字、不回显值', async () => {
        const res = await fetch(`http://127.0.0.1:${port}/nai-dbgen/preview/live/status`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.ok, false);
        assert.ok(Array.isArray(body.missing));
        assert.ok(body.missing.includes('llm.apiKey'));
        assert.ok(body.missing.includes('nai.apiKey'));
        const text = JSON.stringify(body);
        assert.equal(text.includes('SECRET_'), false);
        assert.equal(text.includes('http://127.0.0.1:9'), false);
    });

    it('拒绝把 live-api.local.json 当静态文件发出', async () => {
        const res = await fetch(
            `http://127.0.0.1:${port}/nai-dbgen/preview/live-api.local.json`,
        );
        assert.equal(res.status, 404);
        const text = await res.text();
        assert.equal(text.includes('SECRET_LLM_KEY_DO_NOT_ECHO'), false);
        assert.equal(text.includes('SECRET_NAI_KEY_DO_NOT_ECHO'), false);
    });

    it('完整配置时 status 只回模型名与 nai.ready，不回显密钥', async () => {
        await server?.stop();
        const fullPath = path.join(tmpDir, 'full.json');
        await fs.writeFile(
            fullPath,
            JSON.stringify({
                llm: {
                    baseUrl: 'http://127.0.0.1:9/v1',
                    model: 'display-model-only',
                    apiKey: 'SECRET_LLM_KEY_DO_NOT_ECHO',
                },
                nai: { apiKey: 'SECRET_NAI_KEY_DO_NOT_ECHO' },
            }),
            'utf8',
        );
        port = await freePort();
        server = startLiveServer({
            configPath: fullPath,
            root: staticRoot,
            port,
        });
        await server.waitReady();

        const res = await fetch(`http://127.0.0.1:${port}/nai-dbgen/preview/live/status`);
        assert.equal(res.status, 200);
        const body = await res.json();
        assert.equal(body.ok, true);
        assert.equal(body.llm.model, 'display-model-only');
        assert.equal(body.nai.ready, true);
        const text = JSON.stringify(body);
        assert.equal(text.includes('SECRET_'), false);
        assert.equal(text.includes('apiKey'), false);
        assert.equal(text.includes('baseUrl'), false);
    });
});
