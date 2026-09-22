/**
 * L5 UI · slot 视觉态表（跨宿主重渲染存活）。
 * 归属：W2-G。
 *
 * 裁决 D35：本表**只恢复「生图中 / 失败」外观**，不承担防重复计费。
 * 计费互斥在 `RenderSlotUseCase`（isRendering / hasPendingWrite / execute 闸门）。
 *
 * 裁决 D36：键一律 `chatId:messageId:slotId`；切聊天清理其它聊天条目。
 */

/**
 * @typedef {object} SlotInflightEntry
 * @property {'generating'|'error'} status
 * @property {unknown} [error]
 * @property {string|null} [traceId]
 * @property {AbortController|null} controller
 * @property {Promise<unknown>|null} promise
 * @property {Set<(entry: SlotInflightEntry|null) => void>} watchers
 * @property {string|null} chatId
 */

/** @type {Map<string, SlotInflightEntry>} */
const visualInflight = new Map();

/**
 * @param {string|null|undefined} chatId
 * @param {number} messageId
 * @param {number} slotId
 * @returns {string}
 */
export function slotRuntimeKey(chatId, messageId, slotId) {
    const c = chatId == null || chatId === '' ? '_' : String(chatId);
    return `${c}:${Number(messageId)}:${Number(slotId)}`;
}

/**
 * @param {string|null|undefined} chatId
 * @param {number} messageId
 * @param {number} slotId
 * @returns {SlotInflightEntry|null}
 */
export function peekSlotInflight(chatId, messageId, slotId) {
    return visualInflight.get(slotRuntimeKey(chatId, messageId, slotId)) ?? null;
}

/**
 * @param {string|null|undefined} chatId
 * @param {number} messageId
 * @param {number} slotId
 * @param {(entry: SlotInflightEntry|null) => void} watcher
 * @returns {() => void}
 */
export function watchSlotInflight(chatId, messageId, slotId, watcher) {
    const key = slotRuntimeKey(chatId, messageId, slotId);
    const entry = visualInflight.get(key);
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
            // ignore
        }
    }
}

/**
 * 标记视觉「生图中」。若同键已 generating，附着既有条目（仍会走 onGenerateClick；
 * 计费互斥由应用层闸门保证，本表不拦截发起）。
 * @param {string|null|undefined} chatId
 * @param {number} messageId
 * @param {number} slotId
 * @returns {{ entry: SlotInflightEntry, created: boolean }}
 */
export function beginSlotInflight(chatId, messageId, slotId) {
    const key = slotRuntimeKey(chatId, messageId, slotId);
    const existing = visualInflight.get(key);
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
        watchers: existing ? existing.watchers : new Set(),
        chatId: chatId == null || chatId === '' ? null : String(chatId),
    };
    visualInflight.set(key, entry);
    return { entry, created: true };
}

/**
 * @param {string|null|undefined} chatId
 * @param {number} messageId
 * @param {number} slotId
 * @param {Promise<unknown>} promise
 */
export function attachSlotInflightPromise(chatId, messageId, slotId, promise) {
    const entry = peekSlotInflight(chatId, messageId, slotId);
    if (entry) {
        entry.promise = promise;
    }
}

/**
 * 视觉成功 / 闸门拒重出 / Abort：清本键视觉态。
 * @param {string|null|undefined} chatId
 * @param {number} messageId
 * @param {number} slotId
 */
export function resolveSlotInflightOk(chatId, messageId, slotId) {
    const key = slotRuntimeKey(chatId, messageId, slotId);
    const entry = visualInflight.get(key);
    if (!entry) {
        return;
    }
    visualInflight.delete(key);
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
 * 视觉失败：保留 error 供 remount（同 chat 内）。
 * @param {string|null|undefined} chatId
 * @param {number} messageId
 * @param {number} slotId
 * @param {unknown} error
 * @param {string|null} [traceId]
 */
export function resolveSlotInflightError(chatId, messageId, slotId, error, traceId) {
    const key = slotRuntimeKey(chatId, messageId, slotId);
    let entry = visualInflight.get(key);
    if (!entry) {
        entry = {
            status: 'error',
            error,
            traceId: traceId ?? null,
            controller: null,
            promise: null,
            watchers: new Set(),
            chatId: chatId == null || chatId === '' ? null : String(chatId),
        };
        visualInflight.set(key, entry);
    } else {
        entry.status = 'error';
        entry.error = error;
        entry.traceId = traceId ?? entry.traceId ?? null;
        entry.promise = null;
    }
    notifyWatchers(entry);
}

/**
 * @param {string|null|undefined} chatId
 * @param {number} messageId
 * @param {number} slotId
 */
export function resolveSlotInflightAbort(chatId, messageId, slotId) {
    resolveSlotInflightOk(chatId, messageId, slotId);
}

/**
 * D36：切聊天时清掉非当前 chat 的视觉条目（含常驻 error）。
 * @param {string|null|undefined} activeChatId
 * @returns {number} 删除条数
 */
export function clearSlotInflightOtherChats(activeChatId) {
    const keepPrefix = `${activeChatId == null || activeChatId === '' ? '_' : String(activeChatId)}:`;
    let removed = 0;
    for (const key of [...visualInflight.keys()]) {
        if (!key.startsWith(keepPrefix)) {
            const entry = visualInflight.get(key);
            visualInflight.delete(key);
            if (entry) {
                entry.watchers.clear();
            }
            removed += 1;
        }
    }
    return removed;
}

/**
 * 显式清除。三参清一键；无参清全表。
 * @param {string|null|undefined} [chatId]
 * @param {number} [messageId]
 * @param {number} [slotId]
 */
export function clearSlotInflight(chatId, messageId, slotId) {
    if (chatId === undefined && messageId === undefined && slotId === undefined) {
        for (const entry of visualInflight.values()) {
            entry.watchers.clear();
        }
        visualInflight.clear();
        return;
    }
    resolveSlotInflightOk(chatId, /** @type {number} */ (messageId), /** @type {number} */ (slotId));
}

/**
 * 本地视觉快照（喂给 deriveSlotUiView）。权威 busy 仍应优先问应用层闸门。
 * @param {string|null|undefined} chatId
 * @param {number} messageId
 * @param {number} slotId
 * @returns {{ status: 'generating'|'error'|undefined, error?: unknown, traceId?: string|null }}
 */
export function slotRuntimeSnapshot(chatId, messageId, slotId) {
    const entry = peekSlotInflight(chatId, messageId, slotId);
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

/**
 * 合并应用层闸门 + 本地视觉表 → 交给 deriveSlotUiView 的 runtime。
 * 优先级：应用层 busy（isRendering / hasPendingWrite）> 本地 error > 本地 generating。
 * @param {object} input
 * @param {string|null|undefined} input.chatId
 * @param {number} input.messageId
 * @param {number} input.slotId
 * @param {boolean} [input.appRendering]
 * @param {boolean} [input.appPendingWrite]
 * @returns {{ status: 'generating'|'error'|undefined, error?: unknown, traceId?: string|null }}
 */
export function resolveVisualRuntime(input) {
    if (input.appRendering || input.appPendingWrite) {
        return { status: 'generating' };
    }
    return slotRuntimeSnapshot(input.chatId, input.messageId, input.slotId);
}

/** @returns {number} 仅测试用 */
export function _inflightSizeForTest() {
    return visualInflight.size;
}

/** @returns {string[]} 仅测试用 */
export function _inflightKeysForTest() {
    return [...visualInflight.keys()];
}
