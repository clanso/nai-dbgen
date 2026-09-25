/**
 * L1 · AppError 分类树。跨层失败一律归入六类之一（架构文档 §10）。
 */

/** @type {Readonly<{ HOST: string, CONFIG: string, TRANSPORT: string, UPSTREAM: string, CONTRACT: string, DOMAIN: string }>} */
export const ERROR_CATEGORY = Object.freeze({
    HOST: 'HostError',
    CONFIG: 'ConfigError',
    TRANSPORT: 'TransportError',
    UPSTREAM: 'UpstreamError',
    CONTRACT: 'ContractError',
    DOMAIN: 'DomainError',
});

/**
 * @typedef {object} AppErrorInit
 * @property {string} code 细分机器码，如 'NAI_401' 'REGEX_MISSING'
 * @property {string} message 面向用户的中文说明（直接进 toast）
 * @property {string|null} [hint] 可操作指引；无则 null
 * @property {boolean} [retryable]
 * @property {unknown} [cause] 原始错误
 * @property {string|null} [traceId]
 * @property {Record<string, unknown>} [context]
 */

export class AppError extends Error {
    /**
     * @param {string} category ERROR_CATEGORY 之一
     * @param {AppErrorInit} init
     */
    constructor(category, init) {
        super(init.message);
        this.name = 'AppError';
        /** @type {string} */
        this.category = category;
        /** @type {string} */
        this.code = init.code;
        /** @type {string|null} */
        this.hint = init.hint ?? null;
        /** @type {boolean} */
        this.retryable = init.retryable ?? false;
        /** @type {unknown} */
        this.cause = init.cause ?? null;
        /** @type {string|null} */
        this.traceId = init.traceId ?? null;
        /** @type {Record<string, unknown>} */
        this.context = init.context ? { ...init.context } : {};
    }
}

/**
 * @param {AppErrorInit} init
 * @returns {AppError}
 */
export function hostError(init) {
    return new AppError(ERROR_CATEGORY.HOST, {
        retryable: false,
        ...init,
    });
}

/**
 * @param {AppErrorInit} init
 * @returns {AppError}
 */
export function configError(init) {
    return new AppError(ERROR_CATEGORY.CONFIG, {
        retryable: false,
        ...init,
    });
}

/**
 * @param {AppErrorInit} init
 * @returns {AppError}
 */
export function transportError(init) {
    return new AppError(ERROR_CATEGORY.TRANSPORT, {
        retryable: true,
        ...init,
    });
}

/**
 * @param {AppErrorInit} init
 * @returns {AppError}
 */
export function upstreamError(init) {
    return new AppError(ERROR_CATEGORY.UPSTREAM, {
        retryable: false,
        ...init,
    });
}

/**
 * @param {AppErrorInit} init
 * @returns {AppError}
 */
export function contractError(init) {
    return new AppError(ERROR_CATEGORY.CONTRACT, {
        retryable: false,
        ...init,
    });
}

/**
 * @param {AppErrorInit} init
 * @returns {AppError}
 */
export function domainError(init) {
    return new AppError(ERROR_CATEGORY.DOMAIN, {
        retryable: false,
        ...init,
    });
}

/**
 * 按 HTTP 状态构造 UpstreamError（裁决 D11 / 架构 §10）。
 * 策略唯一定义点，W1-C 不得另发明一套。
 *
 * | 状态 | retryable | 语义 |
 * | --- | --- | --- |
 * | 401 / 403 | false | 鉴权失败，应停用该配置 |
 * | 429 | true | 限流；尊重 Retry-After（秒）写入 context.retryAfterSec |
 * | 408 / 5xx | true | 超时或上游故障，退避重试 |
 * | 其它 4xx | false | 请求不被接受 |
 *
 * 用户中断（AbortError）请直接调本函数时传 status=0 且 init.cause 为 AbortError，
 * 或使用 abort 专用路径：本函数在 cause 为 AbortError 时强制 retryable=false。
 *
 * @param {number} status HTTP 状态码；用户中断可用 0
 * @param {AppErrorInit} [init] 可覆盖 code/message/hint/traceId/context/cause
 * @returns {AppError}
 */
