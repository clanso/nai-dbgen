/**
 * L3 领域层 · 预设渲染：prompts+order → messages[]，并做四块变量替换。
 * 替换顺序是安全边界（架构 §6.5）：先宿主宏，后注入四块。
 * 归属：W1-A 领域代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {import('../model/preset.js').Preset} Preset
 * @typedef {import('../blocks/block-set.js').BlockSet} BlockSet
 * @typedef {import('../../ports/llm.port.js').ChatMessage} ChatMessage
 */

/**
 * @typedef {object} RenderPresetDeps
 * @property {(template: string) => string} runHostMacros 通常桥接 substituteParams；必须先于四块注入
 */

/**
 * 渲染预设为发给 LLM 的 messages。
 * @param {Preset} preset
 * @param {BlockSet} blocks 生图预设用四块；召回预设可只含上下文与候选 key 等
 * @param {RenderPresetDeps} deps
 * @returns {ChatMessage[]}
 */
export function renderPreset(preset, blocks, deps) {
    throw new Error('not implemented: renderPreset');
}

/**
 * 仅替换插件变量（中文+别名），不跑宿主宏。空块 → 空串。
 * @param {string} template
 * @param {BlockSet} blocks
 * @returns {string}
 */
export function injectBlockVariables(template, blocks) {
    throw new Error('not implemented: injectBlockVariables');
}
