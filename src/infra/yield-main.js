/**
 * L1 · 让出主线程一次。
 * 前台（可见页）用 setTimeout(0)：与历史路径一致；Chrome 对嵌套
 * setTimeout(0) 约 4ms 下限，给大图解码/GC/绘制留出空隙。
 * 后台（document.hidden）用 MessageChannel：避免后台定时器被节流到 ≥1s。
 * 无 MessageChannel / 非 DOM 环境一律 setTimeout(0)。
 */

/**
 * @returns {Promise<void>}
 */
export function yieldMain() {
    return new Promise((resolve) => {
        const preferChannel = typeof document !== 'undefined'
            && document.hidden
            && typeof MessageChannel === 'function';

        if (preferChannel) {
            const { port1, port2 } = new MessageChannel();
            port1.onmessage = () => {
                port1.close();
                port2.close();
                resolve();
            };
            port2.postMessage(undefined);
            return;
        }
        setTimeout(resolve, 0);
    });
}
