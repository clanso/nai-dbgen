/**
 * L2 适配器 · 容错解析 LLM JSON（剥 markdown 围栏、截取首个平衡 JSON 块）。
 * 归属：W1-C 网关代理实现。W0 仅冻结签名。
 *
 * 降级顺序：
 * 1. 整段 trim 后 JSON.parse
 * 2. 剥 ``` / ```json 围栏后再 parse
 * 3. 从原文截取首个平衡的 `{…}` 或 `[…]` 再 parse
 * 失败 → ContractError，context.rawText 保留原始回文（R-06 / 架构 §10）
 */

import { Ok, Err } from '../../infra/result.js';
import { contractError } from '../../infra/errors.js';

/**
 * @param {string} text
 * @returns {{ ok: true, value: any } | { ok: false, error: import('../../infra/errors.js').AppError }}
 */
export function extractJson(text) {
    const raw = text == null ? '' : String(text);
    if (!raw.trim()) {
        return Err(contractError({
            code: 'LLM_JSON_EMPTY',
            message: 'LLM 回文为空，无法解析 JSON',
            hint: '请检查模型是否按约定输出 JSON',
            context: { rawText: raw },
        }));
    }

    const attempts = [
        () => raw.trim(),
        () => stripMarkdownFence(raw),
        () => sliceBalancedJson(raw),
    ];

    /** @type {unknown} */
    let lastCause = null;
    for (const getCandidate of attempts) {
        const candidate = getCandidate();
        if (candidate == null || candidate === '') {
            continue;
        }
        try {
            return Ok(JSON.parse(candidate));
        } catch (cause) {
            lastCause = cause;
        }
    }

    return Err(contractError({
        code: 'LLM_JSON_EXTRACT_FAILED',
        message: '无法从模型回复中解析结果',
        hint: '请查看模型原始回复并调整预设；部分中转可能不支持结构化输出',
        cause: lastCause,
        context: { rawText: raw },
    }));
}

/**
 * @param {string} text
 * @returns {string}
 */
function stripMarkdownFence(text) {
    const trimmed = String(text).trim();
    const fenced = trimmed.match(/^```(?:json|JSON)?\s*\r?\n?([\s\S]*?)\r?\n?```\s*$/);
    if (fenced) {
        return fenced[1].trim();
    }
    // 围栏前后还有废话：取第一个 ```…``` 块
    const embedded = trimmed.match(/```(?:json|JSON)?\s*\r?\n?([\s\S]*?)\r?\n?```/);
    if (embedded) {
        return embedded[1].trim();
    }
    return trimmed;
}

/**
 * @param {string} text
 * @returns {string|null}
 */
function sliceBalancedJson(text) {
    const s = String(text);
    const startObj = s.indexOf('{');
    const startArr = s.indexOf('[');
    let start = -1;
    let open = '';
    let close = '';
    if (startObj < 0 && startArr < 0) {
        return null;
    }
    if (startObj < 0 || (startArr >= 0 && startArr < startObj)) {
        start = startArr;
        open = '[';
        close = ']';
    } else {
        start = startObj;
        open = '{';
        close = '}';
    }

    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < s.length; i += 1) {
        const ch = s[i];
        if (inString) {
            if (escape) {
                escape = false;
            } else if (ch === '\\') {
                escape = true;
            } else if (ch === '"') {
                inString = false;
            }
            continue;
        }
        if (ch === '"') {
            inString = true;
            continue;
        }
        if (ch === open) {
            depth += 1;
        } else if (ch === close) {
            depth -= 1;
            if (depth === 0) {
                return s.slice(start, i + 1);
            }
        }
    }
    return null;
}
