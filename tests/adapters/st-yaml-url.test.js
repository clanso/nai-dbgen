/**
 * st-yaml：子路径下 lib.js URL 解析 + 浏览器错误不被 npm 回退覆盖。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveStPublicModuleUrl,
    ST_PUBLIC_RELATIVE_PREFIX,
    loadStYamlApi,
    resolveYamlApi,
    yamlApiFromModule,
} from '../../src/adapters/host/st-yaml.js';

describe('resolveStPublicModuleUrl', () => {
    it('自扩展 host 模块路径解析到子路径下的 lib.js', () => {
        const base = 'https://host/st/scripts/extensions/third-party/nai-dbgen/src/adapters/host/st-yaml.js';
        assert.equal(
            resolveStPublicModuleUrl('lib.js', base),
            'https://host/st/lib.js',
        );
        assert.equal(
            resolveStPublicModuleUrl('/lib.js', base),
            'https://host/st/lib.js',
        );
    });

    it('用户级与全局 third-party 同一 URL 前缀均可解析', () => {
        const userBase = 'http://127.0.0.1:8000/scripts/extensions/third-party/my-ext/src/adapters/host/st-yaml.js';
        assert.equal(resolveStPublicModuleUrl('lib.js', userBase), 'http://127.0.0.1:8000/lib.js');
        assert.equal(
            resolveStPublicModuleUrl('scripts/world-info.js', userBase),
            'http://127.0.0.1:8000/scripts/world-info.js',
        );
    });

    it('相对前缀深度与安装布局一致', () => {
        assert.equal(ST_PUBLIC_RELATIVE_PREFIX, '../../../../../../../');
        const parts = ST_PUBLIC_RELATIVE_PREFIX.replace(/\/$/, '').split('/');
        assert.equal(parts.length, 7);
    });
});

describe('loadStYamlApi / resolveYamlApi 错误', () => {
    it('加载失败时错误含中文与真实 URL，不被覆盖', async () => {
        const badUrl = 'https://example.invalid/missing-lib.js';
        await assert.rejects(
            () => loadStYamlApi({ url: badUrl }),
            (err) => {
                assert.ok(err instanceof Error);
                assert.match(err.message, /无法加载酒馆 lib\.js/);
                assert.match(err.message, /missing-lib\.js/);
                return true;
            },
        );
    });

    it('注入 yaml 时直接返回，不碰网络', async () => {
        const yaml = yamlApiFromModule({
            parse: (t) => ({ ok: t }),
            stringify: (v) => String(v),
        });
        const api = await resolveYamlApi({ yaml });
        assert.equal(api.parse('x').ok, 'x');
    });
});
