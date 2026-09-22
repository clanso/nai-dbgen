import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    AppError,
    ERROR_CATEGORY,
    hostError,
    configError,
    transportError,
    upstreamError,
    contractError,
    domainError,
    upstreamFromHttpStatus,
    toUserMessage,
    toLogRecord,
    HostError,
    DomainError,
} from '../../src/infra/errors.js';

describe('errors', () => {
    it('ERROR_CATEGORY is frozen with six keys', () => {
        assert.equal(Object.isFrozen(ERROR_CATEGORY), true);
        assert.deepEqual(Object.keys(ERROR_CATEGORY).sort(), [
            'CONFIG', 'CONTRACT', 'DOMAIN', 'HOST', 'TRANSPORT', 'UPSTREAM',
        ].sort());
    });

    it('factory sets required fields', () => {
        const err = hostError({
            code: 'REGEX_MISSING',
            message: '正则脚本缺失',
            hint: '请重新启用本插件',
            cause: new Error('root'),
            traceId: 't1',
            context: { script: 'slot-to-widget' },
        });
        assert.ok(err instanceof AppError);
        assert.ok(err instanceof Error);
        assert.equal(err.category, ERROR_CATEGORY.HOST);
        assert.equal(err.code, 'REGEX_MISSING');
        assert.equal(err.message, '正则脚本缺失');
        assert.equal(err.hint, '请重新启用本插件');
        assert.equal(err.retryable, false);
        assert.equal(err.traceId, 't1');
        assert.equal(err.context.script, 'slot-to-widget');
        assert.ok(err.stack);
    });

    it('transport defaults retryable true; others false unless overridden', () => {
        assert.equal(transportError({ code: 'CORS', message: '跨域失败' }).retryable, true);
        assert.equal(configError({ code: 'NO_KEY', message: '未配置 Key' }).retryable, false);
        assert.equal(upstreamError({ code: 'NAI_401', message: '鉴权失败' }).retryable, false);
        assert.equal(contractError({ code: 'LLM_BAD_JSON', message: '回文不是 JSON' }).retryable, false);
        assert.equal(domainError({ code: 'ANCHOR_MISS', message: '生成点匹配失败' }).retryable, false);
        assert.equal(
            transportError({ code: 'ABORT', message: '已取消', retryable: false }).retryable,
            false,
        );
    });

    it('named subclasses carry category', () => {
        const h = new HostError({ code: 'X', message: '宿主异常' });
        const d = new DomainError({ code: 'Y', message: '业务失败' });
        assert.equal(h.category, ERROR_CATEGORY.HOST);
        assert.equal(d.category, ERROR_CATEGORY.DOMAIN);
        assert.equal(h.name, 'HostError');
    });

    it('toUserMessage appends hint', () => {
        assert.equal(
            toUserMessage(domainError({ code: 'A', message: '失败了', hint: '去设置页检查' })),
            '失败了（去设置页检查）',
        );
        assert.equal(
            toUserMessage(domainError({ code: 'A', message: '失败了' })),
            '失败了',
        );
        assert.equal(toUserMessage('plain'), '发生未知错误');
    });

    it('toLogRecord is plain serializable', () => {
        const rec = toLogRecord(hostError({
            code: 'H',
            message: '宿主不可用',
            context: { k: 1 },
        }));
        const json = JSON.parse(JSON.stringify(rec));
        assert.equal(json.code, 'H');
        assert.equal(json.category, ERROR_CATEGORY.HOST);
        assert.equal(json.context.k, 1);
    });

    it('upstreamFromHttpStatus: 401/403 disable config, not retryable', () => {
        const e401 = upstreamFromHttpStatus(401);
        assert.equal(e401.category, ERROR_CATEGORY.UPSTREAM);
        assert.equal(e401.retryable, false);
        assert.equal(e401.context.disableConfig, true);
        assert.equal(e401.code, 'NAI_401');
        const e403 = upstreamFromHttpStatus(403);
        assert.equal(e403.retryable, false);
        assert.equal(e403.context.disableConfig, true);
    });

    it('upstreamFromHttpStatus: 429 retryable', () => {
        const e = upstreamFromHttpStatus(429, { context: { retryAfterSec: 12 } });
        assert.equal(e.retryable, true);
        assert.equal(e.code, 'NAI_429');
        assert.equal(e.context.retryAfterSec, 12);
        assert.equal(e.context.disableConfig, false);
    });

    it('upstreamFromHttpStatus: 408/5xx retryable', () => {
        assert.equal(upstreamFromHttpStatus(408).retryable, true);
        assert.equal(upstreamFromHttpStatus(502).retryable, true);
        assert.equal(upstreamFromHttpStatus(500).context.disableConfig, false);
    });

    it('upstreamFromHttpStatus: AbortError never retryable', () => {
        const abort = new Error('aborted');
        abort.name = 'AbortError';
        const e = upstreamFromHttpStatus(0, { cause: abort });
        assert.equal(e.retryable, false);
        assert.equal(e.code, 'UPSTREAM_ABORTED');
    });
});
