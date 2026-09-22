/**
 * L5 UI · button / field / toggle / range / chip 工厂。
 * 归属：W1-E 组件代理实现。W0 仅冻结签名。
 */

/**
 * @param {object} opts
 * @param {string} opts.label
 * @param {'primary'|'ghost'|'danger'|string} [opts.variant]
 * @param {() => void} [opts.onClick]
 * @returns {HTMLButtonElement}
 */
export function createButton(opts) {
    throw new Error('not implemented: createButton');
}

/**
 * @param {object} opts
 * @param {string} opts.label
 * @param {string} [opts.value]
 * @param {(v: string) => void} [opts.onChange]
 * @returns {{ el: HTMLElement, getValue: () => string, setValue: (v: string) => void, destroy: () => void }}
 */
export function createField(opts) {
    throw new Error('not implemented: createField');
}

/**
 * @param {object} opts
 * @param {string} opts.label
 * @param {boolean} [opts.checked]
 * @param {(v: boolean) => void} [opts.onChange]
 * @returns {{ el: HTMLElement, getValue: () => boolean, setValue: (v: boolean) => void, destroy: () => void }}
 */
export function createToggle(opts) {
    throw new Error('not implemented: createToggle');
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
    throw new Error('not implemented: createRange');
}

/**
 * @param {object} opts
 * @param {string} opts.label
 * @param {boolean} [opts.active]
 * @param {() => void} [opts.onClick]
 * @returns {HTMLButtonElement}
 */
export function createChip(opts) {
    throw new Error('not implemented: createChip');
}
