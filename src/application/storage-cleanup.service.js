/**
 * L4 应用层 · 存储清理：核对目录中的会话是否仍存在，删孤儿文件与登记。
 */

import { Ok, Err, isErr } from '../infra/result.js';
import { hostError } from '../infra/errors.js';
import { chatSlotFileName } from '../domain/slot/session-files.js';

/**
 * @typedef {object} StorageCleanupResult
 * @property {number} removedSessions 因会话已不存在而删除的条目数
 * @property {number} removedMissingFiles 登记了但文件不存在、已修掉的条目数
 * @property {string[]} removedSessionIds
 */

/**
 * @param {object} deps
 * @param {import('../ports/host.port.js').HostPort} deps.host
 * @param {ReturnType<import('../adapters/storage/chat-index.store.js').createChatIndexStore>} deps.chatIndex
 * @param {{ remove: Function, exists: Function }} deps.serverFiles
 * @returns {{ cleanup: () => Promise<import('../infra/result.js').Ok<StorageCleanupResult>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>> }}
 */
export function createStorageCleanupService(deps) {
    const host = deps?.host;
    const chatIndex = deps?.chatIndex;
    const serverFiles = deps?.serverFiles;
    if (!host || typeof host.listAliveChats !== 'function') {
        throw new Error('createStorageCleanupService requires host.listAliveChats');
    }
    if (!chatIndex || typeof chatIndex.load !== 'function') {
        throw new Error('createStorageCleanupService requires chatIndex');
    }
    if (!serverFiles) {
        throw new Error('createStorageCleanupService requires serverFiles');
    }

    return {
        async cleanup() {
            const aliveR = await host.listAliveChats();
            if (isErr(aliveR)) {
                return aliveR;
            }
            const indexR = await chatIndex.load();
            if (isErr(indexR)) {
                return indexR;
            }

            /** @type {Set<string>} */
            const aliveByIntegrity = new Set();
            /** @type {Set<string>} */
            const aliveByLocation = new Set();
            for (const row of aliveR.value) {
                if (row.integrity) {
                    aliveByIntegrity.add(String(row.integrity));
                }
                const locKey = `${row.groupId ?? ''}|${row.avatarUrl ?? ''}|${row.chatFileName ?? ''}`;
                aliveByLocation.add(locKey);
            }

            /** @type {string[]} */
            const removedSessionIds = [];
            let removedSessions = 0;
            let removedMissingFiles = 0;

            const names = indexR.value.chats.map((c) => c.fileName || chatSlotFileName(c.sessionId));
            const existsR = await serverFiles.exists(names);
            if (isErr(existsR)) {
                return existsR;
            }
            const existsMap = existsR.value || {};

            for (const entry of indexR.value.chats) {
                const sid = entry.sessionId;
                const fileName = entry.fileName || chatSlotFileName(sid);
                const locKey = `${entry.groupId ?? ''}|${entry.avatarUrl ?? ''}|${entry.chatFileName ?? ''}`;
                const stillAlive = aliveByIntegrity.has(sid) || aliveByLocation.has(locKey);
                const fileExists = existsMap[fileName] === true;

                if (!stillAlive) {
                    const rm = await serverFiles.remove(fileName);
                    if (isErr(rm)) {
                        return rm;
                    }
                    const un = await chatIndex.unregister(sid);
                    if (isErr(un)) {
                        return un;
                    }
                    removedSessions += 1;
                    removedSessionIds.push(sid);
                    continue;
                }

                if (!fileExists) {
                    const un = await chatIndex.unregister(sid);
                    if (isErr(un)) {
                        return un;
                    }
                    removedMissingFiles += 1;
                    removedSessionIds.push(sid);
                }
            }

            return Ok({
                removedSessions,
                removedMissingFiles,
                removedSessionIds,
            });
        },
    };
}
