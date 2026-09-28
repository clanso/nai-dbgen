/**
 * L5 UI · 解析调试：最近一次召回 / 生图原文，以及解析失败记录。
 */

import { createButton } from '../../common/controls.js';
import { el, setText } from '../_lib/panel-kit.js';
import {
    clearParseFailures,
    listLatestGenerations,
    listParseFailures,
} from '../../../application/parse-debug-log.js';

/**
 * @param {Element} root
 * @returns {{ destroy: () => void, refresh: () => Promise<void> }}
 */
export function mountDebugPanel(root) {
    if (!(root instanceof Element)) {
        throw new Error('mountDebugPanel: root must be an Element');
    }

    const shell = el('div', 'nd-panel nd-panel--debug');
    root.appendChild(shell);

    const head = el('div', 'nd-form__actions');
    const title = el('h3', 'nd-field-group__title');
    setText(title, '解析调试');
    const hint = el('p', 'nd-muted');
    setText(hint, '上面固定留着最近一次召回和最近一次生图的原文，成功也会留。下面是解析失败记录。刷新页面后清空。');
    head.append(
        title,
        createButton({
            label: '清空',
            variant: 'ghost',
            onClick: () => {
                clearParseFailures();
                paint();
            },
        }),
    );
    shell.append(head, hint);

    const latestTitle = el('h4', 'nd-field-group__title');
    setText(latestTitle, '最近一次');
    const latestList = el('div', 'nd-debug-list');
    const failTitle = el('h4', 'nd-field-group__title');
    setText(failTitle, '解析失败');
    const list = el('div', 'nd-debug-list');
    shell.append(latestTitle, latestList, failTitle, list);

    /**
     * @param {HTMLElement} host
     * @param {{ stage: string, code?: string, message?: string, at: string, rawText: string, ok?: boolean }} row
     */
    function appendCard(host, row) {
        const card = el('article', 'nd-debug-card');
        const meta = el('p', 'nd-debug-card__meta');
        const status = row.ok === true ? '成功' : (row.code || '失败');
        setText(meta, `${row.stage} · ${status} · ${row.at}`);
        const message = el('p', 'nd-debug-card__text');
        setText(message, row.message || '');
        const box = document.createElement('textarea');
        box.className = 'nd-debug-raw';
        box.readOnly = true;
        box.value = row.rawText;
        box.spellcheck = false;
        card.append(meta, message, box);
        host.appendChild(card);
    }

    function paint() {
        latestList.replaceChildren();
        const latest = listLatestGenerations();
        if (!latest.length) {
            const empty = el('p', 'nd-muted');
            setText(empty, '还没有召回或生图调用。');
            latestList.appendChild(empty);
        } else {
            for (const row of latest) appendCard(latestList, row);
        }

        list.replaceChildren();
        const rows = listParseFailures();
        if (!rows.length) {
            const empty = el('p', 'nd-muted');
            setText(empty, '还没有解析失败记录。');
            list.appendChild(empty);
            return;
        }
        for (const row of rows) appendCard(list, row);
    }

    paint();

    return {
        destroy() {
            shell.remove();
        },
        async refresh() {
            paint();
        },
    };
}
