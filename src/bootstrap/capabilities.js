/**
 * L0 装配 · 宿主能力探测 → CapabilityReport（架构文档 §1 G5、基线 §12）。
 * 归属：W3-J 装配代理实现。
 *
 * 探测版本敏感能力；缺失项降级并供 UI 明示（中文 toast 由 lifecycle 负责）。
 */

/**
 * @typedef {import('../ports/index.d.ts').CapabilityReport} CapabilityReport
 */

/**
 * @param {() => any} getContext
 * @returns {any|null}
 */
function safeContext(getContext) {
    try {
        if (typeof getContext !== 'function') {
            return null;
        }
        return getContext();
    } catch {
        return null;
    }
}

/**
 * 启动期逐项探测版本敏感能力；缺失项降级并供 UI 明示。
 * @param {import('../ports/host.port.js').HostPort} host
 * @param {object} [opts]
 * @param {() => any} [opts.getContext]
 * @param {{ indexedDB?: boolean }} [opts.assume]
 *   装配已成功打开存储时可标记 indexedDB 可用（Node 测例 / 注入内存 IDB）
 * @returns {Promise<CapabilityReport>}
 */
export async function probeCapabilities(host, opts = {}) {
    /** @type {CapabilityReport['items']} */
    const items = [];
    const assume = opts.assume && typeof opts.assume === 'object' ? opts.assume : {};

    const getContext = typeof opts.getContext === 'function'
        ? opts.getContext
        : () => {
            try {
                return globalThis.SillyTavern?.getContext?.();
            } catch {
                return null;
            }
        };

    const ctx = safeContext(getContext);

    function push(id, available, detail) {
        items.push({
            id,
            available: !!available,
            ...(detail ? { detail: String(detail) } : {}),
        });
    }

    push(
        'getContext',
        !!ctx,
        ctx ? undefined : '找不到 SillyTavern.getContext，核心功能不可用',
    );

    push(
        'eventSource',
        !!(ctx?.eventSource && typeof ctx.eventSource.on === 'function'),
        '缺少 eventSource：自动生成提示词与聊天切换监听将不可用',
    );

    push(
        'extensionSettings',
        !!(ctx?.extensionSettings && typeof ctx.extensionSettings === 'object'),
        '缺少 extensionSettings：插件设置无法持久化',
    );

    push(
        'getWorldInfoPrompt',
        typeof ctx?.getWorldInfoPrompt === 'function',
        '缺少 getWorldInfoPrompt：世界书块将降级为空',
    );

    push(
        'slashCommands',
        !!(ctx?.SlashCommandParser && ctx?.SlashCommand),
        '缺少斜杠命令 API：/naigen 等命令不可用',
    );

    push(
        'popup',
        typeof ctx?.callGenericPopup === 'function' || typeof ctx?.Popup === 'function',
        '缺少 Popup：管理台将尝试原生 dialog 兜底',
    );

    push(
        'substituteParams',
        typeof ctx?.substituteParams === 'function',
        '缺少 substituteParams：预设宏替换将原样返回',
    );

    push(
        'chatCompletionService',
        typeof ctx?.ChatCompletionService === 'function'
            || typeof ctx?.ConnectionManagerRequestService === 'function',
        '缺少 ChatCompletionService：LLM 经酒馆转发不可用，请升级 SillyTavern',
    );

    const idbOk = assume.indexedDB === true
        || (typeof globalThis.indexedDB !== 'undefined'
            && typeof globalThis.indexedDB.open === 'function');
    push(
        'indexedDB',
        idbOk,
        '缺少浏览器图片缓存：楼层出图将无法缓存在本机',
    );

    // 基线 §12 / R-03：encode_tags 与 regex 扩展禁用
    let encodeTags = false;
    try {
        encodeTags = !!ctx?.powerUserSettings?.encode_tags;
    } catch {
        encodeTags = false;
    }
    push(
        'encode_tags_off',
        !encodeTags,
        encodeTags
            ? '已开启 encode_tags：正则生成的出图按钮会变成可见文本，无法正常使用'
            : undefined,
    );

    let regexExtEnabled = true;
    try {
        const disabled = ctx?.extensionSettings?.disabledExtensions;
        if (Array.isArray(disabled) && disabled.includes('regex')) {
            regexExtEnabled = false;
        }
    } catch {
        regexExtEnabled = true;
    }
    push(
        'regex_extension',
        regexExtEnabled,
        regexExtEnabled
            ? undefined
            : '正则扩展已禁用：楼层出图按钮与发历史时隐藏标记均不可用',
    );

    // HostPort 形状
    let hostPortOk = false;
    try {
        hostPortOk = !!(host
            && typeof host.getCurrentChatId === 'function'
            && typeof host.ensureSlotRegexInstalled === 'function'
            && typeof host.toast === 'function'
            && typeof host.dispose === 'function');
    } catch {
        hostPortOk = false;
    }
    push(
        'hostPort',
        hostPortOk,
        hostPortOk ? undefined : '插件宿主接口不完整，请更新插件',
    );

    const critical = ['getContext', 'indexedDB', 'hostPort'];
    const ok = items
        .filter((it) => critical.includes(it.id))
        .every((it) => it.available);

    return { ok, items };
}

/**
 * 把不可用项收成面向用户的中文摘要（空数组表示全部可用）。
 * @param {CapabilityReport} report
 * @returns {string[]}
 */
export function capabilityWarningMessages(report) {
    if (!report || !Array.isArray(report.items)) {
        return ['能力探测失败'];
    }
    return report.items
        .filter((it) => !it.available && it.detail)
        .map((it) => it.detail);
}
