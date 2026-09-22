/**
 * L2 契约 · Repository 端口族（架构文档 §4.4，裁决 D7 / D12）。
 * 同构 Repository 仅用于 artist / preset / llm-config / nai-config。
 * 角色库、标签库是两层结构，必须用 CharacterRepository / TagRepository。
 * 无具体实现。归属：W0 冻结；实现归 W1-D `adapters/storage/`。
 */

import { Ok, Err } from '../infra/result.js';
import { hostError } from '../infra/errors.js';
import { requireArg } from '../infra/validate.js';

/**
 * @typedef {() => void} Unsubscribe
 */

/**
 * 统一 CRUD + 导入导出形状（单实体仓库）。
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
 * @typedef {import('../domain/model/character.js').Character} Character
 * @typedef {import('../domain/model/character.js').CharacterGroup} CharacterGroup
 * @typedef {import('../domain/model/tag.js').TagLibrary} TagLibrary
 * @typedef {import('../domain/model/tag.js').TagEntry} TagEntry
 * @typedef {import('../domain/model/slot.js').SlotRecord} SlotRecord
 * @typedef {import('../domain/model/slot.js').ImageRef} ImageRef
 */

/**
 * 角色库两层端口（需求 4.1：组 → 角色）。裁决 D7。
 *
 * @typedef {object} CharacterRepository
 * @property {() => Promise<import('../infra/result.js').Ok<CharacterGroup[]>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} listGroups
 * @property {(id: string) => Promise<import('../infra/result.js').Ok<CharacterGroup|null>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} getGroup
 * @property {(group: CharacterGroup) => Promise<import('../infra/result.js').Ok<CharacterGroup>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} putGroup
 * @property {(id: string) => Promise<import('../infra/result.js').Ok<void>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} removeGroup
 *   删组时实现须同时处理组内角色（级联或拒绝），契约要求在 JSDoc/实现注释中写清。
 * @property {(groupId: string) => Promise<import('../infra/result.js').Ok<Character[]>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} listByGroup
 * @property {(id: string) => Promise<import('../infra/result.js').Ok<Character|null>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} get
 * @property {(character: Character) => Promise<import('../infra/result.js').Ok<Character>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} put
 * @property {(id: string) => Promise<import('../infra/result.js').Ok<void>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} remove
 * @property {() => Promise<import('../infra/result.js').Ok<object>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} exportJson
 * @property {(data: object, opts?: { strategy?: 'skip'|'overwrite'|'rename' }) => Promise<import('../infra/result.js').Ok<{ imported: number, skipped: number, errors: string[] }>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} importJson
 * @property {(fn: (change: { type: string, id?: string, groupId?: string }) => void) => Unsubscribe} onChanged
 */

/**
 * 标签库两层端口（需求 4.3：库 → 条目）。裁决 D7。
 *
 * @typedef {object} TagRepository
 * @property {() => Promise<import('../infra/result.js').Ok<TagLibrary[]>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} listLibraries
 * @property {(id: string) => Promise<import('../infra/result.js').Ok<TagLibrary|null>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} getLibrary
 * @property {(library: TagLibrary) => Promise<import('../infra/result.js').Ok<TagLibrary>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} putLibrary
 * @property {(id: string) => Promise<import('../infra/result.js').Ok<void>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} removeLibrary
 * @property {(libraryId?: string) => Promise<import('../infra/result.js').Ok<TagEntry[]>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} listEntries
 *   传入 libraryId 则只列该库；省略则列全部条目。
 * @property {(id: string) => Promise<import('../infra/result.js').Ok<TagEntry|null>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} get
 * @property {(entry: TagEntry) => Promise<import('../infra/result.js').Ok<TagEntry>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} put
 * @property {(id: string) => Promise<import('../infra/result.js').Ok<void>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} remove
 * @property {() => Promise<import('../infra/result.js').Ok<object>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} exportJson
 * @property {(data: object, opts?: { strategy?: 'skip'|'overwrite'|'rename' }) => Promise<import('../infra/result.js').Ok<{ imported: number, skipped: number, errors: string[] }>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} importJson
 * @property {(fn: (change: { type: string, id?: string, libraryId?: string }) => void) => Unsubscribe} onChanged
 */

/**
 * Slot 仓库：主键 (messageId, slotId)。
 *
 * **双写职责（裁决 D12 / 基线 §9）**：
 * - **权威记录**写在 `message.extra['nai-dbgen']`（随 swipe 克隆、随聊天导出走）。
 * - IndexedDB 仅存检索索引与派生数据（可从 extra 重建）；**不得**把权威 caption 只放在 IDB。
 * - 图片二进制只走 `ImageRepository`；本仓库只存 `imageRef` 引用。
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
const CHARACTER_REPO_METHODS = Object.freeze([
    'listGroups', 'getGroup', 'putGroup', 'removeGroup',
    'listByGroup', 'get', 'put', 'remove',
    'exportJson', 'importJson', 'onChanged',
]);

/** @type {readonly string[]} */
const TAG_REPO_METHODS = Object.freeze([
    'listLibraries', 'getLibrary', 'putLibrary', 'removeLibrary',
    'listEntries', 'get', 'put', 'remove',
    'exportJson', 'importJson', 'onChanged',
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
 * @returns {{ ok: true, value: CharacterRepository } | { ok: false, error: import('../infra/errors.js').AppError }}
 */
export function assertCharacterRepository(impl) {
    return /** @type {any} */ (assertMethods(
        impl,
        CHARACTER_REPO_METHODS,
        'CHARACTER_REPO_PORT_INCOMPLETE',
        '角色库端口实现不完整',
    ));
}

/**
 * @param {unknown} impl
 * @returns {{ ok: true, value: TagRepository } | { ok: false, error: import('../infra/errors.js').AppError }}
 */
export function assertTagRepository(impl) {
    return /** @type {any} */ (assertMethods(
        impl,
        TAG_REPO_METHODS,
        'TAG_REPO_PORT_INCOMPLETE',
        '标签库端口实现不完整',
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
    CHARACTER_REPO_METHODS,
    TAG_REPO_METHODS,
    SLOT_REPO_METHODS,
    IMAGE_REPO_METHODS,
};
