import { createButton, createCheckbox, createField, createTextarea, createInlineError } from '../common/controls.js';
import { openModal } from '../common/modal.js';
import { formatPromptText, parsePromptText } from '../common/prompt-text.js';
import { resolveMessageIdFromElement } from '../../adapters/host/slot-mount.observer.js';

export async function openSlotEditor(deps, messageId) {
    const loaded = await deps.service.open(messageId);
    if (!loaded.ok) {
        deps.host.toast('error', loaded.error.message);
        return null;
    }
    let snapshot = loaded.value;
    const root = document.createElement('div');
    root.className = 'nd-slot-editor';
    const tools = document.createElement('div');
    tools.className = 'nd-slot-editor__tools';
    const list = document.createElement('div');
    list.className = 'nd-slot-editor__list';
    const error = createInlineError();
    const rows = [];
    let busy = false;
    let closed = false;
    let modal;
    let offChat = () => {};
    const destroy = () => {
        if (closed) return;
        closed = true;
        offChat();
        modal?.destroy();
    };
    const selectedDelete = createButton({
        label: '删除所选',
        variant: 'ghost',
        onClick: () => removeRows(rows.filter((row) => row.selected.getValue() && !row.removed)),
    });
    const allDelete = createButton({
        label: '全部删除',
        variant: 'ghost',
        onClick: () => removeRows(rows.filter((row) => !row.removed)),
    });
    function sync() {
        selectedDelete.disabled = busy || !rows.some((row) => !row.removed && row.selected.getValue());
        allDelete.disabled = busy || !rows.some((row) => !row.removed);
        empty.hidden = rows.some((row) => !row.removed);
    }
    async function removeRows(targets) {
        if (busy || closed || !targets.length) return;
        busy = true;
        save.disabled = true;
        error.clear();
        sync();
        const ids = new Set(targets.map((row) => row.record.slotId));
        try {
            const result = await deps.service.save(snapshot, snapshot.records.filter((record) => !ids.has(record.slotId)));
            if (!result.ok) {
                error.setMessage(result.error.message);
                return;
            }
            snapshot = { ...snapshot, records: result.value.records, text: result.value.text };
            for (const row of targets) {
                row.removed = true;
                row.el.remove();
            }
            deps.host.toast('success', `已删除 ${targets.length} 条提示词及对应楼内图片`);
        } catch (err) {
            error.setMessage(err.message || '删除失败');
        } finally {
            busy = false;
            save.disabled = false;
            sync();
        }
    }
    tools.append(selectedDelete, allDelete);
    for (const record of snapshot.records) {
        const card = document.createElement('section');
        card.className = 'nd-slot-editor__item';
        const header = document.createElement('div');
        header.className = 'nd-slot-editor__item-head';
        const selected = createCheckbox({ label: `图片 ${record.slotId}`, onChange: sync });
        const prompt = createTextarea({ label: '提示词', value: formatPromptText(record.caption), rows: 7 });
        const size = createField({ label: '尺寸', value: record.size || '' });
        const analysis = createTextarea({ label: '解析', value: record.analysis || '', rows: 2 });
        const row = { el: card, selected, prompt, size, analysis, record, removed: false };
        const trash = createButton({ label: '×', variant: 'ghost', onClick: () => removeRows([row]) });
        trash.title = `删除图片 ${record.slotId} 的提示词`;
        trash.setAttribute('aria-label', trash.title);
        header.append(selected.el, trash);
        card.append(header, prompt.el, size.el, analysis.el);
        list.append(card);
        rows.push(row);
    }
    const empty = document.createElement('p');
    empty.className = 'nd-muted';
    empty.textContent = '本楼没有待保存的提示词';
    const actions = document.createElement('div');
    actions.className = 'nd-slot-editor__actions';
    const cancel = createButton({ label: '关闭', variant: 'ghost', onClick: destroy });
    const save = createButton({
        label: '保存',
        variant: 'primary',
        onClick: async () => {
            if (busy || closed) return;
            error.clear();
            const drafts = [];
            for (const row of rows.filter((item) => !item.removed)) {
                const parsed = parsePromptText(row.prompt.getValue());
                if (!parsed.ok || parsed.value.truncated || parsed.value.artist) {
                    error.setMessage(`图片 ${row.record.slotId}：${parsed.error?.message || '请保留完整的场景和角色提示词，画师串请在画师库中设置'}`);
                    return;
                }
                drafts.push({
                    slotId: row.record.slotId, caption: parsed.value.caption,
                    size: row.size.getValue().trim(), analysis: row.analysis.getValue(),
                });
            }
            busy = true;
            save.disabled = true;
            for (const input of list.querySelectorAll('input, textarea, button')) input.disabled = true;
            sync();
            try {
                const result = await deps.service.save(snapshot, drafts);
                if (!result.ok) {
                    error.setMessage(result.error.message);
                    return;
                }
                deps.host.toast('success', '本楼提示词已保存');
                destroy();
            } catch (err) {
                error.setMessage(err.message || '保存失败');
            } finally {
                busy = false;
                save.disabled = false;
                for (const input of list.querySelectorAll('input, textarea, button')) input.disabled = false;
                sync();
            }
        },
    });
    actions.append(cancel, save);
    root.append(tools, list, empty, error.el, actions);
    sync();
    modal = await openModal({ host: deps.host }, {
        title: `第 ${messageId} 楼 · 图片提示词`,
        element: root, wide: true, large: true, allowVerticalScrolling: true,
    });
    root.closest('dialog')?.addEventListener('close', destroy, { once: true });
    offChat = deps.host.onChatChanged?.(destroy) || (() => {});
    return { destroy };
}

/** Remove stale rendered placeholders, including same-origin message frames. */
export function removeDeletedSlotElements(root, messageId, removedIds) {
    const removed = new Set(removedIds);
    function visit(scope) {
        for (const element of scope.querySelectorAll('[data-slot]')) {
            if (resolveMessageIdFromElement(element) === messageId
                && removed.has(Number(element.getAttribute('data-slot')))) element.remove();
        }
        for (const frame of scope.querySelectorAll('iframe')) {
            if (resolveMessageIdFromElement(frame) !== messageId) continue;
            try { if (frame.contentDocument) visit(frame.contentDocument); } catch { /* cross-origin */ }
        }
    }
    visit(root);
}
