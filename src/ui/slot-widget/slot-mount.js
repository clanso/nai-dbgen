/**
 * L5 UI · slot 进行中任务表（跨宿主重渲染存活，防重复计费）。
 * 归属：W2-G。
 *
 * 宿主重渲染会摧毁 DOM，但本表在模块作用域存活：
 * - remount 时若仍有 generating，只附着监听，不二次 onGenerateClick
 * - destroy 只退订本实例，不 abort 进行中的请求
 */

/**
 * @typedef {object} SlotInflightEntry
 * @property {'generating'|'error'} status
 * @property {unknown} [error]
 * @property {string|null} [traceId]
 * @property {AbortController|null} controller
 * @property {Promise<unknown>|null} promise
 * @property {Set<(entry: SlotInflightEntry|null) => void>} watchers
 */

/** @type {Map<string, SlotInflightEntry>} */
const inflight = new Map();

/**
 * @param {number} messageId
 * @param {number} slotId
 * @returns {string}
 */
export function slotRuntimeKey(messageId, slotId) {
    return `${Number(messageId)}:${Number(slotId)}`;
}

/**
 * @param {number} messageId
 * @param {number} slotId
 * @returns {SlotInflightEntry|null}
 */
export function peekSlotInflight(messageId, slotId) {
    return inflight.get(slotRuntimeKey(messageId, slotId)) ?? null;
}

/**
 * @param {number} messageId
 * @param {number} slotId
 * @param {(entry: SlotInflightEntry|null) => void} watcher
 * @returns {() => void} unwatch
 */
export function watchSlotInflight(messageId, slotId, watcher) {
    const key = slotRuntimeKey(messageId, slotId);
    const entry = inflight.get(key);
    if (!entry) {
        return () => {};
    }
    entry.watchers.add(watcher);
    return () => {
        entry.watchers.delete(watcher);
    };
}

/**
 * @param {SlotInflightEntry} entry
 */
function notifyWatchers(entry) {
    for (const fn of [...entry.watchers]) {
        try {
            fn(entry);
        } catch {
            // 单个订阅者异常不影响其它
        }
    }
}

/**
 * 开始或附着已有进行中任务。若已在 generating，返回既有条目（调用方不得再发起）。
 * @param {number} messageId
 * @param {number} slotId
 * @returns {{ entry: SlotInflightEntry, created: boolean }}
 */
export function beginSlotInflight(messageId, slotId) {
    const key = slotRuntimeKey(messageId, slotId);
    const existing = inflight.get(key);
    if (existing && existing.status === 'generating') {
        return { entry: existing, created: false };
    }

    /** @type {AbortController|null} */
    let controller = null;
    try {
        if (typeof AbortController === 'function') {
            controller = new AbortController();
        }
    } catch {
        controller = null;
    }

    /** @type {SlotInflightEntry} */
    const entry = {
        status: 'generating',
        error: undefined,
        traceId: null,
        controller,
        promise: null,
        watchers: new Set(),
    };
    inflight.set(key, entry);
    return { entry, created: true };
}

/**
 * @param {number} messageId
 * @param {number} slotId
 * @param {Promise<unknown>} promise
 */
export function attachSlotInflightPromise(messageId, slotId, promise) {
    const entry = peekSlotInflight(messageId, slotId);
    if (entry) {
        entry.promise = promise;
    }
}

/**
 * 成功：清表并通知（通常由 bus slot:rendered 或 Result.ok 触发）。
 * @param {number} messageId
 * @param {number} slotId
 */
export function resolveSlotInflightOk(messageId, slotId) {
    const key = slotRuntimeKey(messageId, slotId);
    const entry = inflight.get(key);
    if (!entry) {
        return;
    }
    inflight.delete(key);
    for (const fn of [...entry.watchers]) {
        try {
            fn(null);
        } catch {
            // ignore
        }
    }
    entry.watchers.clear();
}

/**
 * 失败：保留 error 快照供 remount 恢复 error 态，直到下次 begin 或 clear。
 * @param {number} messageId
 * @param {number} slotId
 * @param {unknown} error
 * @param {string|null} [traceId]
 */
export function resolveSlotInflightError(messageId, slotId, error, traceId) {
    const key = slotRuntimeKey(messageId, slotId);
    let entry = inflight.get(key);
    if (!entry) {
        entry = {
            status: 'error',
            error,
            traceId: traceId ?? null,
            controller: null,
            promise: null,
            watchers: new Set(),
        };
        inflight.set(key, entry);
    } else {
        entry.status = 'error';
        entry.error = error;
        entry.traceId = traceId ?? entry.traceId ?? null;
        entry.promise = null;
    }
    notifyWatchers(entry);
}

/**
 * Abort：清表，不留 error（恢复为按 record 推导的 idle/done）。
 * @param {number} messageId
 * @param {number} slotId
 */
export function resolveSlotInflightAbort(messageId, slotId) {
    resolveSlotInflightOk(messageId, slotId);
}

/**
 * 显式清除（测试 / dispose 整插件时）。
 * @param {number} [messageId]
 * @param {number} [slotId]
 */
export function clearSlotInflight(messageId, slotId) {
    if (messageId == null || slotId == null) {
        for (const entry of inflight.values()) {
            entry.watchers.clear();
        }
        inflight.clear();
        return;
    }
    resolveSlotInflightOk(messageId, slotId);
}

/**
 * 运行时快照（喂给 deriveSlotUiView）。
 * @param {number} messageId
 * @param {number} slotId
 * @returns {{ status: 'generating'|'error'|undefined, error?: unknown, traceId?: string|null }}
 */
export function slotRuntimeSnapshot(messageId, slotId) {
    const entry = peekSlotInflight(messageId, slotId);
    if (!entry) {
        return { status: undefined };
    }
    if (entry.status === 'generating') {
        return { status: 'generating', traceId: entry.traceId };
    }
    return {
        status: 'error',
        error: entry.error,
        traceId: entry.traceId,
    };
}

/** @returns {number} 仅测试用 */
export function _inflightSizeForTest() {
    return inflight.size;
}
