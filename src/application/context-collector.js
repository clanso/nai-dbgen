/**
 * L4 应用层 · 最近 N 条 AI 回复楼 + 剥 slot（需求 4.6）。
 * 归属：W2-F 用例代理实现。W0 仅冻结签名。
 */

import { stripSlotTokens } from '../domain/slot/slot-token.js';
import { formatContextBlock } from '../domain/blocks/context.block.js';

/**
 * @typedef {import('../domain/model/plugin-settings.js').PluginSettings} PluginSettings
 */

/**
 * @typedef {object} ContextCollectorDeps
 * @property {import('../ports/host.port.js').HostPort} host
 * @property {() => PluginSettings} loadSettings 读 contextWindowSize（默认 5）
 */

/**
 * @typedef {object} ContextWindow
 * @property {import('../ports/host.port.js').HostMessage[]} messages 已剥 slot 的副本
 * @property {string} text 格式化前的拼接用文本（或由 block 层格式化）
 */

/**
 * @param {ContextCollectorDeps} deps
 * @returns {{ collect: (opts?: { n?: number }) => ContextWindow }}
 */
export function createContextCollector(deps) {
    return {
        /**
         * @param {{ n?: number }} [opts]
         * @returns {ContextWindow}
         */
        collect(opts) {
            const settings = deps.loadSettings();
            const n = typeof opts?.n === 'number' && opts.n >= 0
                ? opts.n
                : (Number(settings.contextWindowSize) || 5);
            const raw = deps.host.getRecentAiMessages(n) ?? [];
            /** @type {import('../ports/host.port.js').HostMessage[]} */
            const messages = raw.map((m) => ({
                ...m,
                text: stripSlotTokens(m?.text ?? ''),
            }));
            // Host 约定新→旧；块文本按同一顺序拼接，供角色/标签/世界书同源消费
            const text = formatContextBlock(messages);
            return { messages, text };
        },
    };
}
