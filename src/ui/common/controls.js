/**
 * L5 UI · button / field / toggle / range / chip 工厂。
 * 归属：W1-E 组件代理实现。W0 仅冻结签名。
 */

import { t } from '../i18n/zh-CN.js';

/**
 * @param {string} tag
 * @param {string} [className]
 * @returns {HTMLElement}
 */
function el(tag, className) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    return node;
}

/**
 * @param {HTMLElement} node
 * @param {string} text
 */
function setText(node, text) {
    node.textContent = text == null ? '' : String(text);
}

/**
 * @param {object} opts
 * @param {string} opts.label
 * @param {'primary'|'ghost'|'danger'|string} [opts.variant]
 * @param {() => void} [opts.onClick]
 * @returns {HTMLButtonElement}
 */
export function createButton(opts) {
    const label = opts?.label != null ? String(opts.label) : '';
    const variant = opts?.variant != null ? String(opts.variant) : 'ghost';
    /** @type {HTMLButtonElement} */
    const btn = /** @type {HTMLButtonElement} */ (el('button', 'nd-button'));
    btn.type = 'button';
    setText(btn, label);

    if (variant === 'primary') {
        btn.classList.add('nd-button--primary');
    } else if (variant === 'danger') {
        btn.classList.add('nd-button--danger');
    } else if (variant === 'icon') {
        btn.className = 'nd-icon-button';
    } else if (variant === 'text') {
        btn.className = 'nd-text-button';
    } else {
        btn.classList.add('nd-button--ghost');
    }

    if (typeof opts?.onClick === 'function') {
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            opts.onClick();
        });
    }
    return btn;
}

/**
 * @param {object} opts
 * @param {string} opts.label
 * @param {string} [opts.value]
 * @param {(v: string) => void} [opts.onChange]
 * @returns {{ el: HTMLElement, getValue: () => string, setValue: (v: string) => void, destroy: () => void }}
 */
export function createField(opts) {
    const root = el('label', 'nd-field');
    const labelEl = el('span', 'nd-field__label');
    setText(labelEl, opts?.label != null ? String(opts.label) : '');
    /** @type {HTMLInputElement} */
    const input = /** @type {HTMLInputElement} */ (el('input', 'nd-input'));
    input.type = 'text';
    input.value = opts?.value != null ? String(opts.value) : '';

    /** @type {(v: string) => void} */
    const onChange = typeof opts?.onChange === 'function' ? opts.onChange : () => {};
    const handler = () => onChange(input.value);
    input.addEventListener('input', handler);

    root.append(labelEl, input);
    return {
        el: root,
        getValue: () => input.value,
        setValue: (v) => {
            input.value = v == null ? '' : String(v);
        },
        destroy: () => {
            input.removeEventListener('input', handler);
            root.remove();
        },
    };
}

/**
 * @param {object} opts
 * @param {string} opts.label
 * @param {boolean} [opts.checked]
 * @param {(v: boolean) => void} [opts.onChange]
 * @returns {{ el: HTMLElement, getValue: () => boolean, setValue: (v: boolean) => void, destroy: () => void }}
 */
export function createToggle(opts) {
    const root = /** @type {HTMLLabelElement} */ (el('label', 'nd-toggle-row'));
    const text = el('span', 'nd-toggle-row__text');
    const strong = el('strong');
    setText(strong, opts?.label != null ? String(opts.label) : '');
    text.appendChild(strong);

    /** @type {HTMLInputElement} */
    const input = /** @type {HTMLInputElement} */ (el('input'));
    input.type = 'checkbox';
    input.checked = Boolean(opts?.checked);
    const track = el('i');

    /** @type {(v: boolean) => void} */
    const onChange = typeof opts?.onChange === 'function' ? opts.onChange : () => {};
    const handler = () => onChange(input.checked);
    input.addEventListener('change', handler);

    root.append(text, input, track);
    return {
        el: root,
        getValue: () => input.checked,
        setValue: (v) => {
            input.checked = Boolean(v);
        },
        destroy: () => {
            input.removeEventListener('change', handler);
            root.remove();
        },
    };
}

/**
 * @param {object} opts
 * @param {string} opts.label
 * @param {number} opts.min
 * @param {number} opts.max
 * @param {number} [opts.value]
 * @param {(v: number) => void} [opts.onChange]
 * @returns {{ el: HTMLElement, getValue: () => number, setValue: (v: number) => void, destroy: () => void }}
 */
