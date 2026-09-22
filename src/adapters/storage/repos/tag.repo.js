/**
 * L2 适配器 · TagLibrary / TagEntry 两层仓库（裁决 D7）。
 * 归属：W1-D 存储代理实现。W0 仅冻结签名。
 */

import { Ok, Err } from '../../../infra/result.js';
import { configError } from '../../../infra/errors.js';
import { mapIdbError, IDB_STORES } from '../idb.js';
import {
    TAG_SCHEMA_VERSION,
    migrateTagEntry,
    migrateTagLibrary,
    validateTagEntry,
    validateTagLibrary,
} from '../../../domain/model/tag.js';
import {
    buildExportEnvelope,
    catchToResult,
    createChangeEmitter,
    parseImportEnvelope,
    resolveDuplicate,
} from '../import-export.js';

/**
 * @param {{ db: object, bus?: object }} deps
 * @returns {import('../../../ports/repository.port.js').TagRepository}
 */
export function createTagRepo(deps) {
    const db = deps?.db;
    if (!db) {
        throw new Error('createTagRepo requires deps.db');
    }
    const changes = createChangeEmitter();
    const LIBS = IDB_STORES.TAG_LIBRARIES;
    const ENTRIES = IDB_STORES.TAG_ENTRIES;

    /**
     * @param {unknown} err
     */
    function mapErr(err) {
        if (err && typeof err === 'object' && 'category' in err && 'code' in err) {
            return /** @type {import('../../../infra/errors.js').AppError} */ (err);
        }
        return mapIdbError(err);
    }

    return {
        async listLibraries() {
            return catchToResult(async () => {
                const rows = await db.getAll(LIBS);
                return rows
                    .map((r) => validateTagLibrary(r))
                    .filter((r) => r.ok)
                    .map((r) => r.value)
                    .sort((a, b) => a.name.localeCompare(b.name));
            }, mapErr, Ok, Err);
        },

        async getLibrary(id) {
            return catchToResult(async () => {
                const row = await db.get(LIBS, id);
                if (!row) {
                    return null;
                }
                const v = validateTagLibrary(row);
                return v.ok ? v.value : null;
            }, mapErr, Ok, Err);
        },

        async putLibrary(library) {
            const validated = validateTagLibrary(library);
            if (!validated.ok) {
                return validated;
            }
            return catchToResult(async () => {
                await db.put(LIBS, validated.value);
                changes.emit({ type: 'library:put', id: validated.value.id, libraryId: validated.value.id });
                return validated.value;
            }, mapErr, Ok, Err);
        },

        /**
         * 删库时级联删除库内条目。
         */
        async removeLibrary(id) {
            return catchToResult(async () => {
                const members = typeof db.getAllByIndex === 'function'
                    ? await db.getAllByIndex(ENTRIES, 'by_libraryId', id)
                    : (await db.getAll(ENTRIES)).filter((e) => e.libraryId === id);
                if (typeof db.runTransaction === 'function') {
                    await db.runTransaction([LIBS, ENTRIES], 'readwrite', (stores) => {
                        stores[LIBS].delete(id);
                        for (const m of members) {
                            stores[ENTRIES].delete(m.id);
                        }
                    });
                } else {
                    for (const m of members) {
                        await db.delete(ENTRIES, m.id);
                    }
                    await db.delete(LIBS, id);
                }
                changes.emit({ type: 'library:remove', id, libraryId: id });
            }, mapErr, Ok, Err);
        },

        async listEntries(libraryId) {
            return catchToResult(async () => {
                let rows;
                if (libraryId != null && libraryId !== '') {
                    rows = typeof db.getAllByIndex === 'function'
                        ? await db.getAllByIndex(ENTRIES, 'by_libraryId', libraryId)
                        : (await db.getAll(ENTRIES)).filter((e) => e.libraryId === libraryId);
                } else {
                    rows = await db.getAll(ENTRIES);
                }
                return rows
                    .map((r) => validateTagEntry(r))
                    .filter((r) => r.ok)
                    .map((r) => r.value)
                    .sort((a, b) => a.key.localeCompare(b.key));
            }, mapErr, Ok, Err);
        },

        async get(id) {
            return catchToResult(async () => {
                const row = await db.get(ENTRIES, id);
                if (!row) {
                    return null;
                }
                const v = validateTagEntry(row);
                return v.ok ? v.value : null;
            }, mapErr, Ok, Err);
        },

        async put(entry) {
            const validated = validateTagEntry(entry);
            if (!validated.ok) {
                return validated;
            }
            return catchToResult(async () => {
                const lib = await db.get(LIBS, validated.value.libraryId);
                if (!lib) {
                    throw configError({
                        code: 'TAG_LIB_MISSING',
                        message: '标签条目所属库不存在',
                        hint: '请先创建或选择标签库',
                        context: { libraryId: validated.value.libraryId },
                    });
                }
                await db.put(ENTRIES, validated.value);
                changes.emit({
                    type: 'entry:put',
                    id: validated.value.id,
                    libraryId: validated.value.libraryId,
                });
                return validated.value;
            }, mapErr, Ok, Err);
        },

        async remove(id) {
            return catchToResult(async () => {
                const existing = await db.get(ENTRIES, id);
                await db.delete(ENTRIES, id);
                changes.emit({
                    type: 'entry:remove',
                    id,
                    libraryId: existing?.libraryId,
                });
            }, mapErr, Ok, Err);
        },

        async exportJson() {
            return catchToResult(async () => {
                // 与 list 路径一致：只导出通过校验的实体
                const libraries = (await db.getAll(LIBS))
                    .map((r) => validateTagLibrary(r))
                    .filter((r) => r.ok)
                    .map((r) => r.value)
                    .sort((a, b) => a.name.localeCompare(b.name));
                const entries = (await db.getAll(ENTRIES))
                    .map((r) => validateTagEntry(r))
                    .filter((r) => r.ok)
                    .map((r) => r.value)
                    .sort((a, b) => a.key.localeCompare(b.key));
                return buildExportEnvelope({
                    kind: 'tag',
                    schemaVersion: TAG_SCHEMA_VERSION,
                    payload: { libraries, entries },
                });
            }, mapErr, Ok, Err);
        },

        async importJson(data, opts) {
            const parsed = parseImportEnvelope(data, 'tag');
            if (!parsed.ok) {
                return Err(configError({
                    code: 'TAG_IMPORT_SHAPE',
                    message: parsed.error,
                }));
            }
            const strategy = opts?.strategy || 'skip';
            const body = parsed.value.body;
            const libsIn = Array.isArray(body.libraries) ? body.libraries : [];
            const entriesIn = Array.isArray(body.entries) ? body.entries : [];

            let imported = 0;
            let skipped = 0;
            /** @type {string[]} */
            const errors = [];
            /** @type {Map<string, string>} */
            const libIdMap = new Map();

            try {
                const existingLibs = await db.getAll(LIBS);
                const libById = new Map(existingLibs.map((l) => [l.id, l]));

                for (const raw of libsIn) {
                    const fromVersion = Number(raw?.schemaVersion) || parsed.value.schemaVersion;
                    const migrated = migrateTagLibrary(raw, fromVersion);
                    if (!migrated.ok) {
                        errors.push(migrated.error.message);
                        continue;
                    }
                    const validated = validateTagLibrary(migrated.value);
                    if (!validated.ok) {
                        errors.push(validated.error.message);
                        continue;
                    }
                    const decision = resolveDuplicate({
                        incoming: validated.value,
                        existing: libById.get(validated.value.id),
                        strategy,
                        idPrefix: 'tl',
                    });
                    if (decision.action === 'skip') {
                        skipped += 1;
                        libIdMap.set(validated.value.id, validated.value.id);
                        continue;
                    }
                    await db.put(LIBS, decision.entity);
                    libIdMap.set(validated.value.id, decision.entity.id);
                    libById.set(decision.entity.id, decision.entity);
                    imported += 1;
                }

                const existingEntries = await db.getAll(ENTRIES);
                const entryById = new Map(existingEntries.map((e) => [e.id, e]));

                for (const raw of entriesIn) {
                    const fromVersion = Number(raw?.schemaVersion) || parsed.value.schemaVersion;
                    const migrated = migrateTagEntry(raw, fromVersion);
                    if (!migrated.ok) {
                        errors.push(migrated.error.message);
                        continue;
                    }
                    const mappedLibId = libIdMap.get(migrated.value.libraryId) || migrated.value.libraryId;
                    const validated = validateTagEntry({
                        ...migrated.value,
                        libraryId: mappedLibId,
                    });
                    if (!validated.ok) {
                        errors.push(validated.error.message);
                        continue;
                    }
                    const decision = resolveDuplicate({
                        incoming: validated.value,
                        existing: entryById.get(validated.value.id),
                        strategy,
                        idPrefix: 'te',
                    });
                    if (decision.action === 'skip') {
                        skipped += 1;
                        continue;
                    }
                    const entity = { ...decision.entity, libraryId: mappedLibId };
                    if (!(await db.get(LIBS, entity.libraryId))) {
                        errors.push(`条目 ${entity.key || entity.id} 缺少所属库`);
                        continue;
                    }
                    await db.put(ENTRIES, entity);
                    entryById.set(entity.id, entity);
                    imported += 1;
                }

                changes.emit({ type: 'import', imported, skipped });
                return Ok({ imported, skipped, errors });
            } catch (err) {
                return Err(mapErr(err));
            }
        },

        onChanged(fn) {
            return changes.subscribe(fn);
        },
    };
}
