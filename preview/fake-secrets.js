/**
 * 预览沙箱 · 模拟酒馆密钥库（CUSTOM）激活语义。
 * 对齐 secrets.js：write 激活新项；delete 激活项时抬第一个；rotate 切激活。
 */

import { LLM_SECRET_KEY } from '../src/domain/model/api-config.js';

/**
 * @typedef {object} FakeSecret
 * @property {string} id
 * @property {string} value
 * @property {string} label
 * @property {boolean} active
 */

/**
 * @returns {{
 *   state: Record<string, FakeSecret[]>,
 *   handle: (path: string, body: any) => { status: number, json: any },
 *   getActiveId: (key?: string) => string|null,
 *   list: (key?: string) => FakeSecret[],
 * }}
 */
export function createFakeSecretsBackend() {
    /** @type {Record<string, FakeSecret[]>} */
    const state = {
        [LLM_SECRET_KEY]: [
            {
                id: 'host-main-secret',
                value: 'sk-host-main-key-please-keep',
                label: '酒馆主连接',
                active: true,
            },
            {
                id: 'preview-llm-secret',
                value: 'preview-key',
                label: '酒馆数据库生图：默认 LLM',
                active: false,
            },
        ],
    };

    let seq = 1;

    /**
     * @param {string} value
     * @returns {string}
     */
    function mask(value) {
        if (value.length <= 10) {
            return '*'.repeat(10);
        }
        return `${'*'.repeat(7)}${value.slice(-3)}`;
    }

    /**
     * @param {string} [key]
     */
    function bucket(key = LLM_SECRET_KEY) {
        if (!Array.isArray(state[key])) {
            state[key] = [];
        }
        return state[key];
    }

    /**
     * @param {FakeSecret[]} arr
     */
    function deactivateAll(arr) {
        for (const s of arr) {
            s.active = false;
        }
    }

    return {
        state,
        getActiveId(key = LLM_SECRET_KEY) {
            return bucket(key).find((s) => s.active)?.id ?? null;
        },
        list(key = LLM_SECRET_KEY) {
            return bucket(key).map((s) => ({ ...s }));
        },
        handle(path, body) {
            const key = body?.key || LLM_SECRET_KEY;
            if (path.endsWith('/read') || path === '/api/secrets/read') {
                /** @type {Record<string, unknown>} */
                const out = {};
                for (const [k, arr] of Object.entries(state)) {
                    out[k] = arr.length
                        ? arr.map((s) => ({
                            id: s.id,
                            value: mask(s.value),
                            label: s.label,
                            active: s.active,
                        }))
                        : null;
                }
                // 补齐常用键
                if (!(LLM_SECRET_KEY in out)) {
                    out[LLM_SECRET_KEY] = null;
                }
                return { status: 200, json: out };
            }
            if (path.endsWith('/write') || path === '/api/secrets/write') {
                if (!key || typeof body?.value !== 'string') {
                    return { status: 400, json: 'Invalid key or value' };
                }
                const arr = bucket(key);
                deactivateAll(arr);
                const id = `sec-${seq++}-${Date.now().toString(36)}`;
                arr.push({
                    id,
                    value: body.value,
                    label: body.label || 'Unlabeled',
                    active: true,
                });
                return { status: 200, json: { id } };
            }
            if (path.endsWith('/rotate') || path === '/api/secrets/rotate') {
                const arr = bucket(key);
                const target = arr.find((s) => s.id === body?.id);
                if (!target) {
                    return { status: 200, json: {} };
                }
                deactivateAll(arr);
                target.active = true;
                return { status: 200, json: {} };
            }
            if (path.endsWith('/delete') || path === '/api/secrets/delete') {
                const arr = bucket(key);
                const idx = arr.findIndex((s) => (body?.id ? s.id === body.id : s.active));
                if (idx !== -1) {
                    arr.splice(idx, 1);
                }
                if (arr.length && !arr.some((s) => s.active)) {
                    arr[0].active = true;
                }
                if (arr.length === 0) {
                    delete state[key];
                }
                return { status: 200, json: {} };
            }
            if (path.endsWith('/rename') || path === '/api/secrets/rename') {
                const arr = bucket(key);
                const target = arr.find((s) => s.id === body?.id);
                if (target) {
                    target.label = String(body.label ?? target.label);
                }
                return { status: 200, json: {} };
            }
            return { status: 404, json: { error: true } };
        },
    };
}

/**
 * 生成几十个假模型 id。
 * @returns {string[]}
 */
export function makeFakeModelList() {
    /** @type {string[]} */
    const models = ['preview-model', 'gpt-4o-mini', 'claude-sonnet', 'deepseek-chat'];
    for (let i = 1; i <= 36; i += 1) {
        models.push(`vendor/model-${String(i).padStart(2, '0')}`);
    }
    return models;
}
