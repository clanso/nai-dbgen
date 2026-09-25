/**
 * 预览沙箱 · 假 LlmPort / ImageGenPort。
 * 可调延迟 + 错误/边界注入，满足 assertLlmPort / assertImageGenPort。
 */

import { Ok, Err } from '../src/infra/result.js';
import { assertLlmPort } from '../src/ports/llm.port.js';
import { assertImageGenPort } from '../src/ports/image-gen.port.js';
import { configError, upstreamFromHttpStatus } from '../src/infra/errors.js';
import { parseCompositionKey } from '../src/domain/model/composition-key.js';
import { matchAnyKeyword } from '../src/domain/matching/keyword-matcher.js';
import {
    IDS,
    makeSlotPlanJson,
    makeRecallPositionsJson,
    makeWorkbenchCaptionJson,
    makeFakeAnalysisText,
    PREVIEW_SLOT_SIZES,
    pickAnchorFromText,
    parseSlotIdsFromPromptMessages,
    parseCandidateKeysFromMessages,
} from './fixtures.js';

/**
 * @typedef {'ok'|'invalid-json'|'fabricated-keys'|'abort'} LlmMode
 * @typedef {'ok'|'401'|'429'|'timeout'|'abort'} NaiMode
 * @typedef {'recall'|'prompt'|'workbench'|'single-recall'|'single-prompt'|'other'} LlmKind
 */

/** 无文本命中时，优先从这些分类里挑（演示用，避开性相关靠前 key） */
const NEUTRAL_CATEGORY_RE = /^(镜头|景别|背景|光影|构图|场景)/;

/** 粗判性相关（仅用于无命中时的降级过滤；真命中名称仍可召回） */
const SEXUAL_KEY_RE = /性爱|群交|轮奸|偷窥|暴露|卖淫|车震|猥亵|淫趴|双飞|群p|群奸|性交|口交|肛交|色情|做爱|插入|卖淫/;

/**
 * @param {string} key
 * @param {{ category?: string, name?: string }|null} fields
 * @returns {boolean}
 */
function looksSexualCompositionKey(key, fields) {
    const cat = fields?.category || '';
    if (cat.includes('性爱')) {
        return true;
    }
    const blob = [key, cat, fields?.name || ''].join('/');
    return SEXUAL_KEY_RE.test(blob);
}

/**
 * @param {string} key
 * @param {{ category?: string }|null} fields
 * @returns {boolean}
 */
function isNeutralFallbackKey(key, fields) {
    if (looksSexualCompositionKey(key, fields)) {
        return false;
    }
    const cat = fields?.category || String(key).split('：')[0] || '';
    return NEUTRAL_CATEGORY_RE.test(cat);
}

/**
 * @param {string} name
 * @returns {string[]}
 */
function nameMatchNeedles(name) {
    if (typeof name !== 'string' || !name) {
        return [];
    }
    return name.split('/')
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
}

/**
 * 演示召回：按构图 key 名称（冒号后）匹配上下文；无命中则挑中性镜头/景别/背景类。
 * @param {string[]} candidateKeys
 * @param {string} haystack 生成点 + 上下文
 * @param {{ max?: number }} [opts]
 * @returns {string[]}
 */
export function pickRecallKeysFromCandidates(candidateKeys, haystack, opts = {}) {
    const max = Number.isFinite(opts.max) && opts.max > 0 ? Math.floor(opts.max) : 2;
    const text = typeof haystack === 'string' ? haystack : '';
    const defaults = { caseSensitive: false, matchWholeWords: false };
    /** @type {string[]} */
    const matched = [];
    /** @type {string[]} */
    const neutrals = [];

    for (const key of Array.isArray(candidateKeys) ? candidateKeys : []) {
        if (typeof key !== 'string' || !key) {
            continue;
        }
        const numbered = key.match(/^(\d+)\s+([\s\S]+)$/);
        const returned = numbered ? numbered[1] : key;
        const body = numbered ? numbered[2] : key;
        const parsed = parseCompositionKey(body);
        const fields = parsed.ok ? parsed.value : null;
        const needles = nameMatchNeedles(fields?.name || body);
        const hit = text
            && needles.length > 0
            && matchAnyKeyword(text, needles, null, defaults);
        if (hit) {
            matched.push(returned);
            continue;
        }
        if (!numbered && isNeutralFallbackKey(key, fields)) {
            neutrals.push(key);
        }
    }

    if (matched.length > 0) {
        return matched.slice(0, max);
    }
    return neutrals.slice(0, max);
}

