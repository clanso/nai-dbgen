/**
 * L2 适配器 · 酒馆密钥库（CUSTOM）串行读写，写入后恢复原激活项。
 *
 * 宿主事实：
 * - writeSecret 会把同 key 下全部密钥设为非激活、新写的设为激活（secrets.js:204-222）
 * - 故：写前 /read 记下激活 id → write → /rotate 切回
 * - 若 CUSTOM 下原先没有任何密钥，写入后我们的就是唯一激活项，无法去激活（无对应 API）
 *
 * @see ref/SillyTavern/src/endpoints/secrets.js
 */

import { Ok, Err } from '../../infra/result.js';
import { configError, hostError, transportError } from '../../infra/errors.js';
import { LLM_SECRET_KEY, llmSecretLabel } from '../../domain/model/api-config.js';

/**
 * @typedef {object} SecretEntry
 * @property {string} id
 * @property {string} value 打码后的值
 * @property {string} [label]
 * @property {boolean} [active]
 */

/**
 * @typedef {object} LlmSecretsStore
 * @property {() => Promise<import('../../infra/result.js').Ok<SecretEntry[]>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>} list
 * @property {(id: string) => Promise<import('../../infra/result.js').Ok<SecretEntry|null>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>} getMasked
 * @property {(args: { value: string, label: string }) => Promise<import('../../infra/result.js').Ok<{ id: string, restoredActive: boolean, wasFirstSecret: boolean }>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>} writePreservingActive
 * @property {(args: { id: string, label: string }) => Promise<import('../../infra/result.js').Ok<true>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>} rename
 * @property {(id: string) => Promise<import('../../infra/result.js').Ok<true>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>} deleteById
 * @property {(args: { oldId: string|null, value: string, label: string }) => Promise<import('../../infra/result.js').Ok<{ id: string, restoredActive: boolean, wasFirstSecret: boolean }>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>} replaceKey
 */

/**
 * @param {object} deps
 * @param {typeof fetch} [deps.fetch]
 * @param {() => Record<string, string>} deps.getRequestHeaders
 * @param {string} [deps.secretKey]
 * @returns {LlmSecretsStore}
 */
