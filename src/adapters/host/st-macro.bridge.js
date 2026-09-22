/**
 * L2 适配器 · 桥接宿主宏 substituteParams；并注册 {{naislot::n}} 等插件宏。
 * 归属：W1-B 宿主代理实现。W0 仅冻结签名。
 *
 * 结论（见交付报告）：本波 slot 骨架由展示期正则静态吐出，不依赖 {{naislot}}；
 * 中文变量由 domain 自备替换器处理。因此 registerMacros / unregisterMacros 为空操作。
 * 保留本模块的唯一实质能力是 runHostMacros（包一层 substituteParams）。
 */

/**
 * @param {object} deps
 * @param {() => any} deps.getContext
 * @param {(slotId: number) => string} [deps.renderSlotMacroHtml] 同步返回骨架/状态 HTML
 * @returns {{
 *   runHostMacros: (template: string) => string,
 *   registerMacros: () => void,
 *   unregisterMacros: () => void,
 * }}
 */
export function createStMacroBridge(deps) {
    const getContext = deps?.getContext;
    if (typeof getContext !== 'function') {
        throw new Error('invalid argument: deps.getContext');
    }

    /** @type {boolean} */
    let registered = false;

    /**
     * @param {string} template
     * @returns {string}
     */
    function runHostMacros(template) {
        if (typeof template !== 'string') {
            return '';
        }
        try {
            const ctx = getContext();
            if (ctx && typeof ctx.substituteParams === 'function') {
                return String(ctx.substituteParams(template) ?? '');
            }
        } catch {
            // 降级：原样返回
        }
        return template;
    }

    /**
     * 有意空操作：架构 §0.2 / §6.1 采用静态骨架，不需要向酒馆注册 naislot 宏。
     * 若将来改回宏驱动骨架，可在此用 ctx.macros.register('naislot', { handler })。
     * @returns {void}
     */
    function registerMacros() {
        if (registered) {
            return;
        }
        // 保留钩子：仅当调用方显式提供 renderSlotMacroHtml 时才注册（当前主路径不使用）。
        if (typeof deps.renderSlotMacroHtml !== 'function') {
            registered = true;
            return;
        }
        try {
            const ctx = getContext();
            const register = ctx?.macros?.register;
            if (typeof register !== 'function') {
                registered = true;
                return;
            }
            register('naislot', {
                description: 'nai-dbgen slot skeleton (optional)',
                handler: (macroCtx) => {
                    const raw = macroCtx?.args?.[0] ?? macroCtx?.unnamedArguments ?? '';
                    const slotId = Number(Array.isArray(raw) ? raw[0] : raw);
                    if (!Number.isInteger(slotId) || slotId < 1) {
                        return '';
                    }
                    return String(deps.renderSlotMacroHtml(slotId) ?? '');
                },
            });
            registered = true;
        } catch {
            registered = true;
        }
    }

    /**
     * @returns {void}
     */
    function unregisterMacros() {
        if (!registered) {
            return;
        }
        try {
            const ctx = getContext();
            const unregister = ctx?.macros?.registry?.unregisterMacro
                ?? ctx?.unregisterMacro;
            if (typeof unregister === 'function' && typeof deps.renderSlotMacroHtml === 'function') {
                unregister('naislot');
            }
        } catch {
            // ignore
        }
        registered = false;
    }

    return { runHostMacros, registerMacros, unregisterMacros };
}