/**
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function delay(ms, signal) {
    const wait = Math.max(0, Number(ms) || 0);
    if (wait === 0) {
        if (signal?.aborted) {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            return Promise.reject(err);
        }
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            resolve();
        }, wait);
        const onAbort = () => {
            cleanup();
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
        };
        const cleanup = () => {
            clearTimeout(timer);
            if (signal) {
                signal.removeEventListener('abort', onAbort);
            }
        };
        if (signal) {
            if (signal.aborted) {
                onAbort();
                return;
            }
            signal.addEventListener('abort', onAbort, { once: true });
        }
    });
}

/**
 * @param {AbortSignal|undefined} signal
 * @param {string} [traceId]
 */
function abortErr(signal, traceId) {
    if (!signal?.aborted) {
        return null;
    }
    return Err(upstreamFromHttpStatus(0, {
        code: 'UPSTREAM_ABORTED',
        message: '请求已取消',
        cause: signal.reason instanceof Error
            ? signal.reason
            : Object.assign(new Error('Aborted'), { name: 'AbortError' }),
        traceId: traceId ?? null,
    }));
}

/**
 * 用 canvas 生成 PNG Blob（D51：禁 svg+xml）。
 * @param {object} [opts]
 * @returns {Promise<Blob>}
 */
export async function makePngBlob(opts = {}) {
    const width = Number(opts.width) || 512;
    const height = Number(opts.height) || 768;
    const label = String(opts.label ?? 'NAI Preview');
    const seed = Number.isFinite(opts.seed) ? Number(opts.seed) : Math.floor(Math.random() * 1e9);

    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = typeof canvas.getContext === 'function'
            ? canvas.getContext('2d')
            : null;
        if (ctx) {
            const g = ctx.createLinearGradient(0, 0, width, height);
            g.addColorStop(0, '#2a1a24');
            g.addColorStop(0.45, '#c13d75');
            g.addColorStop(1, '#4b3040');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, width, height);

            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            for (let i = 0; i < 18; i += 1) {
                const x = (seed + i * 97) % width;
                const y = (seed * 3 + i * 131) % height;
                ctx.beginPath();
                ctx.arc(x, y, 8 + (i % 5) * 3, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.fillStyle = '#fffdfd';
            ctx.font = `bold ${Math.max(18, Math.floor(width / 16))}px Georgia, serif`;
            ctx.fillText(label, 24, 48);
            ctx.font = `${Math.max(12, Math.floor(width / 28))}px sans-serif`;
            ctx.fillStyle = 'rgba(255,253,253,0.85)';
            ctx.fillText(`seed ${seed}`, 24, 78);
            ctx.fillText(`${width}×${height} png`, 24, 102);

            const blob = await new Promise((resolve, reject) => {
                canvas.toBlob((b) => {
                    if (b) resolve(b);
                    else reject(new Error('canvas.toBlob failed'));
                }, 'image/png');
            });
            return blob;
        }
    }

    // 极简 PNG 头兜底（1×1），保证无 canvas 环境也不崩
    const bytes = Uint8Array.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
        0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
        0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
        0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
        0x00, 0x00, 0x03, 0x00, 0x01, 0x00, 0x05, 0xfe,
        0xd4, 0xef, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
        0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    return new Blob([bytes], { type: 'image/png' });
}

/**
 * @param {import('../src/ports/llm.port.js').LlmCompleteRequest} req
 * @returns {LlmKind}
 */
export function classifyLlmRequest(req) {
    const schemaName = req?.jsonSchema?.name;
    if (schemaName === 'recall_keys' || schemaName === 'recall_positions') {
        return 'recall';
    }
    if (schemaName === 'single_recall_keys') {
        return 'single-recall';
    }
    if (schemaName === 'single_imagegen_caption') {
        return 'single-prompt';
    }
    if (schemaName === 'slot_plan_array') {
        return 'prompt';
    }
    if (schemaName === 'nai_caption') {
        return 'workbench';
    }
    const joined = (req?.messages || [])
        .map((m) => m?.content || '')
        .join('\n');
    if (/单图构图召回|single_recall|恰好一张图|这一张图/.test(joined)
        && /候选 key/.test(joined)) {
        return 'single-recall';
    }
    if (/单图生图|single_imagegen|用户描述/.test(joined)
        && /生图内容/.test(joined)) {
        return 'single-prompt';
    }
    // 召回：靠【候选 key】或明确召回措辞；勿被生图预设示例 JSON 里的 slotid 骗成 prompt
    if (/【候选 key】/.test(joined)
        || (/构图召回|标签召回/.test(joined) && /位置数组|生成点/.test(joined))) {
        return 'recall';
    }
    // 写提示词：要求真实注入段【构图标签】+ 生图内容（示例里的 "slotid": 1 不算）
    if (/【构图标签】/.test(joined) && /生图内容/.test(joined)) {
        return 'prompt';
    }
    if (/slotid|构图标签/.test(joined) && /生图内容/.test(joined)
        && !/【示例|示例输出 JSON/.test(joined)) {
        return 'prompt';
    }
    return 'other';
}

