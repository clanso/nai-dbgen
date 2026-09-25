/**
 * generate-floor.usecase 计费安全与编排语义。
 * 假 host / slotRepo / generateSlots / renderSlot，用调用次数断言。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Ok, Err, isOk, isErr } from '../../src/infra/result.js';
import { domainError, hostError } from '../../src/infra/errors.js';
import { createGenerateFloorUseCase } from '../../src/application/generate-floor.usecase.js';

/**
 * @param {object} [opts]
 */
function makeRecord(opts = {}) {
    const slotId = opts.slotId ?? 1;
    const images = opts.images ?? [];
    return {
        schemaVersion: 1,
        messageId: opts.messageId ?? 5,
        slotId,
        caption: {},
        anchorSentence: `anchor-${slotId}`,
        images,
        createdAt: 't0',
        presetId: null,
        llmConfigId: null,
    };
}

/**
 * @param {object} [opts]
 */
function createFakes(opts = {}) {
    let chatId = opts.chatId ?? 'chat-a';
    /** @type {import('../../src/domain/model/slot.js').SlotRecord[]|null} */
    let records = opts.records !== undefined ? opts.records : null;
    /** @type {import('../../src/infra/errors.js').AppError|null} */
    let getByMessageErr = opts.getByMessageErr ?? null;

    let generateCalls = 0;
    let renderCalls = 0;
    /** @type {number[]} */
    const renderedSlotIds = [];

    /** @type {Map<number, Promise<*>>} */
    const writing = new Map();
    /** @type {Map<string, Promise<*>>} */
    const rendering = new Map();

    /** @type {import('../../src/ports/host.port.js').HostMessage[]} */
    const aiMessages = opts.aiMessages ?? [{
        messageId: 5,
        name: 'Bot',
        text: 'hello',
        isUser: false,
        isSystem: false,
    }];

    const host = {
        getCurrentChatId: () => chatId,
        setChatId: (id) => { chatId = id; },
        getRecentAiMessages: (n) => aiMessages.slice(0, n),
        getMessage: (id) => aiMessages.find((m) => m.messageId === id) ?? null,
    };

    const slotRepo = {
        async getByMessage(messageId) {
            if (getByMessageErr) {
                return Err(getByMessageErr);
            }
            if (records == null) {
                return Ok([]);
            }
            return Ok(records.filter((r) => r.messageId === messageId || true).map((r) => ({
                ...r,
                messageId,
            })));
        },
        setRecords(next) {
            records = next;
        },
        setGetByMessageErr(err) {
            getByMessageErr = err;
        },
    };

    const generateSlots = {
        /**
         * @param {number} messageId
         * @param {{ signal?: AbortSignal }} [opts]
         */
        execute(messageId, opts) {
            const key = messageId;
            const existing = writing.get(key);
            if (existing) {
                return existing;
            }
            const promise = (async () => {
                generateCalls += 1;
                if (opts?.signal?.aborted) {
                    return Err(domainError({
                        code: 'UPSTREAM_ABORTED',
                        message: '请求已取消',
                    }));
                }
                if (opts?.failGenerate) {
                    return Err(domainError({
                        code: 'GEN_FAIL',
                        message: '生成提示词失败',
                    }));
                }
                const created = opts?.newRecords ?? [
                    makeRecord({ messageId, slotId: 1 }),
                    makeRecord({ messageId, slotId: 2 }),
                ];
                records = created;
                return Ok({ records: created, traceId: 't', llmCallCount: 2, unmatchedKeys: [] });
            })().finally(() => {
                if (writing.get(key) === promise) {
                    writing.delete(key);
                }
            });
            writing.set(key, promise);
            return promise;
        },
        isWriting(messageId) {
            return writing.has(messageId);
        },
        get callCount() {
            return generateCalls;
        },
    };

    // allow injecting fail / custom records via wrapping
    const generateSlotsOuter = {
        /** @type {(messageId: number, opts?: object) => Promise<*>} */
        execute: (messageId, opts) => generateSlots.execute(messageId, {
            ...opts,
            failGenerate: opts?.failGenerate ?? optsFailGenerate,
            newRecords: opts?.newRecords ?? optsNewRecords,
        }),
        isWriting: (mid) => generateSlots.isWriting(mid),
        get callCount() {
            return generateCalls;
        },
    };
    let optsFailGenerate = false;
    /** @type {import('../../src/domain/model/slot.js').SlotRecord[]|undefined} */
    let optsNewRecords;

    /** @type {Map<number, import('../../src/infra/errors.js').AppError>} */
    const renderFailBySlot = new Map(opts.renderFailBySlot ?? []);
    /** @type {(() => void)|null} */
    let onBeforeRender = null;
    let releaseRender = /** @type {(() => void)|null} */ (null);
    /** @type {Promise<void>|null} */
    let renderGate = null;

    const renderSlot = {
        /**
         * @param {number} messageId
         * @param {number} slotId
         * @param {{ signal?: AbortSignal }} [ropts]
         */
        execute(messageId, slotId, ropts) {
            const key = `${messageId}:${slotId}`;
            const existing = rendering.get(key);
            if (existing) {
                return existing;
            }
            const promise = (async () => {
                if (onBeforeRender) {
                    onBeforeRender(messageId, slotId);
                }
                if (renderGate) {
                    await renderGate;
                }
                renderCalls += 1;
                renderedSlotIds.push(slotId);
                if (ropts?.signal?.aborted) {
                    return Err(domainError({
                        code: 'UPSTREAM_ABORTED',
                        message: '请求已取消',
                    }));
                }
                const fail = renderFailBySlot.get(slotId);
                if (fail) {
                    return Err(fail);
                }
                // 出图成功后更新 records 的 images，避免同进程二次判定
                if (records) {
                    records = records.map((r) => {
                        if (r.slotId !== slotId) {
                            return r;
                        }
                        return {
                            ...r,
                            images: [{
                                imageRef: `ref-${slotId}`,
                                createdAt: 't1',
                                naiConfigId: null,
                                artistId: null,
                            }],
                        };
                    });
                }
                return Ok({
                    record: makeRecord({
                        messageId,
                        slotId,
                        images: [{
                            imageRef: `ref-${slotId}`,
                            createdAt: 't1',
                            naiConfigId: null,
                            artistId: null,
                        }],
                    }),
                    traceId: 'tr',
                });
            })().finally(() => {
                if (rendering.get(key) === promise) {
                    rendering.delete(key);
                }
            });
            rendering.set(key, promise);
            return promise;
        },
        isRendering(messageId, slotId) {
            return rendering.has(`${messageId}:${slotId}`);
        },
        get callCount() {
            return renderCalls;
        },
        get renderedSlotIds() {
            return renderedSlotIds.slice();
        },
        failSlot(slotId, err) {
            renderFailBySlot.set(slotId, err);
        },
        setOnBeforeRender(fn) {
            onBeforeRender = fn;
        },
        blockNextRenders() {
            renderGate = new Promise((r) => { releaseRender = r; });
        },
        releaseRenders() {
            if (releaseRender) {
                releaseRender();
            }
            renderGate = null;
            releaseRender = null;
        },
    };

    return {
        host,
        slotRepo,
        generateSlots: generateSlotsOuter,
        renderSlot,
        setFailGenerate(v) {
            optsFailGenerate = v;
        },
        setNewRecords(recs) {
            optsNewRecords = recs;
        },
        get generateCalls() {
            return generateCalls;
        },
        get renderCalls() {
            return renderCalls;
        },
    };
}

