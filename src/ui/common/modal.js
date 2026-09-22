/**
 * L5 UI · 包一层酒馆 Popup（基线 §11）。
 * 归属：W1-E 组件代理实现。W0 仅冻结签名。
 *
 * 策略：优先走 HostPort.openModal（W1-B 已接 callGenericPopup / Popup.DISPLAY）；
 * 宿主无弹窗能力时降级为原生 <dialog>，保证管理台仍可打开。
 * destroy 只关本实例持有的 dialog（裁决 D30），不盲猜最后一个 open dialog。
 *
 * D52：作用域根用 class `.nd-root`，禁止用 id 全局查找作用域根。
 * 定位本弹窗：从调用方传入的 `element` 做 closest('dialog')——元素引用唯一，不会拿错实例。
 */

import { t } from '../i18n/zh-CN.js';

/**
 * @param {{ title: string, element: Element, wide?: boolean, large?: boolean, allowVerticalScrolling?: boolean }} opts
 * @returns {HTMLElement}
 */
function buildRoot(opts) {
    const wrap = document.createElement('div');
    wrap.className = 'nd-root nd-modal-root';
    if (opts?.title) {
        const h = document.createElement('h3');
        h.className = 'nd-modal-title';
        h.textContent = String(opts.title);
        wrap.appendChild(h);
    }
    if (opts?.element instanceof Element) {
        wrap.appendChild(opts.element);
    }
    return wrap;
}

/**
 * @param {Element|null|undefined} node
 * @returns {HTMLDialogElement|null}
 */
function closestDialog(node) {
    if (!(node instanceof Element)) {
        return null;
    }
    const dlg = node.closest('dialog');
    return dlg instanceof HTMLDialogElement ? dlg : null;
}

/**
 * @param {HTMLDialogElement|null} dlg
 */
function closeOwnedDialog(dlg) {
    if (!dlg) {
        return;
    }
    const closeBtn = dlg.querySelector('.popup-button-close, [data-nd-close], .nd-native-dialog__close');
    if (closeBtn instanceof HTMLElement) {
        closeBtn.click();
        return;
    }
    if (typeof dlg.close === 'function') {
        dlg.close();
    }
    if (dlg.classList.contains('nd-native-dialog')) {
        dlg.remove();
    }
}

/**
 * 原生兜底：dialog 内必须挂 .nd-root，令牌才生效（D30 / D52）。
 * @param {HTMLElement} contentRoot 已是 .nd-root
 * @param {string} title
 * @returns {{ destroy: () => void, dialog: HTMLDialogElement }}
 */
function openNativeDialog(contentRoot, title) {
    const dlg = document.createElement('dialog');
    dlg.className = 'nd-native-dialog';
    dlg.setAttribute('aria-label', title || t('modal.fallbackTitle'));

    const shell = document.createElement('div');
    shell.className = 'nd-native-dialog__shell';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'nd-native-dialog__close';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', t('common.close'));
    closeBtn.setAttribute('data-nd-close', '1');

    const card = document.createElement('div');
    card.className = 'nd-native-dialog__card';
    while (contentRoot.firstChild) {
        card.appendChild(contentRoot.firstChild);
    }

    shell.append(closeBtn, card);
    contentRoot.appendChild(shell);
    dlg.appendChild(contentRoot);
    document.body.appendChild(dlg);

    let closed = false;
    const close = () => {
        if (closed) {
            return;
        }
        closed = true;
        if (typeof dlg.close === 'function') {
            dlg.close();
        }
        dlg.remove();
    };

    closeBtn.addEventListener('click', close);
    dlg.addEventListener('cancel', (event) => {
        event.preventDefault();
        close();
    });

    if (typeof dlg.showModal === 'function') {
        dlg.showModal();
    } else {
        dlg.setAttribute('open', '');
    }

    return { destroy: close, dialog: dlg };
}

/**
 * @param {object} deps
 * @param {import('../../ports/host.port.js').HostPort} deps.host
 * @param {{ title: string, element: Element, wide?: boolean, large?: boolean, allowVerticalScrolling?: boolean }} opts
 * @returns {Promise<{ destroy: () => void }>}
 */
export async function openModal(deps, opts) {
    const host = deps?.host;
    const title = opts?.title != null ? String(opts.title) : '';
    const element = opts?.element;
    if (!(element instanceof Element)) {
        throw new Error('openModal: opts.element must be an Element');
    }

    if (host && typeof host.openModal === 'function') {
        /** @type {{ title: string, element: Element, wide?: boolean, large?: boolean, allowVerticalScrolling?: boolean }} */
        const hostOpts = { title, element };
        // 裁决 D20：透传，不吞、不写死
        if (opts && Object.prototype.hasOwnProperty.call(opts, 'wide')) {
            hostOpts.wide = opts.wide;
        }
        if (opts && Object.prototype.hasOwnProperty.call(opts, 'large')) {
            hostOpts.large = opts.large;
        }
        if (opts && Object.prototype.hasOwnProperty.call(opts, 'allowVerticalScrolling')) {
            hostOpts.allowVerticalScrolling = opts.allowVerticalScrolling;
        }

        const pending = host.openModal(hostOpts);

        await Promise.resolve();
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });

        // D52：从本实例 element 向上找 dialog，不用 getElementById（多根会拿错）
        /** @type {HTMLDialogElement|null} */
        let ownedDialog = closestDialog(element);

        let destroyed = false;
        const destroy = () => {
            if (destroyed) {
                return;
            }
            destroyed = true;
            closeOwnedDialog(ownedDialog);
        };

        Promise.resolve(pending).catch(() => {});

        if (!ownedDialog) {
            const wrap = buildRoot({ title, element });
            const native = openNativeDialog(wrap, title);
            ownedDialog = native.dialog;
            return { destroy: native.destroy };
        }

        return { destroy };
    }

    const wrap = buildRoot({ title, element });
    return openNativeDialog(wrap, title);
}
