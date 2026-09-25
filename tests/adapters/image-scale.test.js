/**
 * dataUrlToBlob / 卡片缩放：锁住「无 fetch 回退不得用逐片 setTimeout 饿死事件循环」。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import { dataUrlToBlob } from '../../src/adapters/storage/image-scale.js';

/**
 * 构造约 targetBytes 原始字节的假 PNG data URL（内容不必可解码为图）。
 * @param {number} targetBytes
 */
function makeLargeDataUrl(targetBytes) {
    const raw = Buffer.alloc(Math.max(64, targetBytes), 0x41);
    return `data:image/png;base64,${raw.toString('base64')}`;
}

describe('image-scale dataUrlToBlob', () => {
    it('fetch 不可用时，~1.5MB data URL 仍在数秒内完成（禁止逐字节 timer 回退）', async () => {
        const dataUrl = makeLargeDataUrl(1_500_000);
        const realFetch = globalThis.fetch;
        // 强制走 atob 回退（预览冷启动 / 个别环境 data: fetch 失败时的路径）
        globalThis.fetch = undefined;
        try {
            const t0 = performance.now();
            const blob = await dataUrlToBlob(dataUrl);
            const ms = performance.now() - t0;
            assert.equal(blob.size, 1_500_000);
            assert.equal(blob.type, 'image/png');
            // 旧实现在内存压力下单张可拖到数百秒；健康路径应远低于 2s
            assert.ok(ms < 2000, `dataUrlToBlob 过慢: ${ms.toFixed(0)}ms`);
        } finally {
            globalThis.fetch = realFetch;
        }
    });

    it('非法 data URL 抛错', async () => {
        await assert.rejects(() => dataUrlToBlob('not-a-data-url'), /非法 data URL/);
    });
});
