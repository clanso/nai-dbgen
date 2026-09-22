/**
 * L2 契约 · HostPort —— 插件对 SillyTavern 的全部依赖面（架构文档 §4.1）。
 * 无具体实现；仅 JSDoc typedef + 运行时自检。不得 import 酒馆或 adapters。
 * 归属：W0 冻结；实现归 W1-B `adapters/host/sillytavern.host.js`。
 */

import { Ok, Err } from '../infra/result.js';
import { hostError } from '../infra/errors.js';
import { requireArg } from '../infra/validate.js';

/**
 * @typedef {string} ChatId
 */

/**
 * @typedef {object} HostMessage
 * @property {number} messageId 楼层下标（= chat 数组下标）
 * @property {string} name 发言人名
 * @property {string} text 楼层正文（含 slot 原文）
 * @property {boolean} isUser
 * @property {boolean} isSystem
 * @property {object} [extra] message.extra
 */

/**
 * @typedef {() => void} Unsubscribe
 */

/**
 * 酒馆宿主端口。业务语言，不暴露 ST 事件名 / MutationObserver。
 * 失败分类：宿主能力缺失 → HostError；用户配置导致 → ConfigError。
 *
 * 对应宿主能力基线：§1 扩展装载、§2–3 渲染管线、§4 正则、§5 interceptor、
 * §6 世界书、§9 存储、§11 UI API。
 *
 * @typedef {object} HostPort
 *
 * @property {() => (ChatId|null)} getCurrentChatId
 *   当前聊天 id；无打开聊天时 null。基线 §9 chat_metadata。
 *
 * @property {() => HostMessage[]} getMessages
 *   全部楼层，下标即 messageId。
 *
 * @property {(n: number) => HostMessage[]} getRecentAiMessages
 *   最近 n 条 AI 回复楼，新→旧；不含用户楼/系统楼（需求 4.6）。
 *
 * @property {(messageId: number) => (HostMessage|null)} getMessage
 *
 * @property {(messageId: number, newText: string) => Promise<import('../infra/result.js').Ok<void>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} replaceMessageText
 *   唯一允许改正文的入口。失败：HostError。
 *
 * @property {(messageId: number) => void} rerenderMessage
 *   重绘某楼 DOM。
 *
 * @property {(messageId: number) => object} readMessageExtra
 *   读 message.extra（slot 权威记录载体）。基线 §9。
 *
 * @property {(messageId: number, patch: object) => Promise<import('../infra/result.js').Ok<void>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} writeMessageExtra
 *   合并写入 message.extra['nai-dbgen'] 并触发存盘。失败：HostError。
 *
 * @property {() => Promise<import('../infra/result.js').Ok<void>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} ensureSlotRegexInstalled
 *   写入/校验/补装两条正则。失败：HostError(REGEX_MISSING) / ConfigError。基线 §4。
 *
 * @property {(fn: (messageEl: Element, messageId: number) => void) => Unsubscribe} onMessageDomReady
 *   某楼 DOM 出现/重建时回调（幂等）。基线 §3。
 *
 * @property {(fn: (mes: string, msgMeta: object) => string) => Unsubscribe} registerOutboundTransform
 *   出站提示词变换（剥 slot 兜底）。基线 §5。
 *
 * @property {(args: { contextWindow: HostMessage[], messageId?: number }) => Promise<import('../infra/result.js').Ok<string>|import('../infra/result.js').Err<import('../infra/errors.js').AppError>>} resolveWorldInfo
 *   用调用方给定的上下文窗口跑 getWorldInfoPrompt，副作用已隔离（裁决 D6 / 架构 §6.3）。
 *   必须收 contextWindow 而不是楼号：世界书与角色、标签由同一窗口派生。
 *   messageId 仅用于日志与 trace。「是否带发言人名」由适配器读酒馆
 *   world_info_include_names 决定，不上浮到 application。失败可降级为空串（HostError）。基线 §6。
 *
 * @property {(fn: (chatId: ChatId|null) => void) => Unsubscribe} onChatChanged
 *
 * @property {(fn: (messageId: number) => void) => Unsubscribe} onAiMessageSettled
 *   流式结束后才触发。基线 §3 CHARACTER_MESSAGE_RENDERED 语义封装。
 *
 * @property {() => import('../domain/model/plugin-settings.js').PluginSettings} loadSettings
 *   读 extension_settings['nai-dbgen']，形状见 PluginSettings（裁决 D8）。基线 §9。
 *
 * @property {(settings: import('../domain/model/plugin-settings.js').PluginSettings) => void} saveSettings
 *   debounced 写回小配置（完整 PluginSettings，非随意 patch 对象）。
 *
 * @property {(element: Element) => void} mountSettingsPanel
 *   挂到 #extensions_settings2。基线 §11。
 *
 * @property {(opts: { title: string, element: Element, wide?: boolean }) => Promise<void>} openModal
 *   包一层酒馆 Popup。基线 §11。
 *
 * @property {(spec: object) => void} registerSlashCommand
 *
 * @property {(level: 'info'|'success'|'warning'|'error', message: string) => void} toast
 */

/** @type {readonly string[]} */
const REQUIRED_METHODS = Object.freeze([
    'getCurrentChatId',
    'getMessages',
    'getRecentAiMessages',
    'getMessage',
    'replaceMessageText',
    'rerenderMessage',
    'readMessageExtra',
    'writeMessageExtra',
    'ensureSlotRegexInstalled',
    'onMessageDomReady',
    'registerOutboundTransform',
    'resolveWorldInfo',
    'onChatChanged',
    'onAiMessageSettled',
    'loadSettings',
    'saveSettings',
    'mountSettingsPanel',
    'openModal',
    'registerSlashCommand',
    'toast',
]);

/**
 * 运行时自检：必需方法存在且为 function。缺失 → HostError。
 * @param {unknown} impl
 * @returns {{ ok: true, value: HostPort } | { ok: false, error: import('../infra/errors.js').AppError }}
 */
export function assertHostPort(impl) {
    requireArg(impl != null, 'impl');
    /** @type {string[]} */
    const missing = [];
    for (const name of REQUIRED_METHODS) {
        if (typeof /** @type {Record<string, unknown>} */ (impl)[name] !== 'function') {
            missing.push(name);
        }
    }
    if (missing.length > 0) {
        return Err(hostError({
            code: 'HOST_PORT_INCOMPLETE',
            message: '宿主端口实现不完整',
            hint: '请更新插件或检查装配容器',
            context: { missing },
        }));
    }
    return Ok(/** @type {HostPort} */ (impl));
}

export { REQUIRED_METHODS as HOST_PORT_METHODS };
