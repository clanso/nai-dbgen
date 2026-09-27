/** Workbench prompt textareas: copy action and paired native vertical resize. */
let nextPromptId = 0;

/**
 * @param {{ label: string, value?: string, rows?: number, onChange?: (value: string) => void, onCopyError?: (error: unknown) => void }} opts
 */
export function createPromptTextarea(opts) {
    const root = document.createElement('div');
    root.className = 'nd-field nd-wb-prompt-field';
    const label = document.createElement('label');
    label.className = 'nd-field__label';
    label.textContent = String(opts.label ?? '');
    const id = `nd-wb-prompt-${++nextPromptId}`;
    label.setAttribute('for', id);

    const wrap = document.createElement('div');
    wrap.className = 'nd-wb-prompt-input';
    const input = document.createElement('textarea');
    input.className = 'nd-textarea';
    input.id = id;
    input.setAttribute('aria-label', label.textContent);
    input.rows = opts.rows ?? 4;
    input.value = String(opts.value ?? '');

    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'nd-wb-prompt-copy';
    copy.title = '复制提示词';
    copy.setAttribute('aria-label', `复制${label.textContent}`);
    const svgNode = (name) => typeof document.createElementNS === 'function'
        ? document.createElementNS('http://www.w3.org/2000/svg', name)
        : document.createElement(name);
    const svg = svgNode('svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '15');
    svg.setAttribute('height', '15');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const back = svgNode('path');
    back.setAttribute('d', 'M8 4h9a2 2 0 0 1 2 2v10');
    const front = svgNode('rect');
    front.setAttribute('x', '5');
    front.setAttribute('y', '7');
    front.setAttribute('width', '12');
    front.setAttribute('height', '13');
    front.setAttribute('rx', '2');
    svg.append(back, front);
    copy.appendChild(svg);
    wrap.append(input, copy);
    root.append(label, wrap);

    const onInput = () => opts.onChange?.(input.value);
    const onCopy = async (event) => {
        event.preventDefault();
        event.stopPropagation?.();
        try {
            const clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : null;
            if (typeof clipboard?.writeText !== 'function') throw new Error('clipboard unavailable');
            await clipboard.writeText(input.value);
        } catch (error) {
            opts.onCopyError?.(error);
        }
    };
    input.addEventListener('input', onInput);
    copy.addEventListener('click', onCopy);
    return {
        el: root,
        input,
        getValue: () => input.value,
        setValue: (value) => { input.value = String(value ?? ''); },
        destroy() {
            input.removeEventListener('input', onInput);
            copy.removeEventListener('click', onCopy);
            root.remove();
        },
    };
}

/** Mirror native textarea drag height to the other prompt in its pair. */
export function linkTextareaHeights(first, second) {
    if (typeof ResizeObserver !== 'function') return () => {};
    const heights = new WeakMap();
    const observer = new ResizeObserver((entries) => {
        for (const entry of entries) {
            const source = entry.target;
            const height = source.getBoundingClientRect().height;
            const previous = heights.get(source);
            heights.set(source, height);
            if (previous == null || Math.abs(previous - height) < 0.5) continue;
            const peer = source === first ? second : first;
            const next = source.style.height || getComputedStyle(source).height;
            if (next && peer.style.height !== next) {
                peer.style.height = next;
                heights.set(peer, peer.getBoundingClientRect().height);
            }
        }
    });
    observer.observe(first);
    observer.observe(second);
    return () => observer.disconnect();
}
