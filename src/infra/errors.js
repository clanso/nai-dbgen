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
