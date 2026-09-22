/**
 * 跨层类型汇总（纯类型，无运行时值）。
 * 具体契约定义以各 `*.port.js` 的 JSDoc `@typedef` 与 `src/domain/model/*.js` 为准；
 * 本文件供 IDE / tsc 引用，避免在应用层重复定义。
 *
 * 归属：W0 契约冻结（含裁决 D6–D13）。
 */

import type { AppError } from '../infra/errors.js';

/* ── Result ─────────────────────────────────────────── */

export type Result<T, E = AppError> =
    | { ok: true; value: T }
    | { ok: false; error: E };

export type Unsubscribe = () => void;

/* ── Plugin settings ────────────────────────────────── */

export interface MatchDefaults {
    caseSensitive: boolean;
    matchWholeWords: boolean;
}

export interface NaiParams {
    schemaVersion: number;
    model: string;
    width: number;
    height: number;
    steps: number;
    scale: number;
    sampler: string;
    noise_schedule: string;
    seed: number;
    seedRandom: boolean;
    n_samples: number;
    image_format: 'png' | 'webp';
    qualityToggle: boolean;
    tag_hint_qt: boolean;
    ucPreset: number;
    tag_hint_uc_preset: boolean;
    cfg_rescale: number;
    skip_cfg_above_sigma: number | null;
    sm: boolean;
    sm_dyn: boolean;
    straight_alpha: boolean;
    tag_hint_transparent_background: boolean;
    qualityStrategy: 'field' | 'caption';
}

export interface PluginSettings {
    schemaVersion: number;
    activeArtistId: string | null;
    activeNaiConfigId: string | null;
    recallLlmConfigId: string | null;
    promptGenLlmConfigId: string | null;
    activeImagegenPresetId: string | null;
    activeRecallPresetId: string | null;
    contextWindowSize: number;
    autoWriteSlots: boolean;
    autoRenderSlots: boolean;
    matchDefaults: MatchDefaults;
    naiParams: NaiParams;
}

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

export interface ResolveWorldInfoArgs {
    contextWindow: HostMessage[];
    messageId?: number;
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
    resolveWorldInfo(args: ResolveWorldInfoArgs): Promise<Result<string>>;
    onChatChanged(fn: (chatId: ChatId | null) => void): Unsubscribe;
    onAiMessageSettled(fn: (messageId: number) => void): Unsubscribe;
    loadSettings(): PluginSettings;
    saveSettings(settings: PluginSettings): void;
    mountSettingsPanel(element: Element): void;
    openModal(opts: {
        title: string;
        element: Element;
        wide?: boolean;
        large?: boolean;
        allowVerticalScrolling?: boolean;
    }): Promise<void>;
    registerSlashCommand(spec: object): void;
    toast(level: 'info' | 'success' | 'warning' | 'error', message: string): void;
    /** 干净卸载（裁决 D18）。可重复调用。 */
    dispose(): void;
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
        opts: { signal?: AbortSignal; config: NaiApiConfig; traceId?: string },
    ): Promise<Result<GeneratedImage[]>>;
    probe(config: NaiApiConfig): Promise<TransportProbeResult>;
}

/** 裁决 D19 */
export interface NaiGatewayDeps {
    transports: Record<string, { send: Function }>;
    decoders: Record<string, { decode: Function }>;
    maxAttempts?: number;
    sleep?: (ms: number) => Promise<void>;
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
    /** 裁决 D14 */
    traceId?: string;
}

export interface LlmCompleteResult {
    text: string;
    json?: unknown;
}

export interface LlmPort {
    complete(req: LlmCompleteRequest): Promise<Result<LlmCompleteResult>>;
    probe(config: LlmApiConfig): Promise<TransportProbeResult>;
}

