/**
 * L2 契约 · Repository 端口族（架构文档 §4.4，裁决 D7 / D12 / D16–D17 / D22–D23）。
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
 * IndexedDB 客户端形状（`openIdb` 的返回值，裁决 D16 / D17）。
 *
 * **错误约定（D16）**：本层**不**返回 `Result`。方法以 Promise reject / 同步 throw
 * 抛出 `AppError`；仓库层统一 `catch` 后包成 `Result`。理由：IDB 事务边界与
 * Result 值传递不匹配，强行包装会让事务语义更难看清。
 *
 * @typedef {object} IdbClient
 * @property {(store: string, key: string) => Promise<any>} get
 * @property {(store: string, value: any, key?: string) => Promise<void>} put
 * @property {(store: string, key: string) => Promise<void>} delete
 * @property {(store: string) => Promise<any[]>} getAll
 * @property {(store: string, indexName: string, query: IDBValidKey|IDBKeyRange) => Promise<any[]>} getAllByIndex
 *   按对象仓库索引列出（裁决 D17）。实现见 `adapters/storage/idb.js`。
 * @property {(storeNames: string|string[], mode: IDBTransactionMode, runner: (stores: Record<string, IDBObjectStore>) => void|Promise<void>) => Promise<void>} runTransaction
 *   显式事务边界（裁决 D17）；runner 内可同步读写多个 store。
 * @property {() => void} close
 */

/**
 * 设置 store 工厂依赖（裁决 D15）。
 * 存取一律经 `HostPort.loadSettings` / `saveSettings`，本 store 只做
 * PluginSettings 的 merge / 单键 get/set。**禁止**再直接吃 `getContext`。
 *
 * @typedef {object} SettingsStoreDeps
 * @property {import('./host.port.js').HostPort} host
 */

/**
 * @typedef {object} SettingsStore
 * @property {() => import('../domain/model/plugin-settings.js').PluginSettings} load
 * @property {(settings: import('../domain/model/plugin-settings.js').PluginSettings) => void} save
 * @property {(key: string, fallback?: any) => any} get
 * @property {(key: string, value: any) => void} set
 * @property {(fn: (settings: import('../domain/model/plugin-settings.js').PluginSettings) => void) => (() => void)} [onChange]
 */

/**
 * 统一 CRUD + 导入导出形状（单实体仓库）。
 * 失败：ConfigError（校验）、HostError（存储不可用）、DomainError（格式/业务校验失败）。
 * 存储载体见宿主能力基线 §9 与需求 4.17（服务器文件 / IndexedDB 图片缓存 / extension_settings）。
 * 仓库实现须将 `IdbClient` 的抛错统一包成 `Result`（裁决 D16）。
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
 * Slot 仓库：会话内主键 slotId（记录里保留 messageId）。
 *
 * **权威记录**在服务器会话文件（需求 4.17）；不写 message.extra。
 * 图片二进制只走 `ImageRepository`；本仓库只存 `imageRef` 引用。
 *
 * @typedef {object} SlotRepository
 * @property {() => Promise<import('../infra/result.js').Ok<SlotRecord[]>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} listRetained
 *   当前会话保留范围内的全部记录。
 * @property {(messageId: number) => Promise<import('../infra/result.js').Ok<SlotRecord[]>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} getByMessage
 * @property {(messageId: number, slotId: number) => Promise<import('../infra/result.js').Ok<SlotRecord|null>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} get
 * @property {(messageId: number, records: SlotRecord[]) => Promise<import('../infra/result.js').Ok<void>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} put
 * @property {(messageId: number, slotId: number, imageRef: ImageRef, meta?: object) => Promise<import('../infra/result.js').Ok<SlotRecord>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} recordImage
 * @property {(fn: (change: { type: string, messageId?: number, slotId?: number }) => void) => Unsubscribe} onChanged
 */

/**
 * 图片 blob 仓库（IndexedDB）+ (sessionId, slotId) 缓存索引。
 *
 * @typedef {object} ImageRepository
 * @property {(blob: Blob) => Promise<import('../infra/result.js').Ok<ImageRef>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} put
 * @property {(ref: ImageRef) => Promise<import('../infra/result.js').Ok<string|null>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} getUrl
 *   返回可展示的 object URL（或 null）。
 * @property {(liveRefs: ImageRef[], opts?: { force?: boolean }) => Promise<import('../infra/result.js').Ok<{ removed: number }>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} gc
 *   删除不在 `liveRefs` 中的 blob。
 *
 *   **liveRefs**：须覆盖当前会话保留范围内记录的 imageRef **以及**
 *   `slot_image_cache` 中仍需展示的缓存图引用（超出保留范围但浏览器仍有图）。
 *
 *   **空输入安全（裁决 D22）**：`liveRefs` 为 `undefined` / 非数组 / **空数组**时
 *   必须返回 `Err`，**绝不得**解释为「清空全库」。要清空必须显式
 *   `opts.force === true`。
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
    'listRetained', 'getByMessage', 'get', 'put', 'recordImage', 'onChanged',
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