/**
 * @param {string} messagesText
 * @returns {string}
 */
function extractContextFromMessages(messagesText) {
    const m = messagesText.match(/【当前上下文】\s*([\s\S]*?)(?:\n【|$)/);
    return m ? m[1].trim() : messagesText;
}

/**
 * @param {object} [opts]
 * @returns {import('../src/ports/llm.port.js').LlmPort & { _ctrl: object }}
 */
export function createFakeLlmPort(opts = {}) {
    /** @type {LlmMode} */
    let mode = opts.mode ?? 'ok';
    let delayMs = Number.isFinite(opts.delayMs) ? Number(opts.delayMs) : 600;
    /** @type {Array<object>} */
    const calls = [];
    /** @type {((info: object) => void)|null} */
    let onCall = typeof opts.onCall === 'function' ? opts.onCall : null;

    const port = {
        _ctrl: {
            setMode(next) {
                mode = /** @type {LlmMode} */ (next);
            },
            getMode() {
                return mode;
            },
            setDelayMs(ms) {
                delayMs = Math.max(0, Number(ms) || 0);
            },
            getDelayMs() {
                return delayMs;
            },
            getCalls() {
                return [...calls];
            },
            clearCalls() {
                calls.length = 0;
            },
            setOnCall(fn) {
                onCall = typeof fn === 'function' ? fn : null;
            },
        },

        async complete(req) {
            const traceId = req?.traceId;
            const kind = classifyLlmRequest(req);
            const started = Date.now();
            const entry = {
                kind,
                traceId: traceId ?? null,
                configId: req?.config?.id ?? null,
                config: req?.config ?? null,
                messages: req?.messages ?? [],
                schema: req?.jsonSchema?.name ?? null,
                startedAt: started,
            };
            calls.push(entry);
            if (onCall) {
                try {
                    onCall({ phase: 'start', ...entry });
                } catch {
                    // ignore
                }
            }

            try {
                await delay(delayMs, req?.signal);
            } catch (err) {
                const aborted = abortErr(req?.signal, traceId);
                if (aborted) {
                    entry.error = aborted.error;
                    entry.finishedAt = Date.now();
                    onCall?.({ phase: 'error', ...entry });
                    return aborted;
                }
                throw err;
            }

            const aborted = abortErr(req?.signal, traceId);
            if (aborted) {
                entry.error = aborted.error;
                entry.finishedAt = Date.now();
                onCall?.({ phase: 'error', ...entry });
                return aborted;
            }

            if (mode === 'abort') {
                const err = Err(upstreamFromHttpStatus(0, {
                    code: 'UPSTREAM_ABORTED',
                    message: '请求已取消',
                    cause: Object.assign(new Error('Aborted'), { name: 'AbortError' }),
                    traceId: traceId ?? null,
                }));
                entry.error = err.error;
                entry.finishedAt = Date.now();
                onCall?.({ phase: 'error', ...entry });
                return err;
            }

            if (mode === 'invalid-json' && (kind === 'prompt' || kind === 'workbench' || kind === 'single-prompt')) {
                const text = '这不是合法 JSON：{slot: oops';
                const result = Ok({ text, json: undefined });
                entry.result = result.value;
                entry.finishedAt = Date.now();
                onCall?.({ phase: 'ok', ...entry });
                return result;
            }

            const joined = (req?.messages || []).map((m) => m?.content || '').join('\n\n');
            const ctx = extractContextFromMessages(joined);
            const anchor = pickAnchorFromText(ctx);
            const candidateKeys = parseCandidateKeysFromMessages(joined);

            if (kind === 'recall') {
                /** @type {string[]} */
                let keys;
                if (mode === 'fabricated-keys') {
                    // 错误注入：仍取清单前两项再掺假 key（与旧行为一致）
                    keys = [...candidateKeys.slice(0, 2), 'NOT_A_REAL_KEY', 'hallucinated_tag'];
                } else if (mode === 'invalid-json') {
                    const text = 'not-json';
                    const result = Ok({ text, json: undefined });
                    entry.result = result.value;
                    entry.finishedAt = Date.now();
                    onCall?.({ phase: 'ok', ...entry });
                    return result;
                } else {
                    keys = pickRecallKeysFromCandidates(
                        candidateKeys,
                        `${ctx}\n${anchor}`,
                    );
                }
                const positions = makeRecallPositionsJson(anchor, keys);
                const result = Ok({
                    text: JSON.stringify(positions),
                    json: positions,
                });
                entry.result = result.value;
                entry.finishedAt = Date.now();
                onCall?.({ phase: 'ok', ...entry });
                return result;
            }

            if (kind === 'single-recall') {
                if (mode === 'invalid-json') {
                    const text = 'not-json';
                    const result = Ok({ text, json: undefined });
                    entry.result = result.value;
                    entry.finishedAt = Date.now();
                    onCall?.({ phase: 'ok', ...entry });
                    return result;
                }
                /** @type {string[]} */
                let keys;
                if (mode === 'fabricated-keys') {
                    keys = [...candidateKeys.slice(0, 2), 'NOT_A_REAL_KEY'];
                } else {
                    keys = pickRecallKeysFromCandidates(
                        candidateKeys,
                        `${ctx}\n${anchor}`,
                    );
                }
                const payload = { key: keys };
                const result = Ok({
                    text: JSON.stringify(payload),
                    json: payload,
                });
                entry.result = result.value;
                entry.finishedAt = Date.now();
                onCall?.({ phase: 'ok', ...entry });
                return result;
            }

            if (kind === 'workbench') {
                const caption = makeWorkbenchCaptionJson();
                const result = Ok({
                    text: JSON.stringify(caption),
                    json: caption,
                });
                entry.result = result.value;
                entry.finishedAt = Date.now();
                onCall?.({ phase: 'ok', ...entry });
                return result;
            }

            if (kind === 'single-prompt') {
                const caption = makeWorkbenchCaptionJson();
                const size = PREVIEW_SLOT_SIZES[0];
                const payload = {
                    caption,
                    size,
                    analysis: makeFakeAnalysisText(anchor, 1, size),
                };
                const result = Ok({
                    text: JSON.stringify(payload),
                    json: payload,
                });
                entry.result = result.value;
                entry.finishedAt = Date.now();
                onCall?.({ phase: 'ok', ...entry });
                return result;
            }

            // prompt / other → slot plan：必须对齐构图标签里的 slotid
            const slotIds = parseSlotIdsFromPromptMessages(joined);
            if (slotIds.length === 0) {
                const err = Err(upstreamFromHttpStatus(422, {
                    code: 'FAKE_LLM_NO_SLOTID',
                    message: '演示：生图预设里解析不到图编号',
                    hint: '构图标签段须含图编号；请检查召回结果',
                    traceId: traceId ?? null,
                }));
                entry.error = err.error;
                entry.finishedAt = Date.now();
                onCall?.({ phase: 'error', ...entry });
                return err;
            }
            const plan = makeSlotPlanJson(anchor, slotIds);
            const result = Ok({
                text: JSON.stringify(plan),
                json: plan,
            });
            entry.result = result.value;
            entry.finishedAt = Date.now();
            onCall?.({ phase: 'ok', ...entry });
            return result;
        },

        async probe(config) {
            return {
                ok: true,
                transport: 'st-backend',
                decoder: 'json-extract',
                detail: `已获取 3 个模型`,
                context: {
                    models: ['preview-model', 'preview-model-fast', 'preview-model-think'],
                    count: 3,
                },
            };
        },

        async listModels(config) {
            if (!config?.secretId) {
                return Err(configError({
                    code: 'LLM_CONFIG_KEY',
                    message: '还没填 API Key',
                }));
            }
            if (!config?.baseUrl) {
                return Err(configError({
                    code: 'LLM_CONFIG_URL',
                    message: '还没填接口地址',
                }));
            }
            const models = [];
            for (let i = 1; i <= 40; i += 1) {
                models.push(`preview-model-${String(i).padStart(2, '0')}`);
            }
            models.unshift('preview-model', 'gpt-4o-mini', 'claude-sonnet');
            return Ok({ models, count: models.length });
        },
    };

    const check = assertLlmPort(port);
    if (!check.ok) {
        throw new Error(`createFakeLlmPort: ${check.error?.message}`);
    }
    return port;
}