describe('generateFloor — D39 read Err', () => {
    it('getByMessage Err → zero generateSlots / renderSlot calls', async () => {
        const f = createFakes({
            getByMessageErr: hostError({
                code: 'READ_FAIL',
                message: '读失败',
                hint: '请重试',
            }),
        });
        const uc = createGenerateFloorUseCase(f);
        const r = await uc.execute(5);
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'READ_FAIL');
        assert.equal(f.generateCalls, 0);
        assert.equal(f.renderCalls, 0);
    });
});

describe('generateFloor — no records then write + render', () => {
    it('writes slots once then renders each; rendered correct', async () => {
        const f = createFakes({ records: null });
        f.setNewRecords([
            makeRecord({ messageId: 5, slotId: 1 }),
            makeRecord({ messageId: 5, slotId: 2 }),
            makeRecord({ messageId: 5, slotId: 3 }),
        ]);
        const uc = createGenerateFloorUseCase(f);
        const r = await uc.execute(5);
        assert.equal(isOk(r), true, r.ok ? '' : r.error?.message);
        assert.equal(r.value.wroteSlots, true);
        assert.deepEqual(r.value.rendered, [1, 2, 3]);
        assert.equal(r.value.skipped.length, 0);
        assert.equal(r.value.failed.length, 0);
        assert.equal(f.generateCalls, 1);
        assert.equal(f.renderCalls, 3);
        assert.deepEqual(f.renderSlot.renderedSlotIds, [1, 2, 3]);
    });
});

