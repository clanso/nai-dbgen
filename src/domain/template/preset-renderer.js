/**
 * L3 领域层 · 预设渲染：prompts+order → messages[]，并做四块变量替换。
 * 替换顺序是安全边界（架构 §6.5）：先宿主宏，后注入四块。
 * 归属：W1-A 领域代理实现。W0 仅冻结签名。
 *
 * 未知变量策略：保留原文（含花括号）。避免误伤宿主宏残留或用户自定义占位；
 * 已登记或 BlockSet 内的键才替换；空块 → 空串。单轮 replace，不递归。
 */

import { getBlock } from '../blocks/block-set.js';
import { listVariableAliases, resolveVariableName } from './variable-map.js';

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
    if (!preset || typeof preset !== 'object') {
        throw new Error('invalid argument: preset');
    }
    if (!deps || typeof deps.runHostMacros !== 'function') {
        throw new Error('invalid argument: deps.runHostMacros');
    }

    const promptsById = new Map();
    for (const p of preset.prompts ?? []) {
        if (p && typeof p.identifier === 'string') {
            promptsById.set(p.identifier, p);
        }
    }

    const order = Array.isArray(preset.prompt_order) && preset.prompt_order.length > 0
        ? preset.prompt_order
        : (preset.prompts ?? []).map((p) => ({
            identifier: p.identifier,
            enabled: p.enabled !== false,
        }));

    /** @type {ChatMessage[]} */
    const messages = [];
    for (const item of order) {
        if (!item || item.enabled === false) {
            continue;
        }
        const prompt = promptsById.get(item.identifier);
        if (!prompt || prompt.enabled === false) {
            continue;
        }
        const afterHost = deps.runHostMacros(String(prompt.content ?? ''));
        const content = injectBlockVariables(afterHost, blocks);
        messages.push({
            role: prompt.role === 'user' || prompt.role === 'assistant' ? prompt.role : 'system',
            content,
        });
    }
    return messages;
}

/**
 * 仅替换插件变量（中文+别名），不跑宿主宏。空块 → 空串。
 * 未知 `{{…}}` **保留原文**（见文件头）。
 * @param {string} template
 * @param {BlockSet} blocks
 * @returns {string}
 */
export function injectBlockVariables(template, blocks) {
    if (typeof template !== 'string') {
        throw new Error('invalid argument: template');
    }
    const valueByName = buildValueLookup(blocks);
    // 单轮：String.replace 回调结果不会再被扫描
    return template.replace(/\{\{([^{}]+)\}\}/g, (full, rawName) => {
        const name = String(rawName).trim();
        if (valueByName.has(name)) {
            return /** @type {string} */ (valueByName.get(name));
        }
        const lower = name.toLowerCase();
        if (valueByName.has(lower)) {
            return /** @type {string} */ (valueByName.get(lower));
        }
        return full;
    });
}

/**
 * @param {BlockSet} blocks
 * @returns {Map<string, string>}
 */
function buildValueLookup(blocks) {
    /** @type {Map<string, string>} */
    const values = new Map();

    for (const { canonical, aliases } of listVariableAliases()) {
        const text = getBlock(blocks, canonical);
        values.set(canonical, text);
        for (const alias of aliases) {
            values.set(alias, text);
            values.set(alias.toLowerCase(), text);
        }
    }

    // BlockSet 内额外键（如召回「候选 key」）也可被引用；未被模板写出的键不会泄露
    if (blocks instanceof Map) {
        for (const [key, raw] of blocks) {
            if (typeof key !== 'string') {
                continue;
            }
            const text = raw == null ? '' : String(raw);
            const canonical = resolveVariableName(key);
            if (canonical) {
                // 别名键写入时，同步更新规范名对应值
                values.set(canonical, text);
                for (const { canonical: c, aliases } of listVariableAliases()) {
                    if (c === canonical) {
                        for (const alias of aliases) {
                            values.set(alias, text);
                            values.set(alias.toLowerCase(), text);
                        }
                    }
                }
                values.set(key, text);
            } else if (!values.has(key)) {
                values.set(key, text);
            }
        }
    }

    return values;
}
