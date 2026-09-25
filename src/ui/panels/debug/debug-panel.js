/**
 * L5 UI · 解析调试：召回 / 生图解析失败时留下的原文。
 */

import { createButton } from '../../common/controls.js';
import { el, setText } from '../_lib/panel-kit.js';
import { clearParseFailures, listParseFailures } from '../../../application/parse-debug-log.js';

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
    setText(hint, '这里是解析失败那一刻模型返回的原文，不会事后改写。刷新页面后清空。');
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

    const list = el('div', 'nd-debug-list');
    shell.appendChild(list);

    function paint() {
        list.replaceChildren();
        const rows = listParseFailures();
        if (!rows.length) {
            const empty = el('p', 'nd-muted');
            setText(empty, '还没有解析失败记录。');
            list.appendChild(empty);
            return;
        }
        for (const row of rows) {
            const card = el('article', 'nd-debug-card');
            const meta = el('p', 'nd-debug-card__meta');
            setText(meta, `${row.stage} · ${row.code} · ${row.at}`);
            const message = el('p');
            setText(message, row.message);
            const box = document.createElement('textarea');
            box.className = 'nd-debug-raw';
            box.readOnly = true;
            box.value = row.rawText;
            box.spellcheck = false;
            card.append(meta, message, box);
            list.appendChild(card);
        }
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
