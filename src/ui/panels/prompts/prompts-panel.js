/**
 * L5 UI · 生图提示词管理（按楼/traceId） 管理面板。
 * 归属：W2-H 面板代理实现。W0 仅冻结签名。
 */

import { createField, createButton, createEmptyState, createInlineError } from '../../common/controls.js';
import { el, setText, awaitRepo } from '../_lib/panel-kit.js';

/**
 * @param {Element} root
 * @param {object} deps repos / services / host / bus
 * @returns {{ destroy: () => void }}
 */
export function mountPromptsPanel(root, deps) {
    if (!(root instanceof Element)) {
        throw new Error('mountPromptsPanel: root must be an Element');
    }
    const slotRepo = deps?.repos?.slot;
    const host = deps?.host;

    const shell = el('div', 'nd-panel nd-panel--prompts');
    const msgField = createField({ label: '楼层 messageId', value: '' });
    const traceField = createField({ label: 'traceId 筛选（可空）', value: '' });
    const loadBtn = createButton({
        label: '加载',
        variant: 'primary',
        onClick: () => void load(),
    });
    const toolbar = el('div', 'nd-library-toolbar');
    toolbar.append(msgField.el, traceField.el, loadBtn);

    const err = createInlineError();
    const list = el('div', 'nd-prompts-list');
    shell.append(toolbar, err.el, list);
    root.appendChild(shell);

    let destroyed = false;

    async function load() {
        if (destroyed) return;
        err.clear();
        list.replaceChildren();
        if (!slotRepo) {
            err.setMessage('slot 仓储未装配');
            return;
        }
        const messageId = Number(msgField.getValue());
        if (!Number.isFinite(messageId)) {
            err.setMessage('请填写有效的 messageId');
            return;
        }
        const records = await awaitRepo(host, slotRepo.getByMessage(messageId), '读取 slot 失败');
        if (!records) return;
        const trace = traceField.getValue().trim();
        const filtered = trace
            ? records.filter((r) => String(r.traceId ?? '') === trace)
            : records;

        if (!filtered.length) {
            const empty = createEmptyState({
                title: '没有记录',
                description: '该楼尚无 slot，或 traceId 不匹配。',
            });
            list.appendChild(empty.el);
            return;
        }

        for (const rec of filtered) {
            const card = el('article', 'nd-prompt-card');
            const head = el('h3');
            setText(head, `slot #${rec.slotId}`);
            const meta = el('p', 'nd-muted');
            setText(
                meta,
                [
                    rec.traceId ? `trace=${rec.traceId}` : null,
                    rec.presetId ? `preset=${rec.presetId}` : null,
                    rec.llmConfigId ? `llm=${rec.llmConfigId}` : null,
                    `images=${Array.isArray(rec.images) ? rec.images.length : 0}`,
                ].filter(Boolean).join(' · '),
            );
            const anchor = el('p');
            setText(anchor, `生成点：${rec.anchorSentence || '（空）'}`);
            const pre = el('pre', 'nd-code');
            try {
                setText(pre, JSON.stringify(rec.caption ?? {}, null, 2));
            } catch {
                setText(pre, String(rec.caption ?? ''));
            }
            card.append(head, meta, anchor, pre);
            if (rec.worldInfoSnapshot) {
                const wi = el('details', 'nd-details');
                const sum = el('summary');
                setText(sum, '世界书快照');
                const body = el('pre', 'nd-code');
                setText(body, String(rec.worldInfoSnapshot));
                wi.append(sum, body);
                card.appendChild(wi);
            }
            list.appendChild(card);
        }
    }

    return {
        destroy() {
            if (destroyed) return;
            destroyed = true;
            err.destroy();
            msgField.destroy();
            traceField.destroy();
            shell.remove();
        },
    };
}
