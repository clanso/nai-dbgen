/**
 * 启动提示。不依赖样式表和酒馆 toast，脚本一执行就能看见。
 * 失败时留在页面上，成功几秒后自己关掉。
 */

const BANNER_ID = 'nai-dbgen-load-banner';

/**
 * @param {string} text
 * @param {'info'|'ok'|'error'} [kind]
 */
export function setLoadBanner(text, kind = 'info') {
    if (typeof document === 'undefined') {
        return;
    }
    const body = document.body;
    if (!body) {
        return;
    }
    let el = document.getElementById(BANNER_ID);
    if (!el) {
        el = document.createElement('div');
        el.id = BANNER_ID;
        el.setAttribute('role', 'status');
        el.style.position = 'fixed';
        el.style.top = '12px';
        el.style.left = '50%';
        el.style.transform = 'translateX(-50%)';
        el.style.zIndex = '100000';
        el.style.maxWidth = 'min(720px, calc(100vw - 24px))';
        el.style.padding = '10px 14px';
        el.style.borderRadius = '8px';
        el.style.font = '14px/1.45 system-ui, sans-serif';
        el.style.whiteSpace = 'pre-wrap';
        el.style.boxShadow = '0 8px 24px rgba(0,0,0,.35)';
        body.appendChild(el);
    }
    el.textContent = String(text ?? '');
    if (kind === 'error') {
        el.style.background = '#3a1218';
        el.style.color = '#ffd0d6';
        el.style.border = '1px solid #d94f72';
    } else if (kind === 'ok') {
        el.style.background = '#12301c';
        el.style.color = '#d8ffe4';
        el.style.border = '1px solid #3d9a62';
        setTimeout(() => {
            if (el.isConnected && el.textContent === String(text ?? '')) {
                el.remove();
            }
        }, 4000);
    } else {
        el.style.background = '#1c2430';
        el.style.color = '#e8eef6';
        el.style.border = '1px solid #6a7d99';
    }
}
