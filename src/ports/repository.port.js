/**
 * L2 契约 · Repository 端口族（架构文档 §4.4）。
 * 六个仓库同构；SlotRepo / ImageRepo 有额外方法。
 * 无具体实现。归属：W0 冻结；实现归 W1-D `adapters/storage/`。
 */

import { Ok, Err } from '../infra/result.js';
import { hostError } from '../infra/errors.js';
import { requireArg } from '../infra/validate.js';

/**
 * @typedef {() => void} Unsubscribe
 */

/**
 * 统一 CRUD + 导入导出形状。
 * 失败：ConfigError（校验）、HostError（存储不可用）、DomainError（迁移失败）。
 * 存储载体见宿主能力基线 §9（IndexedDB / message.extra / extension_settings）。
 *
 * @template T
 * @typedef {object} Repository
 * @property {() => Promise<import('../infra/result.js').Ok<T[]>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} list
 * @property {(id: string) => Promise<import('../infra/result.js').Ok<T|null>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} get
 * @property {(entity: T) => Promise<import('../infra/result.js').Ok<T>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} put
 * @property {(id: string) => Promise<import('../infra/result.js').Ok<void>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} remove
 * @property {() => Promise<import('../infra/result.js').Ok<object>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} exportJson
 * @property {(data: object, opts?: { strategy?: 'skip'|'overwrite'|'rename' }) => Promise<import('../infra/result.js').Ok<{ imported: number, skipped: number, errors: string[] }>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} importJson
 * @property {(fn: (change: { type: string, id?: string }) => void) => Unsubscribe} onChanged
 */

/**
 * @typedef {import('../domain/model/slot.js').SlotRecord} SlotRecord
 * @typedef {import('../domain/model/slot.js').ImageRef} ImageRef
 */

/**
 * Slot 仓库：主键 (messageId, slotId)；额外按楼查询与记图。
 *
 * @typedef {object} SlotRepository
 * @property {(messageId: number) => Promise<import('../infra/result.js').Ok<SlotRecord[]>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} getByMessage
 * @property {(messageId: number, slotId: number) => Promise<import('../infra/result.js').Ok<SlotRecord|null>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} get
 * @property {(messageId: number, records: SlotRecord[]) => Promise<import('../infra/result.js').Ok<void>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} put
 * @property {(messageId: number, slotId: number, imageRef: ImageRef, meta?: object) => Promise<import('../infra/result.js').Ok<SlotRecord>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} recordImage
 * @property {(fn: (change: { type: string, messageId?: number, slotId?: number }) => void) => Unsubscribe} onChanged
 */

/**
 * 图片 blob 仓库（IndexedDB）。基线 §9：不写 extra.media，自管 GC。
 *
 * @typedef {object} ImageRepository
 * @property {(blob: Blob) => Promise<import('../infra/result.js').Ok<ImageRef>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} put
 * @property {(ref: ImageRef) => Promise<import('../infra/result.js').Ok<string|null>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} getUrl
 *   返回可展示的 object URL（或 null）。
 * @property {(liveRefs: ImageRef[]) => Promise<import('../infra/result.js').Ok<{ removed: number }>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} gc
 */

/** @type {readonly string[]} */
const REPO_METHODS = Object.freeze([
    'list', 'get', 'put', 'remove', 'exportJson', 'importJson', 'onChanged',
]);

/** @type {readonly string[]} */
const SLOT_REPO_METHODS = Object.freeze([
    'getByMessage', 'get', 'put', 'recordImage', 'onChanged',
]);

/** @type {readonly string[]} */
const IMAGE_REPO_METHODS = Object.freeze(['put', 'getUrl', 'gc']);

/**
 * @param {unknown} impl
 * @param {readonly string[]} methods
 * @param {string} code
 * @param {string} message
 * @returns {{ ok: true, value: object } | { ok: false, error: import('../infra/errors.js').AppError }}
 */
function assertMethods(impl, methods, code, message) {
    requireArg(impl != null, 'impl');
    /** @type {string[]} */
    const missing = [];
    for (const name of methods) {
        if (typeof /** @type {Record<string, unknown>} */ (impl)[name] !== 'function') {
            missing.push(name);
        }
    }
    if (missing.length > 0) {
        return Err(hostError({
            code,
            message,
            hint: '请检查存储适配器装配',
            context: { missing },
        }));
    }
    return Ok(/** @type {object} */ (impl));
}

/**
 * @param {unknown} impl
 * @returns {{ ok: true, value: Repository<any> } | { ok: false, error: import('../infra/errors.js').AppError }}
 */
export function assertRepository(impl) {
    return /** @type {any} */ (assertMethods(
        impl,
        REPO_METHODS,
        'REPO_PORT_INCOMPLETE',
        '仓库端口实现不完整',
    ));
}

/**
 * @param {unknown} impl
 * @returns {{ ok: true, value: SlotRepository } | { ok: false, error: import('../infra/errors.js').AppError }}
 */
export function assertSlotRepository(impl) {
    return /** @type {any} */ (assertMethods(
        impl,
        SLOT_REPO_METHODS,
        'SLOT_REPO_PORT_INCOMPLETE',
        'Slot 仓库端口实现不完整',
    ));
}

/**
 * @param {unknown} impl
 * @returns {{ ok: true, value: ImageRepository } | { ok: false, error: import('../infra/errors.js').AppError }}
 */
export function assertImageRepository(impl) {
    return /** @type {any} */ (assertMethods(
        impl,
        IMAGE_REPO_METHODS,
        'IMAGE_REPO_PORT_INCOMPLETE',
        '图片仓库端口实现不完整',
    ));
}

export {
    REPO_METHODS,
    SLOT_REPO_METHODS,
    IMAGE_REPO_METHODS,
};
