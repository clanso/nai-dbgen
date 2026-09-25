/**
 * L2 适配器 · 会话生图记录目录文件（nai-dbgen_index.json）。
 * 新建会话文件：先登记目录，再上传会话文件。
 */

import { Ok, Err, isErr } from '../../infra/result.js';
import { hostError } from '../../infra/errors.js';
import {
    CHAT_INDEX_FILE_NAME,
    chatSlotFileName,
    createChatIndexFile,
    parseChatIndexFile,
    removeIndexEntry,
    upsertIndexEntry,
} from '../../domain/slot/session-files.js';

/**
 * @typedef {import('../../domain/slot/session-files.js').ChatIndexEntry} ChatIndexEntry
 * @typedef {import('../../domain/slot/session-files.js').ChatIndexFile} ChatIndexFile
 */

/**
 * @param {object} deps
 * @param {{ readJson: Function, writeJson: Function, remove: Function, exists: Function }} deps.serverFiles
 * @param {() => string} [deps.nowIso]
 * @returns {{
 *   load: () => Promise<import('../../infra/result.js').Ok<ChatIndexFile>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>,
 *   register: (entry: Omit<ChatIndexEntry, 'fileName'|'updatedAt'> & { fileName?: string, updatedAt?: string }) => Promise<import('../../infra/result.js').Ok<ChatIndexEntry>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>,
 *   updateMeta: (sessionId: string, patch: Partial<ChatIndexEntry>) => Promise<import('../../infra/result.js').Ok<ChatIndexEntry|null>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>,
 *   unregister: (sessionId: string) => Promise<import('../../infra/result.js').Ok<void>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>,
 *   findBySessionId: (sessionId: string) => Promise<import('../../infra/result.js').Ok<ChatIndexEntry|null>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>,
 *   findByChatFileName: (chatFileName: string, opts?: { avatarUrl?: string|null, groupId?: string|null }) => Promise<import('../../infra/result.js').Ok<ChatIndexEntry[]>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>,
 * }}
 */
export function createChatIndexStore(deps) {
    const serverFiles = deps?.serverFiles;
    if (!serverFiles || typeof serverFiles.readJson !== 'function') {
        throw new Error('createChatIndexStore requires deps.serverFiles');
    }
    const nowIso = typeof deps.nowIso === 'function'
        ? deps.nowIso
        : () => new Date().toISOString();

    /**
     * @returns {Promise<import('../../infra/result.js').Ok<ChatIndexFile>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>}
     */
    async function load() {
        const r = await serverFiles.readJson(CHAT_INDEX_FILE_NAME);
        if (isErr(r)) {
            return r;
        }
        if (r.value == null) {
            return Ok(createChatIndexFile());
        }
        const parsed = parseChatIndexFile(r.value);
        if (!parsed.ok) {
            return Err(hostError({
                code: 'CHAT_INDEX_CORRUPT',
                message: '会话目录文件损坏',
                hint: '请勿手动编辑会话目录文件；可从备份恢复',
                context: { reason: parsed.reason },
            }));
        }
        return Ok(parsed.value);
    }

    /**
     * @param {ChatIndexFile} index
     */
    async function save(index) {
        return serverFiles.writeJson(CHAT_INDEX_FILE_NAME, index);
    }

    return {
        load,

        async register(entry) {
            const sessionId = String(entry?.sessionId ?? '');
            if (!sessionId) {
                return Err(hostError({
                    code: 'CHAT_INDEX_SESSION_ID',
                    message: '登记会话目录时缺少会话标识',
                }));
            }
            const loaded = await load();
            if (isErr(loaded)) {
                return loaded;
            }
            const nextEntry = {
                sessionId,
                fileName: entry.fileName || chatSlotFileName(sessionId),
                updatedAt: entry.updatedAt || nowIso(),
                chatFileName: entry.chatFileName ?? null,
                avatarUrl: entry.avatarUrl ?? null,
                groupId: entry.groupId ?? null,
            };
            const next = upsertIndexEntry(loaded.value, nextEntry);
            const w = await save(next);
            if (isErr(w)) {
                return w;
            }
            return Ok(nextEntry);
        },

        async updateMeta(sessionId, patch) {
            const id = String(sessionId ?? '');
            const loaded = await load();
            if (isErr(loaded)) {
                return loaded;
            }
            const cur = loaded.value.chats.find((c) => c.sessionId === id) || null;
            if (!cur) {
                return Ok(null);
            }
            const nextEntry = {
                ...cur,
                ...(patch && typeof patch === 'object' ? patch : {}),
                sessionId: id,
                updatedAt: (patch && patch.updatedAt) || nowIso(),
            };
            const next = upsertIndexEntry(loaded.value, nextEntry);
            const w = await save(next);
            if (isErr(w)) {
                return w;
            }
            return Ok(nextEntry);
        },

        async unregister(sessionId) {
            const loaded = await load();
            if (isErr(loaded)) {
                return loaded;
            }
            const next = removeIndexEntry(loaded.value, sessionId);
            return save(next);
        },

        async findBySessionId(sessionId) {
            const loaded = await load();
            if (isErr(loaded)) {
                return loaded;
            }
            const id = String(sessionId ?? '');
            return Ok(loaded.value.chats.find((c) => c.sessionId === id) || null);
        },

        async findByChatFileName(chatFileName, opts) {
            const loaded = await load();
            if (isErr(loaded)) {
                return loaded;
            }
            const name = String(chatFileName ?? '');
            const avatarUrl = opts?.avatarUrl == null ? undefined : String(opts.avatarUrl);
            const groupId = opts?.groupId == null ? undefined : String(opts.groupId);
            const matches = loaded.value.chats.filter((c) => {
                if (c.chatFileName !== name) {
                    return false;
                }
                if (groupId !== undefined) {
                    return c.groupId === groupId;
                }
                if (avatarUrl !== undefined) {
                    return c.avatarUrl === avatarUrl;
                }
                return true;
            });
            return Ok(matches);
        },
    };
}