describe('generateFloor — already rendered', () => {
    it('all already-rendered → 0 LLM, 0 NAI, skipped already-rendered', async () => {
        const f = createFakes({
            records: [
                makeRecord({
                    slotId: 1,
                    images: [{ imageRef: 'a', createdAt: 't', naiConfigId: null, artistId: null }],
                }),
                makeRecord({
                    slotId: 2,
                    images: [{ imageRef: 'b', createdAt: 't', naiConfigId: null, artistId: null }],
                }),
            ],
        });
        const uc = createGenerateFloorUseCase(f);
        const r = await uc.execute(5);
        assert.equal(isOk(r), true);
        assert.equal(r.value.wroteSlots, false);
        assert.deepEqual(r.value.rendered, []);
        assert.equal(f.generateCalls, 0);
        assert.equal(f.renderCalls, 0);
        assert.equal(r.value.skipped.length, 2);
        assert.ok(r.value.skipped.every((s) => s.reason === 'already-rendered'));
    });

    it('partially rendered → only renders missing', async () => {
        const f = createFakes({
            records: [
                makeRecord({
                    slotId: 1,
                    images: [{ imageRef: 'a', createdAt: 't', naiConfigId: null, artistId: null }],
                }),
                makeRecord({ slotId: 2, images: [] }),
                makeRecord({ slotId: 3, images: [] }),
            ],
        });
        const uc = createGenerateFloorUseCase(f);
        const r = await uc.execute(5);
        assert.equal(isOk(r), true);
        assert.equal(r.value.wroteSlots, false);
        assert.equal(f.generateCalls, 0);
        assert.equal(f.renderCalls, 2);
        assert.deepEqual(r.value.rendered, [2, 3]);
        assert.deepEqual(r.value.skipped, [{ slotId: 1, reason: 'already-rendered' }]);
    });
});

describe('generateFloor — D57 concurrent same floor', () => {
    it('two concurrent execute → total one write and one render per slot', async () => {
        const f = createFakes({ records: null });
        f.setNewRecords([
            makeRecord({ slotId: 1 }),
            makeRecord({ slotId: 2 }),
        ]);
        // 阻塞首次出图，确保两路 execute 重叠在同一 Promise 窗口
        f.renderSlot.blockNextRenders();
        const uc = createGenerateFloorUseCase(f);

        const p1 = uc.execute(5);
        const p2 = uc.execute(5);
        assert.equal(uc.isRunning(5), true);
        assert.equal(uc.isRunning(), true);

        // 等写 slot 完成、卡在第一张图
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));

        f.renderSlot.releaseRenders();
        const [a, b] = await Promise.all([p1, p2]);

        assert.equal(isOk(a), true);
        assert.equal(isOk(b), true);
        assert.equal(a, b, 'must share the same settled Result');
        assert.equal(f.generateCalls, 1, 'total generateSlots once (not once each)');
        assert.equal(f.renderCalls, 2, 'total one render per slot');
        assert.deepEqual(a.value.rendered, [1, 2]);
        assert.equal(uc.isRunning(5), false);
        assert.equal(uc.isRunning(), false);
    });
});

