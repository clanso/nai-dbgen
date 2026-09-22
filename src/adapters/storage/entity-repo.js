/**
 * 同构单实体仓库工厂（artist / preset / llm / nai 共用）。
 */

import { Ok, Err } from '../../infra/result.js';
import { configError } from '../../infra/errors.js';
import { mapIdbError } from './idb.js';
import {
    buildExportEnvelope,
    catchToResult,
    createChangeEmitter,
    parseImportEnvelope,
    resolveDuplicate,
} from './import-export.js';

/**
 * @template T
 * @param {object} args
 * @param {object} args.db
 * @param {string} args.storeName
 * @param {string} args.kind
 * @param {number} args.schemaVersion
 * @param {(obj: unknown) => { ok: true, value: T } | { ok: false, error: import('../../infra/errors.js').AppError }} args.validate
 * @param {(obj: object, fromVersion: number) => { ok: true, value: object } | { ok: false, error: import('../../infra/errors.js').AppError }} args.migrate
 * @param {string} [args.idPrefix]
 * @param {(entity: T) => boolean} [args.filter]
 * @returns {import('../../ports/repository.port.js').Repository<T>}
 */
export function createEntityRepo(args) {
    const {
        db,
        storeName,
        kind,
        schemaVersion,
        validate,
        migrate,
        idPrefix = 'ent',
        filter,
    } = args;
    if (!db) {
        throw new Error('createEntityRepo requires db');
    }
    const changes = createChangeEmitter();

    /**
     * @param {unknown} err
     */
    function mapErr(err) {
        if (err && typeof err === 'object' && 'category' in err && 'code' in err) {
            return /** @type {import('../../infra/errors.js').AppError} */ (err);
        }
        return mapIdbError(err);
    }

    /**
     * @param {any[]} rows
     * @returns {T[]}
     */
    function normalizeList(rows) {
        /** @type {T[]} */
        const out = [];
        for (const row of rows) {
            const v = validate(row);
            if (!v.ok) {
                continue;
            }
            if (filter && !filter(v.value)) {
                continue;
            }
            out.push(v.value);
        }
        return out.sort((a, b) => String(a.name || a.id).localeCompare(String(b.name || b.id)));
    }

    return {
        async list() {
            return catchToResult(async () => normalizeList(await db.getAll(storeName)), mapErr, Ok, Err);
        },

        async get(id) {
            return catchToResult(async () => {
                const row = await db.get(storeName, id);
                if (!row) {
                    return null;
                }
                const v = validate(row);
                if (!v.ok) {
                    return null;
                }
                if (filter && !filter(v.value)) {
                    return null;
                }
                return v.value;
            }, mapErr, Ok, Err);
        },

        async put(entity) {
            const validated = validate(entity);
            if (!validated.ok) {
                return validated;
            }
            if (filter && !filter(validated.value)) {
                return Err(configError({
                    code: 'ENTITY_KIND_MISMATCH',
                    message: '实体类型与仓库不匹配',
                }));
            }
            return catchToResult(async () => {
                await db.put(storeName, validated.value);
                changes.emit({ type: 'put', id: validated.value.id });
                return validated.value;
            }, mapErr, Ok, Err);
        },

        async remove(id) {
            return catchToResult(async () => {
                await db.delete(storeName, id);
                changes.emit({ type: 'remove', id });
            }, mapErr, Ok, Err);
        },

        async exportJson() {
            return catchToResult(async () => {
                const items = normalizeList(await db.getAll(storeName));
                return buildExportEnvelope({
                    kind,
                    schemaVersion,
                    payload: { items },
                });
            }, mapErr, Ok, Err);
        },

        async importJson(data, opts) {
            const parsed = parseImportEnvelope(data, kind);
            if (!parsed.ok) {
                return Err(configError({
                    code: 'IMPORT_SHAPE',
                    message: parsed.error,
                }));
            }
            const strategy = opts?.strategy || 'skip';
            const body = parsed.value.body;
            const itemsIn = Array.isArray(body.items)
                ? body.items
                : Array.isArray(body.entries)
                    ? body.entries
                    : [];

            let imported = 0;
            let skipped = 0;
            /** @type {string[]} */
            const errors = [];

            try {
                const existing = normalizeList(await db.getAll(storeName));
                const byId = new Map(existing.map((e) => [e.id, e]));

                for (const raw of itemsIn) {
                    const fromVersion = Number(raw?.schemaVersion) || parsed.value.schemaVersion;
                    const migrated = migrate(raw, fromVersion);
                    if (!migrated.ok) {
                        errors.push(migrated.error.message);
                        continue;
                    }
                    const validated = validate(migrated.value);
                    if (!validated.ok) {
                        errors.push(validated.error.message);
                        continue;
                    }
                    if (filter && !filter(validated.value)) {
                        errors.push(`跳过不匹配类型的条目 ${validated.value.id}`);
                        continue;
                    }
                    const decision = resolveDuplicate({
                        incoming: validated.value,
                        existing: byId.get(validated.value.id),
                        strategy,
                        idPrefix,
                    });
                    if (decision.action === 'skip') {
                        skipped += 1;
                        continue;
                    }
                    await db.put(storeName, decision.entity);
                    byId.set(decision.entity.id, decision.entity);
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
