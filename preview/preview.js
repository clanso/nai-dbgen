/**
 * 预览沙箱装配：真应用层 + 真 UI + 假/真端口。
 * 双击不可用（file:// ESM CORS）→ 用 npm run preview 起静态服务。
 * status ok 时走本机 live 代理；否则维持假端口（测试与未配密钥时行为不变）。
 */

import { createMemoryIdb } from '../src/adapters/storage/memory-idb.js';
import { createMemoryServerFiles } from '../src/adapters/storage/memory-server-files.js';
import {
    activate,
    dispose,
    formatUserMessage,
    _runtimeForTest,
} from '../src/bootstrap/lifecycle.js';
import { APP_EVENTS } from '../src/application/_helpers.js';
import { GENERATE_INTERCEPTOR_GLOBAL_NAME } from '../src/adapters/host/generate-interceptor.js';
import { VARIABLE_NAMES } from '../src/domain/template/variable-map.js';
import { createFakeHost } from './fake-host.js';
import { createFakeLlmPort, createFakeImageGenPort, classifyLlmRequest } from './fake-gateways.js';
import {
    applyLiveDisplayConfigs,
    createLivePorts,
    fetchLiveStatus,
} from './live-ports.js';
import { createFakeSecretsBackend, makeFakeModelList } from './fake-secrets.js';
import { createLlmSecretsStore } from '../src/adapters/llm/secrets-store.js';
import { buildCustomChatCompletionRequest } from '../src/adapters/llm/request-data.js';
import { yamlApiFromModule } from '../src/adapters/host/st-yaml.js';
import YAML from '../node_modules/yaml/browser/index.js';
import {
    FIXTURE_CHAT_ID,
    IDS,
    fixtureIdbSeed,
    fixtureSettings,
    emptySettings,
    fixtureWorldInfo,
} from './fixtures.js';
import { loadRealArtistsIntoPreview } from './load-real-artists.js';
import {
    loadRealConvertedIntoPreview,
    PREVIEW_IMAGEGEN_PRESET_ID,
    PREVIEW_RECALL_PRESET_ID,
} from './load-real-converted.js';

/** @type {ReturnType<typeof createPreviewRuntime>|null} */
let runtime = null;

/**
 * @returns {{ getItem: (k: string) => string|null, setItem: (k: string, v: string) => void, clear: () => void }}
 */
function createMemoryStorage() {
    /** @type {Map<string, string>} */
    const map = new Map();
    return {
        getItem(k) {
            return map.has(k) ? /** @type {string} */ (map.get(k)) : null;
        },
        setItem(k, v) {
            map.set(String(k), String(v));
        },
        clear() {
            map.clear();
        },
    };
}

/**
 * @returns {object}
 */
function createPreviewStContext() {
    return {
        chat: [],
        chatId: FIXTURE_CHAT_ID,
        maxContext: 4096,
        extensionSettings: {
            regex: [],
            disabledExtensions: [],
            'nai-dbgen': undefined,
        },
        extensionPrompts: {},
        powerUserSettings: { encode_tags: false },
        eventTypes: {
            CHAT_CHANGED: 'chat_id_changed',
            CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
            MESSAGE_UPDATED: 'message_updated',
            MORE_MESSAGES_LOADED: 'more_messages_loaded',
        },
        eventSource: {
            on() {},
            removeListener() {},
        },
        getCurrentChatId: () => FIXTURE_CHAT_ID,
        saveSettingsDebounced() {},
        async saveChat() {},
        updateMessageBlock() {},
        async getWorldInfoPrompt() {
            return { worldInfoString: '' };
        },
        setExtensionPrompt() {},
        SlashCommandParser: { addCommandObject() {} },
        SlashCommand: { fromProps: (spec) => spec },
        substituteParams: (t) => t,
        callGenericPopup: async () => {},
    };
}

/**
 * @param {unknown} value
 * @param {number} [max]
 * @returns {string}
 */
function pretty(value, max = 4000) {
    let text;
    try {
        text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    } catch {
        text = String(value);
    }
    if (text.length > max) {
        return `${text.slice(0, max)}\n…（截断 ${text.length - max} 字）`;
    }
    return text;
}

/**
 * 从提示词 LLM messages 里抠注入块（沙箱可观测面板用）。
 * @param {Array<{ content?: string }>} messages
 * @returns {Record<string, string>}
 */
