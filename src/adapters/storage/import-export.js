/**
 * 导入导出纯逻辑（可单测，不碰 IndexedDB）。
 * 桌面项目对照：app/public/lab.js previewImport/commitImport（duplicateMode: skip|overwrite|variant）。
 * 本插件契约用 rename 对应桌面 variant。
 */

import { newId } from '../../infra/id.js';
import { isPlainObject } from '../../infra/validate.js';

/**
 * @typedef {'skip'|'overwrite'|'rename'} DuplicateStrategy
 */

/**
 * @param {object} args
 * @param {string} args.kind 导出包类型标识，如 'character' | 'tag' | 'artist' …
 * @param {number} args.schemaVersion
 * @param {Record<string, unknown>} args.payload
 * @returns {object}
 */
export function buildExportEnvelope(args) {
    return {
        schemaVersion: Number(args.schemaVersion) || 1,
        kind: String(args.kind),
        exportedAt: new Date().toISOString(),
        ...args.payload,
    };
}

/**
 * 解析导入顶层：要求 plain object，读取 schemaVersion。
 * @param {unknown} data
 * @param {string} expectedKind
 * @returns {{ ok: true, value: { schemaVersion: number, body: Record<string, unknown> } } | { ok: false, error: string }}
 */
export function parseImportEnvelope(data, expectedKind) {
    if (!isPlainObject(data)) {
        return { ok: false, error: '导入数据必须是 JSON 对象' };
    }
    if (data.kind != null && String(data.kind) !== expectedKind) {
        return {
            ok: false,
            error: `导入类型不匹配：期望 ${expectedKind}，实际 ${String(data.kind)}`,
        };
    }
    const schemaVersion = Number(data.schemaVersion) || 1;
    return { ok: true, value: { schemaVersion, body: data } };
}

/**
 * 按策略处理 id 冲突。
 * @template {{ id: string, name?: string, createdAt?: string }} T
 * @param {object} args
 * @param {T} args.incoming
 * @param {T|null|undefined} args.existing
 * @param {DuplicateStrategy} [args.strategy='skip']
 * @param {string} [args.idPrefix]
 * @returns {{ action: 'skip'|'write', entity: T|null }}
 */
export function resolveDuplicate(args) {
    const strategy = args.strategy === 'overwrite' || args.strategy === 'rename'
        ? args.strategy
        : 'skip';
    const incoming = args.incoming;
    const existing = args.existing;

    if (!existing) {
        return { action: 'write', entity: incoming };
    }

    if (strategy === 'skip') {
        return { action: 'skip', entity: null };
    }

    if (strategy === 'overwrite') {
        return {
            action: 'write',
            entity: {
                ...incoming,
                id: existing.id,
                createdAt: existing.createdAt ?? incoming.createdAt,
            },
        };
    }

    // rename = 桌面 variant：新 id，名称加后缀
    const renamed = {
        ...incoming,
        id: newId(args.idPrefix || 'imp'),
        name: incoming.name != null
            ? `${incoming.name} · 导入副本`
            : incoming.name,
    };
    return { action: 'write', entity: renamed };
}

/**
 * 变更订阅：幂等 unsubscribe。
 * @returns {{
 *   subscribe: (fn: (change: object) => void) => () => void,
 *   emit: (change: object) => void,
 * }}
 */
export function createChangeEmitter() {
    /** @type {Set<(change: object) => void>} */
    const listeners = new Set();
    return {
        subscribe(fn) {
            if (typeof fn !== 'function') {
                return () => {};
            }
            listeners.add(fn);
            let active = true;
            return () => {
                if (!active) {
                    return;
                }
                active = false;
                listeners.delete(fn);
            };
        },
        emit(change) {
            for (const fn of [...listeners]) {
                try {
                    fn(change);
                } catch {
                    // UI 订阅者异常不得拖垮仓库
                }
            }
        },
    };
}

/**
 * 把可能抛错的 IDB Promise 收成 Result。
 * @template T
 * @param {() => Promise<T>} fn
 * @param {(err: unknown) => import('../../infra/errors.js').AppError} mapError
 * @param {(value: T) => { ok: true, value: T }} Ok
 * @param {(error: import('../../infra/errors.js').AppError) => { ok: false, error: import('../../infra/errors.js').AppError }} Err
 * @returns {Promise<{ ok: true, value: T } | { ok: false, error: import('../../infra/errors.js').AppError }>}
 */
export async function catchToResult(fn, mapError, Ok, Err) {
    try {
        return Ok(await fn());
    } catch (err) {
        // mapIdbError 已返回 AppError；其它错误再包一层
        const mapped = mapError(err);
        return Err(mapped);
    }
}
