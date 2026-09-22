/**
 * 跨层类型汇总（纯类型，无运行时值）。
 * 具体契约定义以各 `*.port.js` 的 JSDoc `@typedef` 与 `src/domain/model/*.js` 为准；
 * 本文件供 IDE / tsc 引用，避免在应用层重复定义。
 *
 * 归属：W0 契约冻结。
 */

import type { AppError } from '../infra/errors.js';

/* ── Result ─────────────────────────────────────────── */

export type Result<T, E = AppError> =
    | { ok: true; value: T }
    | { ok: false; error: E };

export type Unsubscribe = () => void;

/* ── Host ───────────────────────────────────────────── */

export type ChatId = string;

export interface HostMessage {
    messageId: number;
    name: string;
    text: string;
    isUser: boolean;
    isSystem: boolean;
    extra?: Record<string, unknown>;
}

export interface HostPort {
    getCurrentChatId(): ChatId | null;
    getMessages(): HostMessage[];
    getRecentAiMessages(n: number): HostMessage[];
    getMessage(messageId: number): HostMessage | null;
    replaceMessageText(messageId: number, newText: string): Promise<Result<void>>;
    rerenderMessage(messageId: number): void;
    readMessageExtra(messageId: number): object;
    writeMessageExtra(messageId: number, patch: object): Promise<Result<void>>;
    ensureSlotRegexInstalled(): Promise<Result<void>>;
    onMessageDomReady(fn: (messageEl: Element, messageId: number) => void): Unsubscribe;
    registerOutboundTransform(fn: (mes: string, msgMeta: object) => string): Unsubscribe;
    resolveWorldInfo(messageId: number): Promise<Result<string>>;
    onChatChanged(fn: (chatId: ChatId | null) => void): Unsubscribe;
    onAiMessageSettled(fn: (messageId: number) => void): Unsubscribe;
    loadSettings(): object;
    saveSettings(settings: object): void;
    mountSettingsPanel(element: Element): void;
    openModal(opts: { title: string; element: Element; wide?: boolean }): Promise<void>;
    registerSlashCommand(spec: object): void;
    toast(level: 'info' | 'success' | 'warning' | 'error', message: string): void;
}

/* ── Image gen / LLM ────────────────────────────────── */

export interface GeneratedImage {
    blob: Blob;
    mimeType: string;
    seed?: number;
}

export interface TransportProbeResult {
    ok: boolean;
    transport: string;
    decoder: string;
    detail?: string;
    error?: AppError;
}

export interface NaiRequest {
    [key: string]: unknown;
}

export interface NaiApiConfig {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    transport: 'direct' | 'st-cors-proxy';
    decoder: 'auto' | 'json' | 'zip';
    schemaVersion: number;
}

export interface ImageGenPort {
    generate(
        req: NaiRequest,
        opts: { signal?: AbortSignal; config: NaiApiConfig },
    ): Promise<Result<GeneratedImage[]>>;
    probe(config: NaiApiConfig): Promise<TransportProbeResult>;
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export interface LlmApiConfig {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    transport: 'st-backend' | 'direct';
    schemaVersion: number;
}

export interface LlmCompleteRequest {
    messages: ChatMessage[];
    config: LlmApiConfig;
    jsonSchema?: object;
    signal?: AbortSignal;
}

export interface LlmCompleteResult {
    text: string;
    json?: unknown;
}

export interface LlmPort {
    complete(req: LlmCompleteRequest): Promise<Result<LlmCompleteResult>>;
    probe(config: LlmApiConfig): Promise<TransportProbeResult>;
}

/* ── Repository ─────────────────────────────────────── */

export interface Repository<T> {
    list(): Promise<Result<T[]>>;
    get(id: string): Promise<Result<T | null>>;
    put(entity: T): Promise<Result<T>>;
    remove(id: string): Promise<Result<void>>;
    exportJson(): Promise<Result<object>>;
    importJson(
        data: object,
        opts?: { strategy?: 'skip' | 'overwrite' | 'rename' },
    ): Promise<Result<{ imported: number; skipped: number; errors: string[] }>>;
    onChanged(fn: (change: { type: string; id?: string }) => void): Unsubscribe;
}

export type ImageRef = string;

export interface SlotImageEntry {
    imageRef: ImageRef;
    createdAt: string;
    naiConfigId: string | null;
    artistId: string | null;
}

export interface SlotRecord {
    schemaVersion: number;
    messageId: number;
    slotId: number;
    caption: object;
    anchorSentence: string;
    images: SlotImageEntry[];
    createdAt: string;
    presetId: string | null;
    llmConfigId: string | null;
    worldInfoSnapshot?: string;
    traceId?: string | null;
}

export interface SlotRepository {
    getByMessage(messageId: number): Promise<Result<SlotRecord[]>>;
    get(messageId: number, slotId: number): Promise<Result<SlotRecord | null>>;
    put(messageId: number, records: SlotRecord[]): Promise<Result<void>>;
    recordImage(
        messageId: number,
        slotId: number,
        imageRef: ImageRef,
        meta?: object,
    ): Promise<Result<SlotRecord>>;
    onChanged(
        fn: (change: { type: string; messageId?: number; slotId?: number }) => void,
    ): Unsubscribe;
}

export interface ImageRepository {
    put(blob: Blob): Promise<Result<ImageRef>>;
    getUrl(ref: ImageRef): Promise<Result<string | null>>;
    gc(liveRefs: ImageRef[]): Promise<Result<{ removed: number }>>;
}

/* ── External 4.14 API ──────────────────────────────── */

export interface ExternalGenerateRequest {
    caption: object;
    params?: Record<string, unknown>;
    replaceCharacterKeywords: boolean;
    signal?: AbortSignal;
}

export interface CapabilityReport {
    ok: boolean;
    items: Array<{
        id: string;
        available: boolean;
        detail?: string;
    }>;
}
