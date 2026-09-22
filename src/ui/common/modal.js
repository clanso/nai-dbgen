/**
 * L5 UI · 包一层酒馆 Popup（基线 §11）。
 * 归属：W1-E 组件代理实现。W0 仅冻结签名。
 *
 * 策略：优先走 HostPort.openModal（W1-B 已接 callGenericPopup / Popup.DISPLAY）；
 * 宿主无弹窗能力时降级为原生 <dialog>，保证管理台仍可打开。
 * 原生 dialog 不参与酒馆层叠，故仅作兜底（见交付报告）。
 */

import { t } from '../i18n/zh-CN.js';

/**
 * @param {{ title: string, element: Element, wide?: boolean, large?: boolean }} opts
 * @returns {HTMLElement}
 */
function buildRoot(opts) {
    const wrap = document.createElement('div');
    wrap.id = 'nai-dbgen-root';
    wrap.className = 'nd-modal-root';
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
 * @param {HTMLElement} content
 * @param {string} title
 * @returns {{ destroy: () => void }}
 */
function openNativeDialog(content, title) {
    const dlg = document.createElement('dialog');
    dlg.className = 'nd-native-dialog';
    dlg.setAttribute('aria-label', title || t('modal.fallbackTitle'));

    // 原生兜底样式：不走 components.css 的视口单位布局，仅保证可读
    dlg.style.border = '0';
    dlg.style.padding = '0';
    dlg.style.background = 'transparent';
    dlg.style.maxWidth = 'min(920px, calc(100% - 28px))';

    const card = document.createElement('div');
    card.style.padding = '22px';
    card.style.borderRadius = '18px';
    card.style.border = '1px solid var(--nd-line, rgba(123,70,96,.21))';
    card.style.background = 'var(--nd-surface, #fffdfd)';
    card.style.color = 'var(--nd-text, #4b3040)';
    card.style.boxShadow = 'var(--nd-shadow, 0 22px 60px rgba(123,70,96,.16))';
    card.style.maxHeight = 'min(820px, calc(100% - 28px))';
    card.style.overflow = 'auto';
    card.appendChild(content);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.textContent = '×';
    closeBtn.setAttribute('aria-label', t('common.close'));
    closeBtn.style.position = 'absolute';
    closeBtn.style.top = '10px';
    closeBtn.style.right = '12px';
    closeBtn.style.border = '0';
    closeBtn.style.background = 'transparent';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontSize = '22px';
    closeBtn.style.color = 'var(--nd-muted, #7f5f70)';

    const shell = document.createElement('div');
    shell.style.position = 'relative';
    shell.append(closeBtn, card);
    dlg.appendChild(shell);
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

    return { destroy: close };
}

/**
 * @returns {Element|null}
 */
function findOpenPopupDialog() {
    const dialogs = document.querySelectorAll('dialog.popup[open], dialog[open]');
    return dialogs.length ? dialogs[dialogs.length - 1] : null;
}

/**
 * @param {Element|null} dlg
 */
function closeDialog(dlg) {
    if (!(dlg instanceof HTMLElement)) {
        return;
    }
    const closeBtn = dlg.querySelector('.popup-button-close, [data-nd-close]');
    if (closeBtn instanceof HTMLElement) {
        closeBtn.click();
        return;
    }
    if (typeof /** @type {HTMLDialogElement} */ (dlg).close === 'function') {
        /** @type {HTMLDialogElement} */ (dlg).close();
    }
}

/**
 * @param {object} deps
 * @param {import('../../ports/host.port.js').HostPort} deps.host
 * @param {{ title: string, element: Element, wide?: boolean, large?: boolean }} opts
 * @returns {Promise<{ destroy: () => void }>}
 */
export async function openModal(deps, opts) {
    const host = deps?.host;
    const title = opts?.title != null ? String(opts.title) : '';
    const element = opts?.element;
    if (!(element instanceof Element)) {
        throw new Error('openModal: opts.element must be an Element');
    }

    // HostPort.openModal 自身会包 #nai-dbgen-root + title；宽/大由宿主默认 wide+large。
    if (host && typeof host.openModal === 'function') {
        const pending = host.openModal({
            title,
            element,
            wide: opts?.wide !== false,
        });

        // 让宿主有机会挂上 dialog 后再绑定 destroy
        await Promise.resolve();
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });

        let destroyed = false;
        const destroy = () => {
            if (destroyed) {
                return;
            }
            destroyed = true;
            closeDialog(findOpenPopupDialog());
        };

        // 不阻塞调用方；弹窗关闭后 pending settle
        Promise.resolve(pending).catch(() => {});

        // 若宿主静默 no-op（无 getContext），退到原生 dialog
        const dlg = findOpenPopupDialog();
        const rooted = document.getElementById('nai-dbgen-root');
        if (!dlg && !rooted) {
            const wrap = buildRoot({ title, element });
            return openNativeDialog(wrap, title);
        }

        return { destroy };
    }

    const wrap = buildRoot({ title, element });
    return openNativeDialog(wrap, title);
}
