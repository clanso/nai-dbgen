/**
 * 极简假 DOM（无第三方依赖）。供 mount* 生命周期测试。
 */

/**
 * @returns {{
 *   document: Document & { _docListeners: { type: string, fn: Function }[] },
 *   restore: () => void,
 * }}
 */
export function installFakeDom() {
    /** @type {{ type: string, fn: Function, opts?: unknown }[]} */
    const docListeners = [];

    class FakeNode {
        constructor() {
            /** @type {FakeNode[]} */
            this.childNodes = [];
            /** @type {FakeNode|null} */
            this.parentNode = null;
        }

        /**
         * @param {FakeNode} other
         * @returns {boolean}
         */
        contains(other) {
            if (other === this) return true;
            for (const child of this.childNodes) {
                if (child === other || child.contains(other)) return true;
            }
            return false;
        }

        /**
         * @param {FakeNode} child
         * @returns {FakeNode}
         */
        appendChild(child) {
            if (child.parentNode) {
                child.parentNode.removeChild(child);
            }
            child.parentNode = this;
            this.childNodes.push(child);
            return child;
        }

        /**
         * @param {FakeNode} child
         * @returns {FakeNode}
         */
        removeChild(child) {
            const i = this.childNodes.indexOf(child);
            if (i >= 0) this.childNodes.splice(i, 1);
            child.parentNode = null;
            return child;
        }

        remove() {
            if (this.parentNode) {
                this.parentNode.removeChild(this);
            }
        }
    }

    class FakeElement extends FakeNode {
        /**
         * @param {string} tag
         */
        constructor(tag) {
            super();
            this.tagName = String(tag).toUpperCase();
            this.className = '';
            /** @type {Record<string, string>} */
            this.style = {};
            /** @type {Map<string, string>} */
            this.attributes = new Map();
            /** @type {{ type: string, fn: Function, opts?: unknown }[]} */
            this._listeners = [];
            this.value = '';
            this.hidden = false;
            this.scrollTop = 0;
            this.clientHeight = 200;
            /** @type {Record<string, string>} */
            this.dataset = {};
            this.isConnected = true;
            this.checked = false;
            this.type = '';
            this.disabled = false;
            /** @type {string} */
            this._text = '';
            /** @type {FakeElement[]} */
            this.options = [];
            this.selectedIndex = 0;
            this.files = null;
            this.rows = 0;
            this.placeholder = '';
            this.autocomplete = '';
            this.href = '';
            this.download = '';
            this.rel = '';
            this.alt = '';
            this.src = '';
            this.id = '';

            const self = this;
            this.classList = {
                /**
                 * @param {...string} tokens
                 */
                add(...tokens) {
                    const set = new Set(String(self.className || '').split(/\s+/).filter(Boolean));
                    for (const t of tokens) set.add(String(t));
                    self.className = [...set].join(' ');
                },
                /**
                 * @param {...string} tokens
                 */
                remove(...tokens) {
                    const set = new Set(String(self.className || '').split(/\s+/).filter(Boolean));
                    for (const t of tokens) set.delete(String(t));
                    self.className = [...set].join(' ');
                },
                /**
                 * @param {string} token
                 * @param {boolean} [force]
                 * @returns {boolean}
                 */
                toggle(token, force) {
                    const set = new Set(String(self.className || '').split(/\s+/).filter(Boolean));
                    const has = set.has(token);
                    const on = force === undefined ? !has : Boolean(force);
                    if (on) set.add(token);
                    else set.delete(token);
                    self.className = [...set].join(' ');
                    return on;
                },
                /**
                 * @param {string} token
                 * @returns {boolean}
                 */
                contains(token) {
                    return String(self.className || '').split(/\s+/).includes(token);
                },
            };
        }

        /**
         * @param {...FakeNode|string} nodes
         */
        append(...nodes) {
            for (const n of nodes) {
                if (typeof n === 'string') {
                    const text = new FakeElement('#text');
                    text.textContent = n;
                    this.appendChild(text);
                } else if (n) {
                    this.appendChild(n);
                }
            }
        }

        get textContent() {
            return this._text;
        }

        set textContent(v) {
            this._text = v == null ? '' : String(v);
        }

        /**
         * @param {string} k
         * @param {string} v
         */
        setAttribute(k, v) {
            this.attributes.set(k, String(v));
        }

        /**
         * @param {string} k
         * @returns {string|null}
         */
        getAttribute(k) {
            return this.attributes.has(k) ? this.attributes.get(k) : null;
        }

        /**
         * @param {string} type
         * @param {Function} fn
         * @param {unknown} [opts]
         */
        addEventListener(type, fn, opts) {
            this._listeners.push({ type, fn, opts });
        }

        /**
         * @param {string} type
         * @param {Function} fn
         */
        removeEventListener(type, fn) {
            this._listeners = this._listeners.filter(
                (l) => !(l.type === type && l.fn === fn),
            );
        }

        /**
         * @param {string} [type]
         * @returns {number}
         */
        listenerCount(type) {
            if (type == null) return this._listeners.length;
            return this._listeners.filter((l) => l.type === type).length;
        }

        /**
         * @param {...FakeNode} nodes
         */
        replaceChildren(...nodes) {
            for (const c of [...this.childNodes]) {
                this.removeChild(c);
            }
            for (const n of nodes) {
                this.appendChild(n);
            }
        }

        click() {}

        /**
         * @param {string} sel
         * @returns {FakeElement|null}
         */
        closest(sel) {
            /** @type {FakeElement|null} */
            let node = this;
            while (node) {
                if (matchesSelector(node, sel)) return node;
                node = /** @type {FakeElement|null} */ (node.parentNode);
            }
            return null;
        }

        /**
         * @param {string} _sel
         * @returns {null}
         */
        querySelector(_sel) {
            return null;
        }

        after(node) {
            if (!this.parentNode) return;
            const siblings = this.parentNode.childNodes;
            const i = siblings.indexOf(this);
            if (node.parentNode) node.parentNode.removeChild(node);
            node.parentNode = this.parentNode;
            siblings.splice(i + 1, 0, node);
        }
    }

    /**
     * @param {FakeElement} el
     * @param {string} sel
     * @returns {boolean}
     */
    function matchesSelector(el, sel) {
        const s = String(sel || '');
        if (s.startsWith('.')) {
            return el.classList.contains(s.slice(1));
        }
        if (s.startsWith('#')) {
            return el.id === s.slice(1);
        }
        return el.tagName === s.toUpperCase();
    }

    const prev = {
        document: globalThis.document,
        Element: globalThis.Element,
        HTMLElement: globalThis.HTMLElement,
        HTMLButtonElement: globalThis.HTMLButtonElement,
        HTMLInputElement: globalThis.HTMLInputElement,
        HTMLSelectElement: globalThis.HTMLSelectElement,
        HTMLTextAreaElement: globalThis.HTMLTextAreaElement,
        HTMLDialogElement: globalThis.HTMLDialogElement,
        HTMLLabelElement: globalThis.HTMLLabelElement,
        Node: globalThis.Node,
        Document: globalThis.Document,
    };

    globalThis.Node = FakeNode;
    globalThis.Element = FakeElement;
    globalThis.HTMLElement = FakeElement;
    globalThis.HTMLButtonElement = FakeElement;
    globalThis.HTMLInputElement = FakeElement;
    globalThis.HTMLSelectElement = FakeElement;
    globalThis.HTMLTextAreaElement = FakeElement;
    globalThis.HTMLDialogElement = FakeElement;
    globalThis.HTMLLabelElement = FakeElement;

    const body = new FakeElement('body');
    const document = {
        body,
        createElement(tag) {
            return new FakeElement(tag);
        },
        getElementById() {
            return null;
        },
        /**
         * @param {string} type
         * @param {Function} fn
         * @param {unknown} [opts]
         */
        addEventListener(type, fn, opts) {
            docListeners.push({ type, fn, opts });
        },
        /**
         * @param {string} type
         * @param {Function} fn
         */
        removeEventListener(type, fn) {
            const i = docListeners.findIndex((l) => l.type === type && l.fn === fn);
            if (i >= 0) docListeners.splice(i, 1);
        },
        _docListeners: docListeners,
    };

    globalThis.document = document;

    return {
        document,
        restore() {
            for (const [key, value] of Object.entries(prev)) {
                if (value === undefined) {
                    delete globalThis[key];
                } else {
                    globalThis[key] = value;
                }
            }
        },
    };
}
