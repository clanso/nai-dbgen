import { Ok, Err } from '../infra/result.js';
import { domainError, hostError } from '../infra/errors.js';
import { createSlotTokenRegex } from '../domain/slot/slot-token.js';
import { validateSlotRecord } from '../domain/model/slot.js';
import { parseSizeSpec } from '../domain/model/size-spec.js';

export function createSlotEditorService(deps) {
    const saving = new Set();
    const key = (messageId) => `${deps.host.getCurrentChatId()}:${messageId}`;
    const failure = (code, message) => Err(domainError({ code, message }));
    const sameChat = (snapshot) => deps.host.getCurrentChatId() === snapshot.chatId
        && deps.host.getSessionId() === snapshot.sessionId;

    return {
        isSaving: (messageId) => saving.has(key(messageId)),
        async open(messageId) {
            const chatId = deps.host.getCurrentChatId();
            const sessionId = deps.host.getSessionId();
            const message = deps.host.getMessage(messageId);
            if (!message || message.isUser || message.isSystem) {
                return failure('SLOT_EDITOR_MESSAGE', '请选择一条 AI 回复');
            }
            const result = await deps.slotRepo.getByMessage(messageId);
            if (!result.ok) return result;
            const snapshot = {
                messageId, chatId, sessionId,
                text: String(message.text ?? ''),
                records: JSON.parse(JSON.stringify(result.value)),
                chatLocation: deps.host.getChatLocation?.(),
            };
            if (!sameChat(snapshot)) return failure('CHAT_CHANGED', '会话已切换，请重新打开编辑器');
            return Ok(snapshot);
        },
        async save(snapshot, drafts) {
            const mid = snapshot.messageId;
            const lock = key(mid);
            if (!sameChat(snapshot)) return failure('CHAT_CHANGED', '会话已切换，未保存');
            if (saving.has(lock) || deps.isBusy(mid, snapshot.records)) {
                return failure('SLOT_EDITOR_BUSY', '本楼正在生成或写入图片，请完成后再保存');
            }
            if (String(deps.host.getMessage(mid)?.text ?? '') !== snapshot.text) {
                return failure('SLOT_EDIT_CONFLICT', '正文已变化，请重新打开编辑器');
            }
            const original = new Map(snapshot.records.map((row) => [row.slotId, row]));
            const records = [];
            for (const draft of drafts) {
                const previous = original.get(draft.slotId);
                if (!previous) return failure('SLOT_EDIT_ID', '编辑器中出现未知图片编号');
                const checked = validateSlotRecord({
                    ...previous,
                    caption: draft.caption,
                    size: draft.size,
                    analysis: draft.analysis,
                });
                if (!checked.ok) return checked;
                if (checked.value.size) {
                    const size = parseSizeSpec(checked.value.size);
                    if (!size.ok) return size;
                }
                records.push(checked.value);
            }
            records.sort((a, b) => a.slotId - b.slotId);
            const kept = new Set(records.map((row) => row.slotId));
            const removed = new Set(snapshot.records.filter((row) => !kept.has(row.slotId)).map((row) => row.slotId));
            const text = snapshot.text.replace(createSlotTokenRegex(), (match, id) => removed.has(Number(id)) ? '' : match);
            const options = { sessionId: snapshot.sessionId, chatLocation: snapshot.chatLocation };
            saving.add(lock);
            let persisted = false;
            let bodyAttempted = false;
            try {
                const saved = await deps.slotRepo.replaceMessageRecords(mid, records, {
                    ...options, expectedRecords: snapshot.records,
                });
                if (!saved.ok) return saved;
                persisted = true;
                if (!sameChat(snapshot) || String(deps.host.getMessage(mid)?.text ?? '') !== snapshot.text) {
                    throw new Error('会话或正文已变化，撤销本次保存');
                }
                if (text !== snapshot.text) {
                    bodyAttempted = true;
                    const written = await deps.host.replaceMessageText(mid, text);
                    if (!written.ok) throw written.error;
                }
                for (const slotId of removed) {
                    try { await deps.imageRepo?.unlinkSlot?.(snapshot.sessionId, slotId); } catch { /* best effort cache cleanup */ }
                }
                // UI refresh failure must not roll back an already saved edit.
                try { deps.onSaved?.(mid, records, snapshot); } catch { /* ignore */ }
                return Ok({ records, removed: [...removed], text });
            } catch (cause) {
                let rollbackOk = true;
                if (persisted) {
                    try {
                        const rollback = await deps.slotRepo.replaceMessageRecords(mid, snapshot.records, {
                            ...options, expectedRecords: records,
                        });
                        rollbackOk = rollback.ok;
                    } catch { rollbackOk = false; }
                }
                if (bodyAttempted && sameChat(snapshot)
                    && String(deps.host.getMessage(mid)?.text ?? '') === text) {
                    try {
                        const restored = await deps.host.replaceMessageText(mid, snapshot.text);
                        rollbackOk = restored.ok && rollbackOk;
                    } catch { rollbackOk = false; }
                }
                return Err(hostError({
                    code: rollbackOk ? 'SLOT_EDIT_SAVE_FAILED' : 'SLOT_EDIT_ROLLBACK_FAILED',
                    message: rollbackOk ? '保存失败，本次改动已撤销' : '保存失败，部分改动无法撤销，请勿继续生图并检查本楼记录',
                    cause,
                }));
            } finally {
                saving.delete(lock);
            }
        },
    };
}