/** 裁决 D19 */
export interface LlmGatewayDeps {
    transports: Record<string, { complete: Function }>;
    extractJson?: (text: string) => Result<unknown>;
    maxAttempts?: number;
    sleep?: (ms: number) => Promise<void>;
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

export interface CharacterGroup {
    schemaVersion: number;
    id: string;
    name: string;
    active: boolean;
    order: number;
    createdAt: string;
    updatedAt: string;
}

export interface Character {
    schemaVersion: number;
    id: string;
    groupId: string;
    name: string;
    keywords: string[];
    fixedFeatures: string;
    variableFeatures: Array<{ name: string; prompt: string }>;
    matchOverrides: { caseSensitive?: boolean; matchWholeWords?: boolean } | null;
    createdAt: string;
    updatedAt: string;
}

export interface CharacterRepository {
    listGroups(): Promise<Result<CharacterGroup[]>>;
    getGroup(id: string): Promise<Result<CharacterGroup | null>>;
    putGroup(group: CharacterGroup): Promise<Result<CharacterGroup>>;
    removeGroup(id: string): Promise<Result<void>>;
    listByGroup(groupId: string): Promise<Result<Character[]>>;
    get(id: string): Promise<Result<Character | null>>;
    put(character: Character): Promise<Result<Character>>;
    remove(id: string): Promise<Result<void>>;
    exportJson(): Promise<Result<object>>;
    importJson(
        data: object,
        opts?: { strategy?: 'skip' | 'overwrite' | 'rename' },
    ): Promise<Result<{ imported: number; skipped: number; errors: string[] }>>;
    onChanged(fn: (change: { type: string; id?: string; groupId?: string }) => void): Unsubscribe;
}

export interface TagLibrary {
    schemaVersion: number;
    id: string;
    name: string;
    active: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface TagEntry {
    schemaVersion: number;
    id: string;
    libraryId: string;
    key: string;
    value: string;
    createdAt: string;
    updatedAt: string;
}

export interface TagRepository {
    listLibraries(): Promise<Result<TagLibrary[]>>;
    getLibrary(id: string): Promise<Result<TagLibrary | null>>;
    putLibrary(library: TagLibrary): Promise<Result<TagLibrary>>;
    removeLibrary(id: string): Promise<Result<void>>;
    listEntries(libraryId?: string): Promise<Result<TagEntry[]>>;
    get(id: string): Promise<Result<TagEntry | null>>;
    put(entry: TagEntry): Promise<Result<TagEntry>>;
    remove(id: string): Promise<Result<void>>;
    exportJson(): Promise<Result<object>>;
    importJson(
        data: object,
        opts?: { strategy?: 'skip' | 'overwrite' | 'rename' },
    ): Promise<Result<{ imported: number; skipped: number; errors: string[] }>>;
    onChanged(fn: (change: { type: string; id?: string; libraryId?: string }) => void): Unsubscribe;
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

/** 权威在 message.extra；IDB 仅索引。见裁决 D12。 */
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
    /**
     * liveRefs 必须覆盖全部 swipe（extra + swipe_info[].extra）。
     * 空/非数组 → Err；清空须 opts.force === true（D22/D23）。
     */
    gc(
        liveRefs: ImageRef[],
        opts?: { force?: boolean },
    ): Promise<Result<{ removed: number }>>;
}

/**
 * IndexedDB 客户端（openIdb 返回值）。抛/拒 AppError，不返回 Result（D16）。
 * 含 getAllByIndex / runTransaction（D17）。
 */
export interface IdbClient {
    get(store: string, key: string): Promise<unknown>;
    put(store: string, value: unknown, key?: string): Promise<void>;
    delete(store: string, key: string): Promise<void>;
    getAll(store: string): Promise<unknown[]>;
    getAllByIndex(
        store: string,
        indexName: string,
        query: IDBValidKey | IDBKeyRange,
    ): Promise<unknown[]>;
    runTransaction(
        storeNames: string | string[],
        mode: IDBTransactionMode,
        runner: (stores: Record<string, IDBObjectStore>) => void | Promise<void>,
    ): Promise<void>;
    close(): void;
}

/** createSettingsStore 依赖：一律经 HostPort（D15） */
export interface SettingsStoreDeps {
    host: HostPort;
}

export interface SettingsStore {
    load(): PluginSettings;
    save(settings: PluginSettings): void;
    get<K extends keyof PluginSettings>(key: K, fallback?: PluginSettings[K]): PluginSettings[K];
    set<K extends keyof PluginSettings>(key: K, value: PluginSettings[K]): void;
}

/* ── External 4.14 API ──────────────────────────────── */

export interface ArtistString {
    schemaVersion: number;
    id: string;
    name: string;
    positive: string;
    negative: string;
    previewImageRef: ImageRef | null;
    createdAt: string;
    updatedAt: string;
}

/**
 * artist 三态：undefined=当前激活；null=不拼；对象=覆盖（D9）。
 */
export interface ExternalGenerateRequest {
    caption: object;
    params?: Record<string, unknown>;
    replaceCharacterKeywords: boolean;
    artist?: ArtistString | null;
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