export function createLlmSecretsStore(deps) {
    if (!deps || typeof deps.getRequestHeaders !== 'function') {
        throw new Error('invalid argument: deps.getRequestHeaders');
    }
    const fetchFn = deps.fetch ?? globalThis.fetch.bind(globalThis);
    const secretKey = deps.secretKey || LLM_SECRET_KEY;

    /** @type {Promise<unknown>} */
    let queue = Promise.resolve();

    /**
     * @template T
     * @param {() => Promise<T>} fn
     * @returns {Promise<T>}
     */
    function enqueue(fn) {
        const run = queue.then(fn, fn);
        queue = run.then(() => undefined, () => undefined);
        return run;
    }

    /**
     * @param {string} path
     * @param {object} [body]
     * @returns {Promise<{ ok: boolean, status: number, json: any, text: string }>}
     */
    async function post(path, body) {
        const headers = {
            ...deps.getRequestHeaders(),
            'Content-Type': 'application/json',
        };
        const res = await fetchFn(path, {
            method: 'POST',
            headers,
            body: body === undefined ? undefined : JSON.stringify(body),
            cache: 'no-cache',
        });
        const text = await res.text();
        let json = null;
        if (text) {
            try {
                json = JSON.parse(text);
            } catch {
                json = null;
            }
        }
        return { ok: res.ok, status: res.status, json, text };
    }

    /**
     * @returns {Promise<import('../../infra/result.js').Ok<SecretEntry[]>|import('../../infra/result.js').Err<import('../../infra/errors.js').AppError>>}
     */
    async function readEntries() {
        let res;
        try {
            res = await post('/api/secrets/read');
        } catch (cause) {
            return Err(transportError({
                code: 'LLM_SECRET_READ_FAILED',
                message: '读取酒馆 API 密钥失败',
                hint: '请确认插件在酒馆页面内加载',
                cause,
                retryable: true,
            }));
        }
        if (!res.ok) {
            return Err(hostError({
                code: 'LLM_SECRET_READ_HTTP',
                message: '读取酒馆 API 密钥失败',
                hint: `HTTP ${res.status}`,
                context: { status: res.status, preview: res.text.slice(0, 200) },
            }));
        }
        const bucket = res.json?.[secretKey];
        if (!Array.isArray(bucket)) {
            return Ok([]);
        }
        return Ok(bucket.map((s) => ({
            id: String(s.id),
            value: String(s.value ?? ''),
            label: s.label != null ? String(s.label) : '',
            active: Boolean(s.active),
        })));
    }

    return {
        list() {
            return enqueue(() => readEntries());
        },

        getMasked(id) {
            return enqueue(async () => {
                const listR = await readEntries();
                if (!listR.ok) {
                    return listR;
                }
                const found = listR.value.find((s) => s.id === id) ?? null;
                return Ok(found);
            });
        },

        writePreservingActive({ value, label }) {
            return enqueue(async () => {
                if (typeof value !== 'string' || !value) {
                    return Err(configError({
                        code: 'LLM_SECRET_EMPTY',
                        message: '请填写 API 密钥',
                    }));
                }
                const listR = await readEntries();
                if (!listR.ok) {
                    return listR;
                }
                const prevActive = listR.value.find((s) => s.active)?.id ?? null;
                const wasFirstSecret = listR.value.length === 0;

                let writeRes;
                try {
                    writeRes = await post('/api/secrets/write', {
                        key: secretKey,
                        value,
                        label: label || llmSecretLabel('未命名配置'),
                    });
                } catch (cause) {
                    return Err(transportError({
                        code: 'LLM_SECRET_WRITE_FAILED',
                        message: '写入 API 密钥失败',
                        hint: '请稍后重试；若反复失败请到酒馆「管理 API 密钥」检查',
                        cause,
                        retryable: true,
                    }));
                }
                if (!writeRes.ok || !writeRes.json?.id) {
                    return Err(hostError({
                        code: 'LLM_SECRET_WRITE_HTTP',
                        message: '写入 API 密钥失败',
                        hint: writeRes.text?.slice(0, 200) || `HTTP ${writeRes.status}`,
                        context: { status: writeRes.status },
                    }));
                }
                const newId = String(writeRes.json.id);

                let restoredActive = false;
                if (prevActive && prevActive !== newId) {
                    let rot;
                    try {
                        rot = await post('/api/secrets/rotate', {
                            key: secretKey,
                            id: prevActive,
                        });
                    } catch (cause) {
                        return Err(transportError({
                            code: 'LLM_SECRET_ROTATE_FAILED',
                            message: '写入后无法恢复酒馆当前 API 密钥',
                            hint: '请到酒馆 API 设置里重新选择正在用的 API 密钥',
                            cause,
                            retryable: false,
                            context: { newId, prevActive },
                        }));
                    }
                    if (!rot.ok) {
                        return Err(hostError({
                            code: 'LLM_SECRET_ROTATE_HTTP',
                            message: '写入后无法恢复酒馆当前 API 密钥',
                            hint: '请到酒馆 API 设置里重新选择正在用的 API 密钥',
                            context: { status: rot.status, newId, prevActive },
                        }));
                    }
                    restoredActive = true;
                }

                return Ok({ id: newId, restoredActive, wasFirstSecret });
            });
        },

        rename({ id, label }) {
            return enqueue(async () => {
                if (!id) {
                    return Err(configError({
                        code: 'LLM_SECRET_ID',
                        message: '缺少密钥编号',
                    }));
                }
                let res;
                try {
                    res = await post('/api/secrets/rename', {
                        key: secretKey,
                        id,
                        label,
                    });
                } catch (cause) {
                    return Err(transportError({
                        code: 'LLM_SECRET_RENAME_FAILED',
                        message: '更新密钥备注失败',
                        cause,
                        retryable: true,
                    }));
                }
                if (!res.ok) {
                    return Err(hostError({
                        code: 'LLM_SECRET_RENAME_HTTP',
                        message: '更新密钥备注失败',
                        hint: `HTTP ${res.status}`,
                        context: { status: res.status },
                    }));
                }
                return Ok(true);
            });
        },

        deleteById(id) {
            return enqueue(async () => {
                if (!id) {
                    return Ok(true);
                }
                // 删除非激活项时不会改动当前激活（secrets.js:249-252 仅在「删后无人激活」时抬第一个）。
                // 若我们的密钥是唯一/当前激活项，删除后要么清空整 key，要么抬起别的——无法避免。
                let res;
                try {
                    res = await post('/api/secrets/delete', {
                        key: secretKey,
                        id,
                    });
                } catch (cause) {
                    return Err(transportError({
                        code: 'LLM_SECRET_DELETE_FAILED',
                        message: '删除 API 密钥失败',
                        cause,
                        retryable: true,
                    }));
                }
                if (!res.ok) {
                    return Err(hostError({
                        code: 'LLM_SECRET_DELETE_HTTP',
                        message: '删除 API 密钥失败',
                        hint: `HTTP ${res.status}`,
                        context: { status: res.status, id },
                    }));
                }
                return Ok(true);
            });
        },

        replaceKey({ oldId, value, label }) {
            return enqueue(async () => {
                // 直接调用内部逻辑：enqueue 已串行，这里再走 write + delete
                // 不能嵌套 enqueue，故内联 write/delete 步骤
                const writeInner = async () => {
                    const listR = await readEntries();
                    if (!listR.ok) {
                        return listR;
                    }
                    const prevActive = listR.value.find((s) => s.active)?.id ?? null;
                    const wasFirstSecret = listR.value.length === 0;
                    let writeRes;
                    try {
                        writeRes = await post('/api/secrets/write', {
                            key: secretKey,
                            value,
                            label: label || llmSecretLabel('未命名配置'),
                        });
                    } catch (cause) {
                        return Err(transportError({
                            code: 'LLM_SECRET_WRITE_FAILED',
                            message: '写入 API 密钥失败',
                            cause,
                            retryable: true,
                        }));
                    }
                    if (!writeRes.ok || !writeRes.json?.id) {
                        return Err(hostError({
                            code: 'LLM_SECRET_WRITE_HTTP',
                            message: '写入 API 密钥失败',
                            hint: writeRes.text?.slice(0, 200) || `HTTP ${writeRes.status}`,
                        }));
                    }
                    const newId = String(writeRes.json.id);
                    let restoredActive = false;
                    if (prevActive && prevActive !== newId) {
                        const rot = await post('/api/secrets/rotate', {
                            key: secretKey,
                            id: prevActive,
                        });
                        if (!rot.ok) {
                            return Err(hostError({
                                code: 'LLM_SECRET_ROTATE_HTTP',
                                message: '写入后无法恢复酒馆当前 API 密钥',
                                hint: '请到酒馆 API 设置里重新选择正在用的 API 密钥',
                                context: { newId, prevActive },
                            }));
                        }
                        restoredActive = true;
                    }
                    if (oldId && oldId !== newId) {
                        const del = await post('/api/secrets/delete', {
                            key: secretKey,
                            id: oldId,
                        });
                        if (!del.ok) {
                            return Err(hostError({
                                code: 'LLM_SECRET_DELETE_HTTP',
                                message: '新密钥已写入，但旧密钥删除失败',
                                hint: '可到酒馆「管理 API 密钥」手动删除旧项',
                                context: { newId, oldId, status: del.status },
                            }));
                        }
                    }
                    return Ok({ id: newId, restoredActive, wasFirstSecret });
                };
                if (typeof value !== 'string' || !value) {
                    return Err(configError({
                        code: 'LLM_SECRET_EMPTY',
                        message: '请填写 API 密钥',
                    }));
                }
                return writeInner();
            });
        },
    };
}