/**
 * @param {object} [opts]
 * @returns {import('../src/ports/image-gen.port.js').ImageGenPort & { _ctrl: object }}
 */
export function createFakeImageGenPort(opts = {}) {
    /** @type {NaiMode} */
    let mode = opts.mode ?? 'ok';
    let delayMs = Number.isFinite(opts.delayMs) ? Number(opts.delayMs) : 1200;
    /** @type {Array<object>} */
    const calls = [];
    /** @type {((info: object) => void)|null} */
    let onCall = typeof opts.onCall === 'function' ? opts.onCall : null;

    const port = {
        _ctrl: {
            setMode(next) {
                mode = /** @type {NaiMode} */ (next);
            },
            getMode() {
                return mode;
            },
            setDelayMs(ms) {
                delayMs = Math.max(0, Number(ms) || 0);
            },
            getDelayMs() {
                return delayMs;
            },
            getCalls() {
                return [...calls];
            },
            clearCalls() {
                calls.length = 0;
            },
            setOnCall(fn) {
                onCall = typeof fn === 'function' ? fn : null;
            },
        },

        async generate(req, optsIn = {}) {
            const traceId = optsIn?.traceId;
            const started = Date.now();
            const entry = {
                traceId: traceId ?? null,
                configId: optsIn?.config?.id ?? null,
                width: req?.parameters?.width ?? req?.width ?? null,
                height: req?.parameters?.height ?? req?.height ?? null,
                startedAt: started,
            };
            calls.push(entry);
            onCall?.({ phase: 'start', ...entry });

            try {
                await delay(delayMs, optsIn?.signal);
            } catch {
                const aborted = abortErr(optsIn?.signal, traceId);
                if (aborted) {
                    entry.error = aborted.error;
                    entry.finishedAt = Date.now();
                    onCall?.({ phase: 'error', ...entry });
                    return aborted;
                }
            }

            const aborted = abortErr(optsIn?.signal, traceId);
            if (aborted) {
                entry.error = aborted.error;
                entry.finishedAt = Date.now();
                onCall?.({ phase: 'error', ...entry });
                return aborted;
            }

            if (mode === 'abort') {
                const err = Err(upstreamFromHttpStatus(0, {
                    code: 'UPSTREAM_ABORTED',
                    message: '请求已取消',
                    cause: Object.assign(new Error('Aborted'), { name: 'AbortError' }),
                    traceId: traceId ?? null,
                }));
                entry.error = err.error;
                entry.finishedAt = Date.now();
                onCall?.({ phase: 'error', ...entry });
                return err;
            }

            if (mode === '401') {
                const err = Err(upstreamFromHttpStatus(401, {
                    message: 'NAI 鉴权失败（沙箱注入 401）',
                    hint: '请检查 API Key，或在预览页关掉「401」注入',
                    traceId: traceId ?? null,
                }));
                entry.error = err.error;
                entry.finishedAt = Date.now();
                onCall?.({ phase: 'error', ...entry });
                return err;
            }

            if (mode === '429') {
                const err = Err(upstreamFromHttpStatus(429, {
                    message: 'NAI 限流（沙箱注入 429）',
                    hint: '请稍后再试；沙箱可关掉「429」注入',
                    traceId: traceId ?? null,
                    context: { retryAfterSec: 3 },
                }));
                entry.error = err.error;
                entry.finishedAt = Date.now();
                onCall?.({ phase: 'error', ...entry });
                return err;
            }

            if (mode === 'timeout') {
                const err = Err(upstreamFromHttpStatus(408, {
                    message: 'NAI 请求超时（沙箱注入）',
                    hint: '可降低延迟或关掉超时注入后重试',
                    traceId: traceId ?? null,
                }));
                entry.error = err.error;
                entry.finishedAt = Date.now();
                onCall?.({ phase: 'error', ...entry });
                return err;
            }

            const seed = Math.floor(Math.random() * 1e9);
            const width = Number(entry.width) || Number(req?.parameters?.width) || 512;
            const height = Number(entry.height) || Number(req?.parameters?.height) || 768;
            entry.width = width;
            entry.height = height;
            const blob = await makePngBlob({
                width,
                height,
                label: 'Fake NAI',
                seed,
            });
            const images = [{ blob, mimeType: 'image/png', seed }];
            entry.result = { count: 1, seed, mimeType: 'image/png' };
            entry.finishedAt = Date.now();
            onCall?.({ phase: 'ok', ...entry });
            return Ok(images);
        },

        async probe(config) {
            return {
                ok: true,
                transport: config?.transport || 'direct',
                decoder: 'json-base64',
                detail: `NAI 探测通过（${config?.id || IDS.nai}）`,
            };
        },
    };

    const check = assertImageGenPort(port);
    if (!check.ok) {
        throw new Error(`createFakeImageGenPort: ${check.error?.message}`);
    }
    return port;
}