export function createRange(opts) {
    const min = Number(opts?.min);
    const max = Number(opts?.max);
    const initial = opts?.value != null ? Number(opts.value) : min;

    const root = el('label', 'nd-range-label');
    const head = el('span');
    const title = el('span');
    setText(title, opts?.label != null ? String(opts.label) : '');
    const output = el('output');
    setText(output, String(initial));
    head.append(title, output);

    /** @type {HTMLInputElement} */
    const input = /** @type {HTMLInputElement} */ (el('input', 'nd-range'));
    input.type = 'range';
    input.min = String(min);
    input.max = String(max);
    input.value = String(initial);

    /** @type {(v: number) => void} */
    const onChange = typeof opts?.onChange === 'function' ? opts.onChange : () => {};
    const handler = () => {
        const n = Number(input.value);
        setText(output, String(n));
        onChange(n);
    };
    input.addEventListener('input', handler);

    root.append(head, input);
    return {
        el: root,
        getValue: () => Number(input.value),
        setValue: (v) => {
            const n = Number(v);
            input.value = String(n);
            setText(output, String(n));
        },
        destroy: () => {
            input.removeEventListener('input', handler);
            root.remove();
        },
    };
}

/**
 * @param {object} opts
 * @param {string} opts.label
 * @param {boolean} [opts.active]
 * @param {() => void} [opts.onClick]
 * @returns {HTMLButtonElement}
 */
export function createChip(opts) {
    /** @type {HTMLButtonElement} */
    const btn = /** @type {HTMLButtonElement} */ (el('button', 'nd-chip'));
    btn.type = 'button';
    setText(btn, opts?.label != null ? String(opts.label) : '');
    if (opts?.active) {
        btn.classList.add('is-active');
    }
    if (typeof opts?.onClick === 'function') {
        btn.addEventListener('click', (event) => {
            event.preventDefault();
            opts.onClick();
        });
    }
    return btn;
}

/**
 * @param {object} opts
 * @param {string} opts.label
 * @param {number} [opts.value]
 * @param {number} [opts.min]
 * @param {number} [opts.max]
 * @param {number} [opts.step]
 * @param {(v: number) => void} [opts.onChange]
 * @returns {{ el: HTMLElement, getValue: () => number, setValue: (v: number) => void, destroy: () => void }}
 */
export function createNumberField(opts) {
    const root = el('label', 'nd-field');
    const labelEl = el('span', 'nd-field__label');
    setText(labelEl, opts?.label != null ? String(opts.label) : '');
    /** @type {HTMLInputElement} */
    const input = /** @type {HTMLInputElement} */ (el('input', 'nd-input'));
    input.type = 'number';
    if (opts?.min != null) input.min = String(opts.min);
    if (opts?.max != null) input.max = String(opts.max);
    if (opts?.step != null) input.step = String(opts.step);
    input.value = opts?.value != null ? String(opts.value) : '';

    /** @type {(v: number) => void} */
    const onChange = typeof opts?.onChange === 'function' ? opts.onChange : () => {};
    const handler = () => onChange(Number(input.value));
    input.addEventListener('input', handler);

    root.append(labelEl, input);
    return {
        el: root,
        getValue: () => Number(input.value),
        setValue: (v) => {
            input.value = v == null ? '' : String(v);
        },
        destroy: () => {
            input.removeEventListener('input', handler);
            root.remove();
        },
    };
}

/**
 * @param {object} opts
 * @param {string} opts.label
 * @param {{ value: string, label: string }[]} opts.options
 * @param {string} [opts.value]
 * @param {(v: string) => void} [opts.onChange]
 * @returns {{ el: HTMLElement, getValue: () => string, setValue: (v: string) => void, destroy: () => void }}
 */
export function createSelect(opts) {
    const root = el('label', 'nd-field');
    const labelEl = el('span', 'nd-field__label');
    setText(labelEl, opts?.label != null ? String(opts.label) : '');
    /** @type {HTMLSelectElement} */
    const select = /** @type {HTMLSelectElement} */ (el('select', 'nd-select'));
    const options = Array.isArray(opts?.options) ? opts.options : [];
    for (const item of options) {
        const option = document.createElement('option');
        option.value = String(item.value);
        setText(option, item.label != null ? String(item.label) : String(item.value));
        select.appendChild(option);
    }
    if (opts?.value != null) {
        select.value = String(opts.value);
    }

    /** @type {(v: string) => void} */
    const onChange = typeof opts?.onChange === 'function' ? opts.onChange : () => {};
    const handler = () => onChange(select.value);
    select.addEventListener('change', handler);

    root.append(labelEl, select);
    return {
        el: root,
        getValue: () => select.value,
        setValue: (v) => {
            select.value = v == null ? '' : String(v);
        },
        destroy: () => {
            select.removeEventListener('change', handler);
            root.remove();
        },
    };
}

/**
 * @param {object} opts
 * @param {string} opts.label
 * @param {boolean} [opts.checked]
 * @param {(v: boolean) => void} [opts.onChange]
 * @returns {{ el: HTMLElement, getValue: () => boolean, setValue: (v: boolean) => void, destroy: () => void }}
 */
