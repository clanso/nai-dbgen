/**
 * L1 · 带命名空间的 logger。模块顶层无副作用输出。
 */

/** @typedef {'debug'|'info'|'warn'|'error'} LogLevel */

/** @type {Record<LogLevel, number>} */
const LEVEL_RANK = Object.freeze({
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
});

/** @type {LogLevel} */
let currentLevel = 'warn';

const ROOT_PREFIX = '[nai-dbgen]';

/**
 * @param {LogLevel} level
 */
export function setLogLevel(level) {
    if (!(level in LEVEL_RANK)) {
        throw new Error(`invalid log level: ${level}`);
    }
    currentLevel = level;
}

/**
 * @returns {LogLevel}
 */
export function getLogLevel() {
    return currentLevel;
}

/**
 * @param {LogLevel} level
 * @returns {boolean}
 */
function shouldLog(level) {
    return LEVEL_RANK[level] >= LEVEL_RANK[currentLevel];
}

/**
 * @param {string} namespace
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function, child: (ns: string) => ReturnType<typeof createLogger> }}
 */
export function createLogger(namespace) {
    const prefix = `${ROOT_PREFIX}[${namespace}]`;

    /**
     * @param {LogLevel} level
     * @param {unknown[]} args
     */
    function write(level, args) {
        if (!shouldLog(level)) {
            return;
        }
        const fn = level === 'debug' ? console.debug
            : level === 'info' ? console.info
                : level === 'warn' ? console.warn
                    : console.error;
        fn(prefix, ...args);
    }

    return {
        /** @param {...unknown} args */
        debug(...args) {
            write('debug', args);
        },
        /** @param {...unknown} args */
        info(...args) {
            write('info', args);
        },
        /** @param {...unknown} args */
        warn(...args) {
            write('warn', args);
        },
        /** @param {...unknown} args */
        error(...args) {
            write('error', args);
        },
        /**
         * @param {string} ns 子命名空间片段
         * @returns {ReturnType<typeof createLogger>}
         */
        child(ns) {
            return createLogger(`${namespace}/${ns}`);
        },
    };
}
