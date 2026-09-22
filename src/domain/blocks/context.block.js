/**
 * L3 领域层 · 当前上下文注入块格式化。
 * 归属：W1-A 领域代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {object} ContextMessage
 * @property {string} name
 * @property {string} text 已剥 &lt;IMG&gt; 的正文
 */

/**
 * 将最近 N 条 AI 楼格式化为「当前上下文」变量值。
 * 约定：messages 按调用方传入顺序拼接（通常为旧→新）；本函数不做 reverse。
 * @param {ContextMessage[]} messages 新→旧或旧→新由实现与调用方约定；须在 JSDoc 实现时写死
 * @param {{ includeNames?: boolean }} [opts]
 * @returns {string}
 */
export function formatContextBlock(messages, opts) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return '';
    }
    const includeNames = opts?.includeNames === true;
    /** @type {string[]} */
    const lines = [];
    for (const msg of messages) {
        if (!msg) {
            continue;
        }
        const text = msg.text == null ? '' : String(msg.text);
        if (includeNames) {
            const name = msg.name == null ? '' : String(msg.name);
            lines.push(`${name}: ${text}`);
        } else {
            lines.push(text);
        }
    }
    return lines.join('\n\n');
}