export function createCheckbox(opts) {
    const root = /** @type {HTMLLabelElement} */ (el('label', 'nd-checkbox-row'));
    /** @type {HTMLInputElement} */
    const input = /** @type {HTMLInputElement} */ (el('input'));
    input.type = 'checkbox';
    input.checked = Boolean(opts?.checked);
    const text = el('span');
    setText(text, opts?.label != null ? String(opts.label) : '');

    /** @type {(v: boolean) => void} */
    const onChange = typeof opts?.onChange === 'function' ? opts.onChange : () => {};
    const handler = () => onChange(input.checked);
    input.addEventListener('change', handler);

    root.append(input, text);
    return {
        el: root,
        getValue: () => input.checked,
        setValue: (v) => {
            input.checked = Boolean(v);
        },
        destroy: () => {
            input.removeEventListener('change', handler);
            root.remove();
        },
    };
}

/**
 * @param {object} opts
 * @param {string} [opts.title]
 * @param {HTMLElement[]} [opts.children]
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function createFieldGroup(opts) {
    const root = el('div', 'nd-field-group');
    if (opts?.title) {
        const title = el('h4', 'nd-field-group__title');
        setText(title, String(opts.title));
        root.appendChild(title);
    }
    const children = Array.isArray(opts?.children) ? opts.children : [];
    for (const child of children) {
        if (child instanceof HTMLElement) {
            root.appendChild(child);
        }
    }
    return {
        el: root,
        destroy: () => {
            root.remove();
        },
    };
}

/**
 * @param {object} opts
 * @param {string} opts.summary
 * @param {HTMLElement|HTMLElement[]} [opts.body]
 * @param {boolean} [opts.open]
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function createDetails(opts) {
    /** @type {HTMLDetailsElement} */
    const root = /** @type {HTMLDetailsElement} */ (el('details', 'nd-details'));
    root.open = Boolean(opts?.open);
    const summary = el('summary');
    setText(summary, opts?.summary != null ? String(opts.summary) : '');
    const body = el('div', 'nd-details__body');
    const content = opts?.body;
    if (Array.isArray(content)) {
        for (const child of content) {
            if (child instanceof HTMLElement) body.appendChild(child);
        }
    } else if (content instanceof HTMLElement) {
        body.appendChild(content);
    }
    root.append(summary, body);
    return {
        el: root,
        destroy: () => {
            root.remove();
        },
    };
}

/**
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} [opts.description]
 * @param {HTMLElement} [opts.action]
 * @returns {{ el: HTMLElement, destroy: () => void }}
 */
export function createEmptyState(opts) {
    const root = el('div', 'nd-empty');
    const title = el('h2', 'nd-empty__title');
    setText(title, opts?.title != null ? String(opts.title) : t('empty.title'));
    root.appendChild(title);
    if (opts?.description) {
        const desc = el('p', 'nd-empty__desc');
        setText(desc, String(opts.description));
        root.appendChild(desc);
    }
    if (opts?.action instanceof HTMLElement) {
        root.appendChild(opts.action);
    }
    return {
        el: root,
        destroy: () => {
            root.remove();
        },
    };
}

/**
 * @param {object} opts
 * @param {string} opts.label
 * @param {'idle'|'online'|'error'} [opts.status]
 * @returns {{ el: HTMLElement, setStatus: (s: 'idle'|'online'|'error') => void, setLabel: (s: string) => void, destroy: () => void }}
 */
export function createStatusPill(opts) {
    const root = el('div', 'nd-status-pill');
    const dot = el('i');
    const text = el('span');
    setText(text, opts?.label != null ? String(opts.label) : '');
    root.append(dot, text);

    /**
     * @param {'idle'|'online'|'error'} status
     */
    function setStatus(status) {
        root.classList.remove('is-online', 'is-error');
        if (status === 'online') root.classList.add('is-online');
        if (status === 'error') root.classList.add('is-error');
    }
    setStatus(opts?.status || 'idle');

    return {
        el: root,
        setStatus,
        setLabel: (s) => setText(text, s == null ? '' : String(s)),
        destroy: () => {
            root.remove();
        },
    };
}

/**
 * @param {object} [opts]
 * @param {string} [opts.message]
 * @returns {{ el: HTMLElement, setMessage: (msg: string) => void, clear: () => void, destroy: () => void }}
 */
export function createInlineError(opts) {
    const root = el('div', 'nd-inline-error');
    root.setAttribute('role', 'alert');
    root.setAttribute('aria-live', 'polite');
    setText(root, opts?.message != null ? String(opts.message) : '');
    return {
        el: root,
        setMessage: (msg) => setText(root, msg == null ? '' : String(msg)),
        clear: () => setText(root, ''),
        destroy: () => {
            root.remove();
        },
    };
}