export function upstreamFromHttpStatus(status, init = {}) {
    const cause = init.cause ?? null;
    const isAbort = isAbortCause(cause);
    if (isAbort) {
        return upstreamError({
            code: init.code ?? 'UPSTREAM_ABORTED',
            message: init.message ?? '请求已取消',
            hint: init.hint ?? null,
            retryable: false,
            cause,
            traceId: init.traceId ?? null,
            context: { status, disableConfig: false, ...(init.context ?? {}) },
        });
    }

    const codeNum = Number(status);
    /** @type {boolean} */
    let retryable = false;
    /** @type {boolean} */
    let disableConfig = false;
    /** @type {string} */
    let code = `UPSTREAM_${codeNum || 'UNKNOWN'}`;
    /** @type {string} */
    let message = `上游返回错误（HTTP ${codeNum}）`;
    /** @type {string|null} */
    let hint = '请稍后重试，或检查接口配置';

    if (codeNum === 401 || codeNum === 403) {
        retryable = false;
        disableConfig = true;
        code = codeNum === 401 ? 'NAI_401' : 'NAI_403';
        message = codeNum === 401 ? '接口鉴权失败（API 密钥无效或过期）' : '接口拒绝访问（权限不足）';
        hint = '请检查 API 密钥，该配置将被停用';
    } else if (codeNum === 429) {
        retryable = true;
        code = 'NAI_429';
        message = '上游限流，请稍后再试';
        hint = '将自动退避重试；若持续失败请降低并发';
    } else if (codeNum === 408 || (codeNum >= 500 && codeNum <= 599)) {
        retryable = true;
        code = codeNum === 408 ? 'UPSTREAM_408' : `UPSTREAM_${codeNum}`;
        message = codeNum === 408 ? '上游请求超时' : `上游服务异常（HTTP ${codeNum}）`;
        hint = '将自动退避重试';
    } else if (codeNum >= 400 && codeNum < 500) {
        retryable = false;
        code = `UPSTREAM_${codeNum}`;
        message = `请求不被上游接受（HTTP ${codeNum}）`;
        hint = '请检查请求参数或接口地址';
    }

    /** @type {Record<string, unknown>} */
    const context = {
        status: codeNum,
        disableConfig,
        ...(init.context ?? {}),
    };
    if (codeNum === 429 && context.retryAfterSec == null) {
        const fromInit = init.context && /** @type {any} */ (init.context).retryAfterSec;
        if (fromInit != null) {
            context.retryAfterSec = Number(fromInit);
        }
    }

    return upstreamError({
        code: init.code ?? code,
        message: init.message ?? message,
        hint: init.hint !== undefined ? init.hint : hint,
        retryable: init.retryable !== undefined ? init.retryable : retryable,
        cause,
        traceId: init.traceId ?? null,
        context,
    });
}

/**
 * @param {unknown} cause
 * @returns {boolean}
 */
function isAbortCause(cause) {
    if (cause == null) {
        return false;
    }
    if (typeof cause === 'object') {
        const name = /** @type {{ name?: string, code?: string }} */ (cause).name;
        const code = /** @type {{ code?: string }} */ (cause).code;
        if (name === 'AbortError' || code === 'ABORT_ERR') {
            return true;
        }
    }
    return false;
}

/**
 * 给 toast 用的用户可见文案（中文 + 可选 hint）。
 * @param {unknown} err
 * @returns {string}
 */
export function toUserMessage(err) {
    if (err instanceof AppError) {
        if (err.hint) {
            return `${err.message}（${err.hint}）`;
        }
        return err.message;
    }
    if (err && typeof err === 'object' && 'message' in err && typeof /** @type {{message:unknown}} */ (err).message === 'string') {
        return /** @type {{message:string}} */ (err).message;
    }
    return '发生未知错误';
}

/**
 * 给 logger 用的结构化记录（可 JSON 化）。
 * @param {unknown} err
 * @returns {Record<string, unknown>}
 */
export function toLogRecord(err) {
    if (err instanceof AppError) {
        return {
            name: err.name,
            category: err.category,
            code: err.code,
            message: err.message,
            hint: err.hint,
            retryable: err.retryable,
            traceId: err.traceId,
            context: err.context,
            stack: err.stack ?? null,
            cause: serializeCause(err.cause),
        };
    }
    if (err instanceof Error) {
        return {
            name: err.name,
            message: err.message,
            stack: err.stack ?? null,
        };
    }
    return { message: String(err) };
}

/**
 * @param {unknown} cause
 * @returns {unknown}
 */
function serializeCause(cause) {
    if (cause == null) {
        return null;
    }
    if (cause instanceof Error) {
        return { name: cause.name, message: cause.message, stack: cause.stack ?? null };
    }
    return cause;
}

export class HostError extends AppError {
    /** @param {AppErrorInit} init */
    constructor(init) {
        super(ERROR_CATEGORY.HOST, { retryable: false, ...init });
        this.name = 'HostError';
    }
}

export class ConfigError extends AppError {
    /** @param {AppErrorInit} init */
    constructor(init) {
        super(ERROR_CATEGORY.CONFIG, { retryable: false, ...init });
        this.name = 'ConfigError';
    }
}

export class TransportError extends AppError {
    /** @param {AppErrorInit} init */
    constructor(init) {
        super(ERROR_CATEGORY.TRANSPORT, { retryable: true, ...init });
        this.name = 'TransportError';
    }
}

export class UpstreamError extends AppError {
    /** @param {AppErrorInit} init */
    constructor(init) {
        super(ERROR_CATEGORY.UPSTREAM, { retryable: false, ...init });
        this.name = 'UpstreamError';
    }
}

export class ContractError extends AppError {
    /** @param {AppErrorInit} init */
    constructor(init) {
        super(ERROR_CATEGORY.CONTRACT, { retryable: false, ...init });
        this.name = 'ContractError';
    }
}

export class DomainError extends AppError {
    /** @param {AppErrorInit} init */
    constructor(init) {
        super(ERROR_CATEGORY.DOMAIN, { retryable: false, ...init });
        this.name = 'DomainError';
    }
}
