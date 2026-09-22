/**
 * L5 UI · 标签库长列表虚拟化。
 * 归属：W1-E 组件代理实现。W0 仅冻结签名。
 */

/**
 * 定高行可见区间（纯函数，可供单测）。
 * @param {object} args
 * @param {number} args.scrollTop
 * @param {number} args.viewHeight
 * @param {number} args.rowHeight
 * @param {number} args.total
 * @param {number} [args.overscan=4]
 * @returns {{ start: number, end: number }}
 */
export function computeVisibleRange(args) {
    const rowHeight = Math.max(1, Number(args.rowHeight) || 1);
    const total = Math.max(0, Math.floor(Number(args.total) || 0));
    const overscan = Math.max(0, Math.floor(args.overscan ?? 4));
    const scrollTop = Math.max(0, Number(args.scrollTop) || 0);
    const viewHeight = Math.max(0, Number(args.viewHeight) || 0);

    if (total === 0) {
        return { start: 0, end: 0 };
    }

    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const visible = Math.ceil(viewHeight / rowHeight) + overscan * 2;
    const end = Math.min(total, start + Math.max(visible, 1));
    return { start, end };
}

/**
 * @param {Element} root
 * @param {object} deps
 * @param {() => object[]} deps.getItems
 * @param {(item: object, el: HTMLElement) => void} deps.renderRow
 * @param {number} [deps.rowHeight=36]
 * @returns {{ destroy: () => void, refresh: () => void }}
 */
export function mountVirtualList(root, deps) {
    if (!(root instanceof Element)) {
        throw new Error('mountVirtualList: root must be an Element');
    }
    const getItems = typeof deps?.getItems === 'function' ? deps.getItems : () => [];
    const renderRow = typeof deps?.renderRow === 'function' ? deps.renderRow : () => {};
    const rowHeight = Math.max(1, Number(deps?.rowHeight) || 36);

    const host = document.createElement('div');
    host.className = 'nd-virtual-list';
    host.style.height = '100%';
    host.style.minHeight = `${rowHeight * 6}px`;

    const spacer = document.createElement('div');
    spacer.className = 'nd-virtual-list__spacer';

    const windowEl = document.createElement('div');
    windowEl.className = 'nd-virtual-list__window';

    spacer.appendChild(windowEl);
    host.appendChild(spacer);
    root.appendChild(host);

    /** @type {HTMLElement[]} */
    const rowPool = [];
    let destroyed = false;

    function ensurePool(size) {
        while (rowPool.length < size) {
            const row = document.createElement('div');
            row.className = 'nd-virtual-list__row';
            row.style.height = `${rowHeight}px`;
            rowPool.push(row);
            windowEl.appendChild(row);
        }
        while (rowPool.length > size) {
            const row = rowPool.pop();
            row?.remove();
        }
    }

    function paint() {
        if (destroyed) {
            return;
        }
        const items = getItems() || [];
        const total = items.length;
        spacer.style.height = `${total * rowHeight}px`;

        const { start, end } = computeVisibleRange({
            scrollTop: host.scrollTop,
            viewHeight: host.clientHeight,
            rowHeight,
            total,
        });

        const count = Math.max(0, end - start);
        ensurePool(count);
        windowEl.style.transform = `translateY(${start * rowHeight}px)`;

        for (let i = 0; i < count; i += 1) {
            const row = rowPool[i];
            const item = items[start + i];
            row.replaceChildren();
            if (item != null) {
                renderRow(item, row);
            }
        }
    }

    const onScroll = () => {
        paint();
    };

    host.addEventListener('scroll', onScroll, { passive: true });
    paint();

    return {
        refresh() {
            paint();
        },
        destroy() {
            if (destroyed) {
                return;
            }
            destroyed = true;
            host.removeEventListener('scroll', onScroll);
            host.remove();
            rowPool.length = 0;
        },
    };
}
