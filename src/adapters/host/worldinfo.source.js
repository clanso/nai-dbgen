/**
 * L2 适配器 · getWorldInfoPrompt 隔离调用 + 作者注释快照/回滚（基线 §6.2）。
 * 归属：W1-B 宿主代理实现。W0 仅冻结签名。
 *
 * 底层签名保持 (scanInput, maxContext, globalScanData)。
 * HostPort.resolveWorldInfo 收到的 HostMessage[] 在 sillytavern.host 内
 * 按酒馆 world_info_include_names 决定是否带发言人名，再转成 scanInput 字符串数组
 * （裁决 D6：该判断属宿主知识，不上浮到 application）。
 *
 * 裁决 D21：只有真正快照过才恢复；API 不可用 / getContext 抛错时绝不碰 extensionPrompts。
 */

import { Ok, Err } from '../../infra/result.js';
import { hostError } from '../../infra/errors.js';

/** 作者注释 extension prompt 键（authors-note.js MODULE_NAME） */
export const NOTE_MODULE_NAME = '2_floating_prompt';

/**
 * 把 HostMessage[]（新→旧）编成 getWorldInfoPrompt 所需的字符串数组（最新在前）。
 * 不在此再 reverse：调用方窗口已是新→旧，与 script.js:4624 reverse 之后形态一致。
 *
 * @param {Array<{ name?: string, text?: string }>} contextWindow
 * @param {boolean} includeNames
 * @returns {string[]}
 */
export function buildWorldInfoScanInput(contextWindow, includeNames) {
    if (!Array.isArray(contextWindow)) {
        return [];
    }
    return contextWindow.map((m) => {
        const text = m && typeof m.text === 'string' ? m.text : '';
        if (includeNames) {
            const name = m && typeof m.name === 'string' ? m.name : '';
            return `${name}: ${text}`;
        }
        return text;
    });
}

/**
 * 深快照作者注释 extension prompt 条目（用于 dryRun 副作用回滚）。
 * @param {any} extensionPrompts
 * @returns {object|null} 存在则带 existed:true；调用前不存在则 null
 */
export function snapshotAuthorNotePrompt(extensionPrompts) {
    if (!extensionPrompts || typeof extensionPrompts !== 'object') {
        return null;
    }
    const entry = extensionPrompts[NOTE_MODULE_NAME];
    if (!entry || typeof entry !== 'object') {
        return null;
    }
    return {
        value: entry.value,
        position: entry.position,
        depth: entry.depth,
        scan: entry.scan,
        role: entry.role,
        filter: entry.filter,
        existed: true,
    };
}

/**
 * 恢复作者注释；若快照为 null（调用前不存在）则删除被 dryRun 写进去的条目。
 * **调用方必须仅在 didSnapshot===true 时调用**（裁决 D21）。
 * @param {any} ctx getContext()
 * @param {object|null} snapshot
 * @returns {void}
 */
export function restoreAuthorNotePrompt(ctx, snapshot) {
    if (!ctx) {
        return;
    }
    const prompts = ctx.extensionPrompts;
    if (snapshot && snapshot.existed) {
        if (typeof ctx.setExtensionPrompt === 'function') {
            ctx.setExtensionPrompt(
                NOTE_MODULE_NAME,
                snapshot.value ?? '',
                snapshot.position,
                snapshot.depth,
                snapshot.scan,
                snapshot.role,
                snapshot.filter,
            );
        } else if (prompts && typeof prompts === 'object') {
            prompts[NOTE_MODULE_NAME] = {
                value: String(snapshot.value ?? ''),
                position: Number(snapshot.position),
                depth: Number(snapshot.depth),
                scan: !!snapshot.scan,
                role: Number(snapshot.role ?? 0),
                filter: snapshot.filter ?? null,
            };
        }
        return;
    }
    if (prompts && Object.prototype.hasOwnProperty.call(prompts, NOTE_MODULE_NAME)) {
        delete prompts[NOTE_MODULE_NAME];
    }
}

/**
 * @param {object} deps
 * @param {() => any} deps.getContext
 * @returns {{
 *   resolve: (scanInput: string[], maxContext: number, globalScanData: object) => Promise<import('../../infra/result.js').Ok<string>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>,
 * }}
 */
export function createWorldInfoSource(deps) {
    const getContext = deps?.getContext;
    if (typeof getContext !== 'function') {
        throw new Error('invalid argument: deps.getContext');
    }

    /**
     * @param {string[]} scanInput
     * @param {number} maxContext
     * @param {object} globalScanData
     * @returns {Promise<import('../../infra/result.js').Ok<string>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>}
     */
    async function resolve(scanInput, maxContext, globalScanData) {
        /** @type {object|null} */
        let snapshot = null;
        /** 只有真正执行过快照才允许 restore（裁决 D21） */
        let didSnapshot = false;
        /** 快照时拿到的 ctx；finally 不再二次 getContext，避免恢复失败 */
        /** @type {any} */
        let ctxForRestore = null;

        try {
            const ctx = getContext();
            if (!ctx || typeof ctx.getWorldInfoPrompt !== 'function') {
                // 未快照 → finally 不碰 extensionPrompts
                return Err(hostError({
                    code: 'WORLDINFO_UNAVAILABLE',
                    message: '酒馆世界书 API 不可用',
                    hint: '请更新酒馆或检查扩展上下文',
                }));
            }

            ctxForRestore = ctx;
            snapshot = snapshotAuthorNotePrompt(ctx.extensionPrompts);
            didSnapshot = true;

            const chat = Array.isArray(scanInput) ? scanInput : [];
            const max = Number.isFinite(Number(maxContext)) ? Number(maxContext) : 0;
            const scanData = globalScanData && typeof globalScanData === 'object'
                ? globalScanData
                : { trigger: 'normal' };

            const result = await ctx.getWorldInfoPrompt(chat, max, /* isDryRun */ true, scanData);
            const worldInfoString = result && typeof result.worldInfoString === 'string'
                ? result.worldInfoString
                : '';
            return Ok(worldInfoString);
        } catch (cause) {
            return Err(hostError({
                code: 'WORLDINFO_RESOLVE_FAILED',
                message: '解析世界书失败',
                hint: '将按空世界书继续',
                cause,
                retryable: true,
            }));
        } finally {
            if (didSnapshot) {
                try {
                    restoreAuthorNotePrompt(ctxForRestore, snapshot);
                } catch {
                    // 回滚失败不能再抛，避免掩盖主错误
                }
            }
        }
    }

    return { resolve };
}