function extractBlocksFromMessages(messages) {
    const joined = (messages || []).map((m) => m?.content || '').join('\n\n');
    /** @type {Record<string, string>} */
    const out = {
        [VARIABLE_NAMES.WORLDINFO]: '',
        [VARIABLE_NAMES.CONTEXT]: '',
        [VARIABLE_NAMES.CHARACTER]: '',
        [VARIABLE_NAMES.COMPOSITION]: '',
        [VARIABLE_NAMES.FEATURE]: '',
        [VARIABLE_NAMES.CONSTANT]: '',
        [VARIABLE_NAMES.RECENT_SLOTS]: '',
    };
    const names = [
        VARIABLE_NAMES.WORLDINFO,
        VARIABLE_NAMES.CONTEXT,
        VARIABLE_NAMES.CHARACTER,
        VARIABLE_NAMES.COMPOSITION,
        VARIABLE_NAMES.FEATURE,
        VARIABLE_NAMES.CONSTANT,
        VARIABLE_NAMES.RECENT_SLOTS,
    ];
    for (const name of names) {
        const re = new RegExp(`【${name}】\\s*([\\s\\S]*?)(?=\\n【|$)`);
        const m = joined.match(re);
        if (m) {
            out[name] = m[1].trim();
        }
    }
    return out;
}

/**
 * @param {Record<string, string>} blocks
 * @returns {string}
 */
function formatPromptBlocksForPanel(blocks) {
    return [
        `【世界书】\n${blocks[VARIABLE_NAMES.WORLDINFO] || '（空）'}`,
        `【当前上下文】\n${blocks[VARIABLE_NAMES.CONTEXT] || '（空）'}`,
        `【角色库】\n${blocks[VARIABLE_NAMES.CHARACTER] || '（空）'}`,
        `【构图标签】\n${blocks[VARIABLE_NAMES.COMPOSITION] || '（空）'}`,
        `【特征参考】\n${blocks[VARIABLE_NAMES.FEATURE] || '（空）'}`,
        `【常驻标签】\n${blocks[VARIABLE_NAMES.CONSTANT] || '（空）'}`,
        `【近期生图记录】\n${blocks[VARIABLE_NAMES.RECENT_SLOTS] || '（空）'}`,
    ].join('\n\n');
}

/**
 * @param {HTMLElement} root
 * @returns {object}
 */
function createPipelinePanel(root) {
    const title = document.createElement('h2');
    title.className = 'pv-panel__title';
    title.textContent = '七步链路可观测';

    const meta = document.createElement('div');
    meta.className = 'pv-pipeline__meta';
    meta.textContent = '等待生成提示词 / 出图…';

    const steps = document.createElement('div');
    steps.className = 'pv-pipeline__steps';

    /** @type {Record<string, { head: HTMLElement, body: HTMLElement }>} */
    const stepMap = {};
    const labels = [
        ['1', '上下文窗口'],
        ['2', '世界书'],
        ['3', '角色库'],
        ['4', '标签召回'],
        ['5', '生图提示词'],
        ['6', '写入生图标记'],
        ['7', '出图'],
    ];
    for (const [id, label] of labels) {
        const card = document.createElement('details');
        card.className = 'pv-step';
        card.open = id === '5' || id === '4';
        const head = document.createElement('summary');
        head.textContent = `${id}. ${label}`;
        const body = document.createElement('pre');
        body.className = 'pv-step__body';
        body.textContent = '（尚未发生）';
        card.append(head, body);
        steps.appendChild(card);
        stepMap[id] = { head, body };
    }

    root.append(title, meta, steps);

    return {
        setMeta(text) {
            meta.textContent = text;
        },
        setStep(id, text, open) {
            const step = stepMap[String(id)];
            if (!step) {
                return;
            }
            step.body.textContent = text;
            if (open === true) {
                step.body.parentElement.open = true;
            }
        },
        reset() {
            meta.textContent = '等待生成提示词 / 出图…';
            for (const id of Object.keys(stepMap)) {
                stepMap[id].body.textContent = '（尚未发生）';
            }
        },
    };
}

/**
 * @returns {Promise<object>}
 */