describe('generateFloor — chat switch / abort', () => {
    it('chat switch mid-render → later slots skipped as chat-switched', async () => {
        const f = createFakes({
            records: [
                makeRecord({ slotId: 1, images: [] }),
                makeRecord({ slotId: 2, images: [] }),
                makeRecord({ slotId: 3, images: [] }),
            ],
        });
        let rendersStarted = 0;
        f.renderSlot.setOnBeforeRender(() => {
            rendersStarted += 1;
            if (rendersStarted === 1) {
                // 第一张出图发起后立刻切聊天；后续循环应停
                f.host.setChatId('chat-b');
            }
        });
        const uc = createGenerateFloorUseCase(f);
        const r = await uc.execute(5);
        assert.equal(isOk(r), true);
        assert.deepEqual(r.value.rendered, [1]);
        assert.equal(f.renderCalls, 1);
        const switched = r.value.skipped.filter((s) => s.reason === 'chat-switched');
        assert.deepEqual(switched.map((s) => s.slotId), [2, 3]);
    });

    it('signal abort mid-render → stops subsequent', async () => {
        const f = createFakes({
            records: [
                makeRecord({ slotId: 1, images: [] }),
                makeRecord({ slotId: 2, images: [] }),
                makeRecord({ slotId: 3, images: [] }),
            ],
        });
        const ac = new AbortController();
        f.renderSlot.setOnBeforeRender((_m, slotId) => {
            if (slotId === 1) {
                // 第一张开始后中止；本张仍会跑完（fake 在 await 后才 check），后续停
            }
        });
        // 在第一张 render 返回后中止：用 gate + 手动 abort
        f.renderSlot.blockNextRenders();
        const uc = createGenerateFloorUseCase(f);
        const p = uc.execute(5, { signal: ac.signal });
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));
        ac.abort();
        f.renderSlot.releaseRenders();
        const r = await p;
        assert.equal(isOk(r), true);
        // 第一张在 abort 后仍可能计入 failed（signal 已 aborted）或 rendered
        // 关键：后续 slot 不再调用 render
        assert.ok(f.renderCalls <= 1, `expected <=1 render, got ${f.renderCalls}`);
        assert.equal(r.value.rendered.length + r.value.failed.length, f.renderCalls);
        assert.ok(
            !r.value.rendered.includes(2) && !r.value.failed.some((x) => x.slotId === 2),
            'slot 2 must not be processed after abort',
        );
        assert.ok(
            !r.value.rendered.includes(3) && !r.value.failed.some((x) => x.slotId === 3),
            'slot 3 must not be processed after abort',
        );
    });
});

describe('generateFloor — no AI floor / partial fail / isRunning', () => {
    it('no AI message → Err and zero calls', async () => {
        const f = createFakes({ aiMessages: [], records: null });
        const uc = createGenerateFloorUseCase(f);
        const r = await uc.execute();
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'NO_AI_MESSAGE');
        assert.ok(r.error.hint);
        assert.equal(f.generateCalls, 0);
        assert.equal(f.renderCalls, 0);
    });

    it('one slot render fails → others continue; failed recorded', async () => {
        const f = createFakes({
            records: [
                makeRecord({ slotId: 1, images: [] }),
                makeRecord({ slotId: 2, images: [] }),
                makeRecord({ slotId: 3, images: [] }),
            ],
        });
        f.renderSlot.failSlot(2, domainError({
            code: 'NAI_FAIL',
            message: '上游失败',
            hint: '检查 NAI 配置',
        }));
        const uc = createGenerateFloorUseCase(f);
        const r = await uc.execute(5);
        assert.equal(isOk(r), true, 'partial failure still Ok(summary)');
        assert.deepEqual(r.value.rendered, [1, 3]);
        assert.equal(r.value.failed.length, 1);
        assert.equal(r.value.failed[0].slotId, 2);
        assert.match(r.value.failed[0].message, /上游失败/);
        assert.match(r.value.failed[0].message, /检查 NAI 配置/);
        assert.equal(f.renderCalls, 3);
        assert.equal(f.generateCalls, 0);
    });

    it('isRunning true while executing, false after', async () => {
        const f = createFakes({
            records: [makeRecord({ slotId: 1, images: [] })],
        });
        f.renderSlot.blockNextRenders();
        const uc = createGenerateFloorUseCase(f);
        assert.equal(uc.isRunning(5), false);
        const p = uc.execute(5);
        assert.equal(uc.isRunning(5), true);
        assert.equal(uc.isRunning(), true);
        f.renderSlot.releaseRenders();
        const r = await p;
        assert.equal(isOk(r), true);
        assert.equal(uc.isRunning(5), false);
        assert.equal(uc.isRunning(), false);
    });

    it('omitted messageId uses latest AI floor', async () => {
        const f = createFakes({
            aiMessages: [{
                messageId: 9,
                name: 'Bot',
                text: 'x',
                isUser: false,
                isSystem: false,
            }],
            records: [makeRecord({ messageId: 9, slotId: 1, images: [] })],
        });
        const uc = createGenerateFloorUseCase(f);
        const r = await uc.execute();
        assert.equal(isOk(r), true);
        assert.equal(r.value.messageId, 9);
        assert.deepEqual(r.value.rendered, [1]);
    });
});
