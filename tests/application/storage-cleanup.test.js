/**
 * 存储清理：接口失败必须 Err，不得误删仍存活会话。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createStorageCleanupService } from '../../src/application/storage-cleanup.service.js';
import { createChatIndexStore } from '../../src/adapters/storage/chat-index.store.js';
import { createMemoryServerFiles } from '../../src/adapters/storage/memory-server-files.js';
import { chatSlotFileName } from '../../src/domain/slot/session-files.js';
import { Ok, Err, isOk, isErr } from '../../src/infra/result.js';
import { hostError } from '../../src/infra/errors.js';

describe('storage-cleanup.service', () => {
    it('listAliveChats 失败时整次清理中止且不删文件', async () => {
        const serverFiles = createMemoryServerFiles();
        const chatIndex = createChatIndexStore({ serverFiles });
        await chatIndex.register({
            sessionId: 'alive-1',
            chatFileName: 'Chat1',
            avatarUrl: 'a.png',
            groupId: null,
        });
        await serverFiles.writeJson(chatSlotFileName('alive-1'), {
            schemaVersion: 1,
            sessionId: 'alive-1',
            slots: [],
        });

        const service = createStorageCleanupService({
            host: {
                listAliveChats: async () => Err(hostError({
                    code: 'LIST_CHATS_HTTP',
                    message: '列出失败',
                })),
            },
            chatIndex,
            serverFiles,
        });

        const r = await service.cleanup();
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'LIST_CHATS_HTTP');
        const still = await serverFiles.readJson(chatSlotFileName('alive-1'));
        assert.equal(isOk(still), true);
        assert.notEqual(still.value, null);
    });

    it('确认不在才删除；仍存活的保留', async () => {
        const serverFiles = createMemoryServerFiles();
        const chatIndex = createChatIndexStore({ serverFiles });
        await chatIndex.register({
            sessionId: 'keep',
            chatFileName: 'Keep',
            avatarUrl: 'a.png',
            groupId: null,
        });
        await chatIndex.register({
            sessionId: 'gone',
            chatFileName: 'Gone',
            avatarUrl: 'b.png',
            groupId: null,
        });
        await serverFiles.writeJson(chatSlotFileName('keep'), {
            schemaVersion: 1, sessionId: 'keep', slots: [],
        });
        await serverFiles.writeJson(chatSlotFileName('gone'), {
            schemaVersion: 1, sessionId: 'gone', slots: [],
        });

        const service = createStorageCleanupService({
            host: {
                listAliveChats: async () => Ok([
                    {
                        integrity: 'keep',
                        chatFileName: 'Keep',
                        avatarUrl: 'a.png',
                        groupId: null,
                    },
                ]),
            },
            chatIndex,
            serverFiles,
        });

        const r = await service.cleanup();
        assert.equal(isOk(r), true);
        assert.equal(r.value.removedSessions, 1);
        assert.equal(r.value.removedSessionIds.includes('gone'), true);

        const keepFile = await serverFiles.readJson(chatSlotFileName('keep'));
        assert.notEqual(keepFile.value, null);
        const goneFile = await serverFiles.readJson(chatSlotFileName('gone'));
        assert.equal(goneFile.value, null);
    });
});