async function createPreviewRuntime() {
    const statusEl = document.getElementById('pv-status');
    const setStatus = (text) => {
        if (statusEl) {
            statusEl.textContent = text;
        }
    };

    // file:// 下 ESM 会失败；尽早给用户一句人话
    if (location.protocol === 'file:') {
        setStatus('当前是 file://。请在 nai-dbgen 目录执行：npm run preview，然后打开 http://127.0.0.1:8765/nai-dbgen/preview/');
        throw new Error('file:// 无法加载原生 ESM（浏览器 CORS）');
    }

    if (typeof globalThis[GENERATE_INTERCEPTOR_GLOBAL_NAME] !== 'function') {
        globalThis[GENERATE_INTERCEPTOR_GLOBAL_NAME] = function NaiDbGen_StripSlots(text) {
            return text;
        };
    }

    const host = createFakeHost({
        settings: fixtureSettings(),
        worldInfoText: fixtureWorldInfo(),
    });

    setStatus('正在探测本机 live API…');
    const liveStatus = await fetchLiveStatus();
    const useLive = Boolean(liveStatus?.ok);
    /** @type {ReturnType<typeof createFakeLlmPort>|ReturnType<typeof createLivePorts>['llm']} */
    let llm;
    /** @type {ReturnType<typeof createFakeImageGenPort>|ReturnType<typeof createLivePorts>['imageGen']} */
    let imageGen;
    if (useLive) {
        const ports = createLivePorts({
            model: liveStatus?.llm?.model,
        });
        llm = ports.llm;
        imageGen = ports.imageGen;
        setStatus(`本机 live API 就绪 · 模型 ${liveStatus?.llm?.model || '—'}（假端口调试注入已关闭）`);
    } else {
        llm = createFakeLlmPort({ delayMs: 700 });
        imageGen = createFakeImageGenPort({ delayMs: 1400 });
        const miss = Array.isArray(liveStatus?.missing)
            ? liveStatus.missing.join(', ')
            : '';
        setStatus(
            miss
                ? `live API 未就绪（缺 ${miss}），使用假端口`
                : 'live API 未就绪，使用假端口',
        );
    }

    const secretsBackend = createFakeSecretsBackend();
    const previewFetch = async (url, init = {}) => {
        const path = typeof url === 'string' ? url : String(url?.url ?? url);
        if (path.includes('/api/secrets/')) {
            let body = {};
            if (init.body) {
                try {
                    body = JSON.parse(String(init.body));
                } catch {
                    body = {};
                }
            }
            const r = secretsBackend.handle(path, body);
            const payload = typeof r.json === 'string' ? r.json : JSON.stringify(r.json ?? {});
            return new Response(payload, {
                status: r.status,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        if (path.includes('/chat-completions/status')) {
            const models = makeFakeModelList().map((id) => ({ id }));
            return new Response(JSON.stringify({ data: models }), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        return new Response(JSON.stringify({ error: true }), { status: 404 });
    };
    const llmSecrets = createLlmSecretsStore({
        fetch: previewFetch,
        getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    });

    // 暴露给控制台 / 演示核对
    globalThis.__naiDbgenPreviewSecrets = secretsBackend;

    const chatRoot = document.getElementById('chat');
    const settingsMount = document.getElementById('pv-settings-mount');
    const toastMount = document.getElementById('pv-toasts');
    const toastLiveMount = document.getElementById('pv-toast-live');
    const pipelineRoot = document.getElementById('pv-pipeline');
    if (!(chatRoot instanceof HTMLElement) || !(pipelineRoot instanceof HTMLElement)) {
        throw new Error('预览页 DOM 不完整');
    }

    host._ctrl.setChatRoot(chatRoot);
    host._ctrl.setSettingsMount(settingsMount);
    host._ctrl.setToastMount(toastMount);
    host._ctrl.setToastLiveMount(toastLiveMount);

    const pipeline = createPipelinePanel(pipelineRoot);
    /** @type {{ traceId: string|null, llmCallCount: number, unmatchedKeys: string[] }} */
    const live = { traceId: null, llmCallCount: 0, unmatchedKeys: [] };
    /** @type {string} */
    let lastRecallStepText = '';
    /** @type {{ kind: string, traceId: string|null, blocks: Record<string, string>, messages: object[], requestBody: object|null }|null} */
    let lastPromptRequest = null;

    llm._ctrl.setOnCall((info) => {
        if (info.phase === 'start') {
            live.traceId = info.traceId || live.traceId;
            pipeline.setMeta(`LLM ${info.kind} 进行中… traceId=${info.traceId || '—'}`);
            if (info.kind === 'recall') {
                lastRecallStepText = `请求已发出\n${pretty({
                    configId: info.configId,
                    requestBody: info.config
                        ? buildCustomChatCompletionRequest(info.config, {
                            messages: info.messages,
                        })
                        : null,
                    messages: info.messages,
                })}`;
                pipeline.setStep(4, lastRecallStepText, true);
            }
            if (info.kind === 'prompt') {
                const blocks = extractBlocksFromMessages(info.messages);
                const requestBody = info.config
                    ? buildCustomChatCompletionRequest(info.config, {
                        messages: info.messages,
                        jsonSchema: info.schema ? { name: info.schema } : undefined,
                    })
                    : null;
                lastPromptRequest = {
                    kind: info.kind,
                    traceId: info.traceId || null,
                    blocks,
                    messages: info.messages || [],
                    requestBody,
                };
                const view = document.getElementById('pv-last-prompt-view');
                if (view instanceof HTMLElement) {
                    view.textContent = formatPromptBlocksForPanel(blocks);
                }
                pipeline.setStep(2, blocks[VARIABLE_NAMES.WORLDINFO] || '（空）', false);
                pipeline.setStep(1, blocks[VARIABLE_NAMES.CONTEXT] || '（空）', false);
                pipeline.setStep(3, blocks[VARIABLE_NAMES.CHARACTER] || '（空）', false);
                pipeline.setStep(5, `注入块已就绪，等待模型…\n\n请求体（核对生成参数）\n${pretty(requestBody)}\n\n${formatPromptBlocksForPanel(blocks)}`, true);
            }
        }
        if (info.phase === 'ok') {
            if (info.kind === 'recall') {
                live.llmCallCount += 1;
                lastRecallStepText = pretty({
                    llmCallCount: live.llmCallCount,
                    result: info.result,
                });
                pipeline.setStep(4, lastRecallStepText, true);
            }
            if (info.kind === 'prompt') {
                live.llmCallCount += 1;
                const blocks = extractBlocksFromMessages(info.messages);
                lastPromptRequest = {
                    kind: info.kind,
                    traceId: info.traceId || null,
                    blocks,
                    messages: info.messages || [],
                    requestBody: lastPromptRequest?.requestBody ?? null,
                };
                const view = document.getElementById('pv-last-prompt-view');
                if (view instanceof HTMLElement) {
                    view.textContent = [
                        formatPromptBlocksForPanel(blocks),
                        '',
                        '—— 模型返回 ——',
                        pretty({
                            llmCallCount: live.llmCallCount,
                            plan: info.result?.json ?? info.result?.text,
                        }),
                    ].join('\n');
                }
                pipeline.setStep(3, blocks[VARIABLE_NAMES.CHARACTER] || '（空）');
                pipeline.setStep(5, pretty({
                    llmCallCount: live.llmCallCount,
                    plan: info.result?.json ?? info.result?.text,
                    blocks: {
                        常驻标签: blocks[VARIABLE_NAMES.CONSTANT] || '（空）',
                        近期生图记录: blocks[VARIABLE_NAMES.RECENT_SLOTS] || '（空）',
                        特征参考: blocks[VARIABLE_NAMES.FEATURE] || '（空）',
                        构图标签: blocks[VARIABLE_NAMES.COMPOSITION] || '（空）',
                    },
                    renderedPromptPreview: (info.messages || []).map((m) => ({
                        role: m.role,
                        content: String(m.content || '').slice(0, 500),
                    })),
                }), true);
            }
            if (info.kind === 'workbench') {
                pipeline.setMeta(`工作台写提示词完成 traceId=${info.traceId || '—'}`);
                pipeline.setStep(5, pretty({ workbench: info.result }), true);
            }
        }
        if (info.phase === 'error') {
            pipeline.setMeta(`LLM 失败：${info.error?.message || 'unknown'}`);
        }
    });

    imageGen._ctrl.setOnCall((info) => {
        if (info.phase === 'start') {
            pipeline.setMeta(`NAI 出图中… traceId=${info.traceId || '—'}`);
            pipeline.setStep(7, pretty({
                status: 'generating',
                configId: info.configId,
                traceId: info.traceId,
            }), true);
        }
        if (info.phase === 'ok') {
            pipeline.setStep(7, pretty({ status: 'ok', ...info.result, traceId: info.traceId }), true);
            pipeline.setMeta(`出图完成 traceId=${info.traceId || '—'}`);
        }
        if (info.phase === 'error') {
            pipeline.setStep(7, pretty({
                status: 'error',
                message: info.error?.message,
                hint: info.error?.hint,
                code: info.error?.code,
            }), true);
            pipeline.setMeta(`出图失败：${info.error?.message || ''}`);
        }
    });

    const idbSeed = fixtureIdbSeed();
    const db = createMemoryIdb(idbSeed);
    // 会话记录 / 目录 / 画师示例图走内存版服务器文件（对齐 4.17；与测试 createMemoryServerFiles 同款）
    const serverFiles = createMemoryServerFiles();

    const seedStorage = createMemoryStorage();
    const getContext = () => createPreviewStContext();

    setStatus('正在 activate…');
    await activate({
        getContext,
        containerOpts: {
            host,
            llm,
            imageGenPort: imageGen,
            llmSecrets,
            db,
            serverFiles,
            getContext,
            yaml: yamlApiFromModule(YAML),
        },
        seedOpts: {
            storage: seedStorage,
            getContext,
        },
    });

    const container = _runtimeForTest().container;

    if (!container) {
        throw new Error('activate 后 container 为空——看 toast / 控制台');
    }

    // 确保设置抽屉可见：activate 已 mountSettingsPanel
    if (settingsMount && settingsMount.childElementCount === 0) {
        setStatus('警告：设置抽屉未挂上');
    }

    // 总线：写 slot / 出图 / unmatched
    container.bus.on(APP_EVENTS.SLOTS_WRITTEN, (payload) => {
        live.traceId = payload?.traceId || live.traceId;
        live.llmCallCount = Number(payload?.llmCallCount) || live.llmCallCount;
        live.unmatchedKeys = Array.isArray(payload?.unmatchedKeys) ? payload.unmatchedKeys : [];
        pipeline.setStep(6, pretty({
            messageId: payload?.messageId,
            records: payload?.records,
            placements: payload?.placements,
            traceId: payload?.traceId,
            llmCallCount: payload?.llmCallCount,
            unmatchedKeys: payload?.unmatchedKeys,
        }), true);
        pipeline.setMeta(
            `已生成提示词 · 调用 ${payload?.llmCallCount} 次 · 未匹配 ${(payload?.unmatchedKeys || []).join(',') || '无'} · ${payload?.traceId || ''}`,
        );
        try {
            host.rerenderMessage(payload.messageId);
        } catch {
            // ignore
        }
    });

    container.bus.on(APP_EVENTS.SLOT_RENDERED, (payload) => {
        pipeline.setStep(7, pretty({
            messageId: payload?.messageId,
            slotId: payload?.slotId,
            imageRef: payload?.imageRef,
            traceId: payload?.traceId,
            record: payload?.record,
        }), true);
    });

    container.bus.on(APP_EVENTS.TAG_RECALL_UNMATCHED, (payload) => {
        live.unmatchedKeys = Array.isArray(payload?.unmatchedKeys) ? payload.unmatchedKeys : [];
        pipeline.setStep(
            4,
            `${lastRecallStepText}\n\nunmatchedKeys: ${live.unmatchedKeys.join(', ')}`,
            true,
        );
    });

    // 首次对账：楼 2 已有 slot 骨架
    try {
        _runtimeForTest().slotObserver?.reconcile();
    } catch {
        // ignore
    }

    wireToolbar({
        host,
        llm,
        imageGen,
        container,
        pipeline,
        live,
        setStatus,
        useLive,
    });

    if (useLive) {
        try {
            await applyLiveDisplayConfigs({
                container,
                llmConfigId: IDS.llm,
                naiConfigId: IDS.nai,
                model: liveStatus?.llm?.model || '',
            });
        } catch (err) {
            console.error(err);
        }
    }

    setStatus(
        useLive
            ? `就绪 · live · 模型 ${liveStatus?.llm?.model || '—'} · 会话 ${host.getCurrentChatId()} · 正在导入转换标签/特征库/角色库/预设…`
            : `就绪 · 假端口 · 会话 ${host.getCurrentChatId()} · 正在导入转换标签/特征库/角色库/预设…`,
    );
    // 走插件真实 importJson；单文件缺失只提示，其它功能照常
    try {
        await loadRealConvertedIntoPreview({ container, host, setStatus });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus(`真实转换数据导入异常：${msg}；其它功能可用`);
        console.error(err);
    }

    try {
        await loadRealArtistsIntoPreview({ container, host, setStatus });
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus(`真实画师串导入异常：${msg}；其它功能可用`);
        console.error(err);
    }

    return {
        host,
        llm,
        imageGen,
        container,
        pipeline,
        getLastPromptRequest: () => lastPromptRequest,
        async destroy() {
            await dispose();
        },
    };
}

/**
 * 顶栏扩展面板、开发者抽屉、首次悬浮球提示。
 * @returns {void}
 */
function wireChromeUi() {
    const HINT_KEY = 'nai-dbgen:preview-hint-dismissed';
    const drawer = document.getElementById('pv-dev-drawer');
    const backdrop = document.getElementById('pv-dev-backdrop');
    const devToggle = document.getElementById('pv-dev-toggle');
    const devClose = document.getElementById('pv-dev-close');
    const extToggle = document.getElementById('pv-ext-toggle');
    const extPanel = document.getElementById('pv-ext-panel');
    const hint = document.getElementById('pv-fab-hint');
    const hintDismiss = document.getElementById('pv-fab-hint-dismiss');

    /**
     * @param {boolean} open
     */
    function setDevOpen(open) {
        if (!(drawer instanceof HTMLElement)) {
            return;
        }
        drawer.classList.toggle('is-open', open);
        drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
        if (devToggle instanceof HTMLElement) {
            devToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
    }

    /**
     * @param {boolean} open
     */
    function setExtOpen(open) {
        if (!(extPanel instanceof HTMLElement)) {
            return;
        }
        if (open) {
            extPanel.hidden = false;
        } else {
            extPanel.hidden = true;
        }
        if (extToggle instanceof HTMLElement) {
            extToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        }
    }

    if (devToggle) {
        devToggle.addEventListener('click', (ev) => {
            ev.preventDefault();
            const next = !(drawer instanceof HTMLElement && drawer.classList.contains('is-open'));
            setDevOpen(next);
            if (next) {
                setExtOpen(false);
            }
        });
    }
    if (devClose) {
        devClose.addEventListener('click', (ev) => {
            ev.preventDefault();
            setDevOpen(false);
        });
    }
    if (backdrop) {
        backdrop.addEventListener('click', () => setDevOpen(false));
    }

    if (extToggle) {
        extToggle.addEventListener('click', (ev) => {
            ev.preventDefault();
            const next = !(extPanel instanceof HTMLElement) || extPanel.hidden;
            setExtOpen(next);
            if (next) {
                setDevOpen(false);
            }
        });
    }

    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
            setDevOpen(false);
            setExtOpen(false);
        }
    });

    // 点击扩展面板外关闭（顶栏按钮本身由 toggle 处理）
    document.addEventListener('click', (ev) => {
        if (!(extPanel instanceof HTMLElement) || extPanel.hidden) {
            return;
        }
        const t = ev.target;
        if (!(t instanceof Node)) {
            return;
        }
        if (extPanel.contains(t) || (extToggle instanceof Node && extToggle.contains(t))) {
            return;
        }
        setExtOpen(false);
    });

    try {
        const params = new URLSearchParams(location.search);
        if (params.get('dev') === '1') {
            setDevOpen(true);
        }
    } catch {
        // ignore
    }

    let dismissed = false;
    try {
        dismissed = localStorage.getItem(HINT_KEY) === '1';
    } catch {
        dismissed = false;
    }
    if (hint instanceof HTMLElement && !dismissed) {
        hint.hidden = false;
    }
    const dismissHint = () => {
        if (hint instanceof HTMLElement) {
            hint.hidden = true;
        }
        try {
            localStorage.setItem(HINT_KEY, '1');
        } catch {
            // ignore
        }
    };
    if (hintDismiss) {
        hintDismiss.addEventListener('click', (ev) => {
            ev.preventDefault();
            dismissHint();
        });
    }
    if (hint) {
        hint.addEventListener('click', (ev) => {
            if (ev.target === hintDismiss) {
                return;
            }
            dismissHint();
        });
    }
}

/**
 * @param {object} ctx
 */
function wireToolbar(ctx) {
    const {
        host, llm, imageGen, container, pipeline, setStatus, useLive,
    } = ctx;

    const bind = (id, handler) => {
        const node = document.getElementById(id);
        if (node) {
            node.addEventListener('click', (ev) => {
                ev.preventDefault();
                handler(ev);
            });
        }
    };

    const bindChange = (id, handler) => {
        const node = document.getElementById(id);
        if (node) {
            node.addEventListener('change', () => handler(node));
        }
    };

    bind('pv-open-mgmt', () => {
        if (typeof globalThis.NaiDbGen?.openManagement === 'function') {
            void globalThis.NaiDbGen.openManagement();
        } else {
            host.toast('warning', 'NaiDbGen.openManagement 不可用');
        }
    });

    bind('pv-open-wb', () => {
        if (typeof globalThis.NaiDbGen?.openWorkbench === 'function') {
            void globalThis.NaiDbGen.openWorkbench();
        } else {
            host.toast('warning', 'NaiDbGen.openWorkbench 不可用');
        }
    });

    bind('pv-write-slot', async () => {
        pipeline.reset();
        setStatus('正在生成提示词（楼 3）…');
        const result = await container.useCases.generateSlots.execute(3);
        if (!result.ok) {
            host.toast('error', formatUserMessage(result));
            setStatus(`生成提示词失败：${result.error?.message || ''}`);
            return;
        }
        host.toast('success', `楼 3 已生成 ${result.value.records.length} 条生图提示词`);
        host.rerenderMessage(3);
        setStatus(`生成提示词成功 · 调用 ${result.value.llmCallCount} 次 · ${result.value.traceId}`);
    });

    bind('pv-write-slot-2', async () => {
        pipeline.reset();
        setStatus('正在重新生成提示词（楼 2）…');
        const result = await container.useCases.generateSlots.execute(2);
        if (!result.ok) {
            host.toast('error', formatUserMessage(result));
            return;
        }
        host.toast('success', `楼 2 已生成 ${result.value.records.length} 条生图提示词`);
        host.rerenderMessage(2);
    });

    bindChange('pv-llm-delay', (node) => {
        if (useLive) {
            return;
        }
        llm._ctrl.setDelayMs(Number(/** @type {HTMLInputElement} */ (node).value));
    });
    bindChange('pv-nai-delay', (node) => {
        if (useLive) {
            return;
        }
        imageGen._ctrl.setDelayMs(Number(/** @type {HTMLInputElement} */ (node).value));
    });
    bindChange('pv-llm-mode', (node) => {
        if (useLive) {
            return;
        }
        llm._ctrl.setMode(/** @type {HTMLSelectElement} */ (node).value);
    });
    bindChange('pv-nai-mode', (node) => {
        if (useLive) {
            return;
        }
        imageGen._ctrl.setMode(/** @type {HTMLSelectElement} */ (node).value);
    });

    if (useLive) {
        for (const id of ['pv-llm-delay', 'pv-nai-delay', 'pv-llm-mode', 'pv-nai-mode']) {
            const node = document.getElementById(id);
            if (node instanceof HTMLInputElement || node instanceof HTMLSelectElement) {
                node.disabled = true;
                node.title = 'live 模式下假端口调试注入不可用';
            }
        }
    }

    bindChange('pv-worldinfo-fail', (node) => {
        host._ctrl.setWorldInfoFail(/** @type {HTMLInputElement} */ (node).checked);
    });

    bind('pv-empty-config', () => {
        const next = emptySettings();
        host._ctrl.setSettings(next);
        host.saveSettings(next);
        container.settingsStore.save(next);
        host.toast('warning', '已切到空配置——再点生成提示词应看到带说明的错误');
        setStatus('空配置起步已启用');
    });

    bind('pv-restore-config', () => {
        const s = container.settingsStore.load();
        const next = fixtureSettings({
            activeImagegenPresetId: s.activeImagegenPresetId,
            activeRecallPresetId: s.activeRecallPresetId,
        });
        // 若已有当前预设（含转换后的两套），保留；仅空时回落到转换 id（再不行才 seed）
        if (!next.activeImagegenPresetId) {
            next.activeImagegenPresetId = PREVIEW_IMAGEGEN_PRESET_ID;
        }
        if (!next.activeRecallPresetId) {
            next.activeRecallPresetId = PREVIEW_RECALL_PRESET_ID;
        }
        host._ctrl.setSettings(next);
        container.settingsStore.save(next);
        host.toast('success', '已恢复示例配置');
        setStatus('示例配置已恢复');
    });

    bind('pv-show-last-prompt', () => {
        const view = document.getElementById('pv-last-prompt-view');
        if (!(view instanceof HTMLElement)) {
            return;
        }
        const rt = runtime;
        const snap = rt?.getLastPromptRequest?.() ?? null;
        if (!snap) {
            view.textContent = '尚无提示词请求。请先在聊天里点「生成提示词」。';
            setStatus('最近一次提示词请求：暂无');
            return;
        }
        view.textContent = [
            `kind=${snap.kind} · traceId=${snap.traceId || '—'}`,
            '',
            formatPromptBlocksForPanel(snap.blocks || {}),
        ].join('\n');
        setStatus('已展开最近一次提示词请求（常驻标签 / 近期生图记录见下方）');
    });

    // 主题
    const themes = {
        dark: {
            '--SmartThemeBodyColor': '#e8e0e4',
            '--SmartThemeBlurTintColor': '#1a1418',
            '--SmartThemeBotMesBlurTintColor': '#241c22',
            '--SmartThemeBorderColor': 'rgba(232, 224, 228, 0.18)',
            '--SmartThemeEmColor': '#b89aa8',
            '--SmartThemeShadowColor': 'rgba(0, 0, 0, 0.45)',
        },
        light: {
            '--SmartThemeBodyColor': '#4b3040',
            '--SmartThemeBlurTintColor': '#fffdfd',
            '--SmartThemeBotMesBlurTintColor': '#fff0f6',
            '--SmartThemeBorderColor': 'rgba(123, 70, 96, 0.21)',
            '--SmartThemeEmColor': '#7f5f70',
            '--SmartThemeShadowColor': 'rgba(123, 70, 96, 0.16)',
        },
        contrast: {
            '--SmartThemeBodyColor': '#ffffff',
            '--SmartThemeBlurTintColor': '#000000',
            '--SmartThemeBotMesBlurTintColor': '#111111',
            '--SmartThemeBorderColor': '#ffff00',
            '--SmartThemeEmColor': '#00ffff',
            '--SmartThemeShadowColor': 'rgba(255, 255, 0, 0.35)',
        },
    };

    /**
     * @param {string} name
     */
    function applyTheme(name) {
        const vars = themes[name] || themes.dark;
        const root = document.documentElement;
        for (const [k, v] of Object.entries(vars)) {
            root.style.setProperty(k, v);
        }
        document.body.dataset.theme = name;
        setStatus(`主题：${name}`);
    }

    bind('pv-theme-dark', () => applyTheme('dark'));
    bind('pv-theme-light', () => applyTheme('light'));
    bind('pv-theme-contrast', () => applyTheme('contrast'));
    applyTheme('dark');

    bindChange('pv-font-size', (node) => {
        const px = Number(/** @type {HTMLInputElement} */ (node).value) || 15;
        document.documentElement.style.setProperty('--mainFontSize', `${px}px`);
        const label = document.getElementById('pv-font-size-val');
        if (label) {
            label.textContent = `${px}px`;
        }
    });

    // D29：宿主全局 CSS 干扰
    const hostCss = document.getElementById('pv-host-css-inject');
    bindChange('pv-host-css', (node) => {
        const on = /** @type {HTMLInputElement} */ (node).checked;
        document.body.classList.toggle('pv-host-css-on', on);
        if (hostCss instanceof HTMLStyleElement) {
            hostCss.disabled = !on;
        }
        setStatus(on ? '已注入酒馆式全局 CSS 干扰' : '已关闭全局 CSS 干扰');
    });

    bind('pv-clear-pipeline', () => {
        pipeline.reset();
        llm._ctrl.clearCalls();
        imageGen._ctrl.clearCalls();
        host._ctrl.clearToasts();
    });

    // 暴露调试句柄
    globalThis.__NAI_DBGEN_PREVIEW__ = {
        host,
        llm,
        imageGen,
        container,
        formatUserMessage,
        classifyLlmRequest,
    };
}

async function main() {
    // 顶栏/抽屉不依赖 activate；失败时仍能打开调试看状态
    try {
        wireChromeUi();
    } catch (err) {
        console.error(err);
    }
    try {
        runtime = await createPreviewRuntime();
    } catch (err) {
        const statusEl = document.getElementById('pv-status');
        const msg = err instanceof Error ? err.message : String(err);
        if (statusEl) {
            statusEl.textContent = `启动失败：${msg}`;
        }
        console.error(err);
    }
}

void main();

window.addEventListener('beforeunload', () => {
    try {
        void runtime?.destroy?.();
    } catch {
        // ignore
    }
});
