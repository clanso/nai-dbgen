import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isOk, isErr, Ok } from '../../src/infra/result.js';
import { APP_EVENTS } from '../../src/application/_helpers.js';
import {
    buildPipeline,
    makeCaption,
} from './_fakes.js';

/**
 * @param {ReturnType<import('../../src/infra/event-bus.js').createEventBus>} bus
 * @param {string} type
 * @param {number} [timeoutMs]
 */
function waitForEvent(bus, type, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timeout waiting ${type}`)), timeoutMs);
        const off = bus.on(type, (payload) => {
            clearTimeout(t);
            off();
            resolve(payload);
        });
    });
}

describe('D35 render gate — single NAI for concurrent UI+auto', () => {
    it('UI path and auto path concurrent on same slot → NAI once', async () => {
        let release;
        const gate = new Promise((r) => { release = r; });
        let naiStarts = 0;
        const p = buildPipeline({
            llmComplete: async (req) => {
                if (req.config.id === 'llm-recall') {
                    const positions = [{
                        生成点: 'Alice walked into the garden.',
                        key: ['1'],
                    }];
                    return Ok({ text: JSON.stringify(positions), json: positions });
                }
                return Ok({
                    text: '[]',
                    json: [{
                        slotid: 1,
                        生图内容: makeCaption('scene'),
                    }],
                });
            },
        });
        // 替换 NAI 为可阻塞版本
        const origGen = p.naiCalls;
        p.imageGen.generate = async (req) => {
            naiStarts += 1;
            await gate;
            origGen.push({ payload: {}, opts: {} });
            return Ok([{ blob: new Blob(['x']), mimeType: 'image/png' }]);
        };
        // 重新挂到 renderSlot 用的是同一 imageGen 对象 — 上面已替换方法

        const gen = await p.generateSlots.execute(2);
        assert.equal(isOk(gen), true);

        const a = p.renderSlot.execute(2, 1);
        const b = p.renderSlot.execute(2, 1);
        assert.equal(p.renderSlot.isRendering(2, 1), true);
        release();
        const [ra, rb] = await Promise.all([a, b]);
        assert.equal(isOk(ra), true);
        assert.equal(isOk(rb), true);
        assert.equal(naiStarts, 1, 'concurrent execute must share one NAI call');
    });

    it('already-rendered slot refused without force', async () => {
        const p = buildPipeline();
        await p.generateSlots.execute(2);
        const first = await p.renderSlot.execute(2, 1);
        assert.equal(isOk(first), true);
        const nai = p.naiCalls.length;
        const second = await p.renderSlot.execute(2, 1);
        assert.equal(isErr(second), true);
        assert.equal(second.error.code, 'SLOT_ALREADY_RENDERED');
        assert.equal(p.naiCalls.length, nai);
    });
});

describe('D36 chatId key and session-file write on chat switch', () => {
    it('inflight / isRendering keys are chat-scoped', async () => {
        let release;
        const gate = new Promise((r) => { release = r; });
        const p = buildPipeline();
        await p.generateSlots.execute(2);

        p.imageGen.generate = async () => {
            await gate;
            return Ok([{ blob: new Blob(['x']), mimeType: 'image/png' }]);
        };

        const pending = p.renderSlot.execute(2, 1);
        assert.equal(p.renderSlot.isRendering(2, 1), true);

        p.host.setChatId('chat-2');
        // 同一 (messageId, slotId) 在新聊天下不算「正在出图」
        assert.equal(p.renderSlot.isRendering(2, 1), false);

        release();
        const r = await pending;
        // 发起于 chat-1：切走后仍写入原会话文件
        assert.equal(isOk(r), true, r.ok ? '' : r.error?.message);
        assert.equal(r.value.chatChanged, true);
        const rec = await p.slotRepo.get(2, 1);
        assert.equal(isOk(rec), true);
        assert.ok(rec.value?.images?.length >= 1);
    });

    it('chat switch mid-render still records image to original session; no re-bill on retry', async () => {
        let release;
        const gate = new Promise((r) => { release = r; });
        const p = buildPipeline();
        await p.generateSlots.execute(2);

        p.imageGen.generate = async () => {
            await gate;
            return Ok([{ blob: new Blob(['x']), mimeType: 'image/png' }]);
        };

        const pending = p.renderSlot.execute(2, 1);
        p.host.setChatId('chat-other');
        release();
        const r = await pending;
        assert.equal(isOk(r), true, r.ok ? '' : r.error?.message);
        assert.equal(r.value.chatChanged, true);
        assert.ok(r.value.imageRef);

        p.host.setChatId('chat-1');
        // 已写入原会话 → 非 force 应拒重出，且不得再调 NAI
        let naiHits = 0;
        p.imageGen.generate = async () => {
            naiHits += 1;
            return Ok([{ blob: new Blob(['y']), mimeType: 'image/png' }]);
        };
        const retry = await p.renderSlot.execute(2, 1);
        assert.equal(isErr(retry), true);
        assert.equal(retry.error.code, 'SLOT_ALREADY_RENDERED');
        assert.equal(naiHits, 0, 'already recorded must not re-bill NAI');
    });
});

describe('D37 put before replaceMessageText', () => {
    it('put failure leaves message text without orphan token', async () => {
        const p = buildPipeline();
        const before = p.host.getMessage(2).text;
        p.slotRepo.failPut = true;
        const r = await p.generateSlots.execute(2);
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'PUT_FAIL');
        const after = p.host.getMessage(2).text;
        assert.equal(after, before);
        assert.equal(after.includes('<IMG>'), false);
    });
});

describe('D38 auto-write idempotency / swipe', () => {
    it('second settled does not re-run LLM or wipe images', async () => {
        const p = buildPipeline();
        p.patchSettings({ autoWriteSlots: true, autoRenderSlots: true });
        p.autoTrigger.start();

        const rendered = waitForEvent(p.bus, APP_EVENTS.SLOT_RENDERED);
        p.host.emitSettled(2);
        await rendered;

        const llmAfterFirst = p.llmCalls.length;
        const naiAfterFirst = p.naiCalls.length;
        const rec1 = await p.slotRepo.get(2, 1);
        assert.ok(rec1.ok && rec1.value.images.length >= 1);
        const imageRef = rec1.value.images[0].imageRef;

        // 二次 settled（回翻 swipe）：应零计费
        p.host.emitSettled(2);
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));

        assert.equal(p.llmCalls.length, llmAfterFirst, 'no second LLM run');
        assert.equal(p.naiCalls.length, naiAfterFirst, 'no second NAI');
        const rec2 = await p.slotRepo.get(2, 1);
        assert.equal(rec2.value.images[0].imageRef, imageRef, 'images not wiped');
    });

    it('manual regenerate preserves existing images on put', async () => {
        const p = buildPipeline();
        await p.generateSlots.execute(2);
        await p.renderSlot.execute(2, 1);
        const before = await p.slotRepo.get(2, 1);
        assert.ok(before.value.images.length >= 1);
        const ref = before.value.images[0].imageRef;

        const again = await p.generateSlots.execute(2);
        assert.equal(isOk(again), true);
        const after = await p.slotRepo.get(2, 1);
        assert.ok(after.value.images.some((i) => i.imageRef === ref));
    });
});

describe('D39 get Err must not render', () => {
    it('slotRepo.get Err → skip render (auto path)', async () => {
        const p = buildPipeline();
        // 先写好 slot，再开 auto，避免 generate 触发的 written 抢跑
        await p.generateSlots.execute(2);
        const naiBefore = p.naiCalls.length;

        p.patchSettings({ autoWriteSlots: false, autoRenderSlots: true });
        p.autoTrigger.start();
        p.slotRepo.failGet = true;

        p.bus.emit(APP_EVENTS.SLOTS_WRITTEN, { messageId: 2, records: [], unmatchedKeys: [] });
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setImmediate(r));

        assert.equal(p.naiCalls.length, naiBefore, 'get Err must not trigger NAI');
    });
});

describe('D42 recordImage fail then retry write-only', () => {
    it('recordImage failure then retry → NAI only once', async () => {
        const p = buildPipeline();
        await p.generateSlots.execute(2);
        p.slotRepo.failRecordImageOnce = true;

        const first = await p.renderSlot.execute(2, 1);
        assert.equal(isErr(first), true);
        assert.equal(first.error.context?.retryableWrite, true);
        assert.ok(first.error.context?.imageRef);
        assert.equal(p.renderSlot.hasPendingWrite(2, 1), true);
        const nai = p.naiCalls.length;
        assert.ok(nai >= 1);

        const second = await p.renderSlot.execute(2, 1);
        assert.equal(isOk(second), true, second.ok ? '' : second.error?.message);
        assert.equal(p.naiCalls.length, nai, 'retry must not call NAI again');
        const rec = await p.slotRepo.get(2, 1);
        assert.ok(rec.value.images.length >= 1);
    });
});

describe('D54 write gate — single LLM for concurrent generateSlots', () => {
    it('same floor concurrent → total two LLM calls, shared result', async () => {
        let release;
        const gate = new Promise((r) => { release = r; });
        let llmStarts = 0;
        const p = buildPipeline({
            llmComplete: async (req) => {
                llmStarts += 1;
                await gate;
                if (req.config.id === 'llm-recall') {
                    const positions = [{
                        生成点: 'Alice walked into the garden.',
                        key: ['1'],
                    }];
                    return Ok({ text: JSON.stringify(positions), json: positions });
                }
                return Ok({
                    text: '[]',
                    json: [{
                        slotid: 1,
                        生图内容: makeCaption('scene'),
                    }],
                });
            },
        });

        const a = p.generateSlots.execute(2);
        assert.equal(p.generateSlots.isWriting(2), true);
        const b = p.generateSlots.execute(2);
        release();
        const [r1, r2] = await Promise.all([a, b]);
        assert.equal(isOk(r1), true, r1.ok ? '' : r1.error?.message);
        assert.equal(isOk(r2), true, r2.ok ? '' : r2.error?.message);
        assert.equal(r1.value, r2.value, 'must share the same result object');
        assert.equal(r1.value.llmCallCount, 2);
        assert.equal(llmStarts, 2, 'concurrent same floor must bill LLM exactly twice total');
        assert.equal(p.generateSlots.isWriting(2), false);
    });

    it('auto-write + manual concurrent on same floor → still two LLM', async () => {
        let release;
        const gate = new Promise((r) => { release = r; });
        let llmStarts = 0;
        const p = buildPipeline({
            llmComplete: async (req) => {
                llmStarts += 1;
                await gate;
                if (req.config.id === 'llm-recall') {
                    const positions = [{
                        生成点: 'Alice walked into the garden.',
                        key: ['1'],
                    }];
                    return Ok({ text: JSON.stringify(positions), json: positions });
                }
                return Ok({
                    text: '[]',
                    json: [{
                        slotid: 1,
                        生图内容: makeCaption('scene'),
                    }],
                });
            },
        });
        p.patchSettings({ autoWriteSlots: true, autoRenderSlots: false });
        p.autoTrigger.start();

        const written = waitForEvent(p.bus, APP_EVENTS.SLOTS_WRITTEN);
        p.host.emitSettled(2);
        for (let i = 0; i < 40 && !p.generateSlots.isWriting(2); i += 1) {
            await new Promise((r) => setImmediate(r));
        }
        assert.equal(p.generateSlots.isWriting(2), true, 'auto path should hold write lock');
        const manual = p.generateSlots.execute(2);
        release();
        await Promise.all([written, manual]);
        assert.equal(llmStarts, 2, 'auto+manual must not double-bill LLM');
    });
});

describe('D41 concurrent generateSlots on different floors without mutating llm', () => {
    it('two different floors concurrent keep llm.complete identity and each bill twice', async () => {
        const p = buildPipeline();
        p.host.byId.set(3, {
            messageId: 3,
            name: 'B',
            text: 'Alice walked into the garden.',
            isUser: false,
            isSystem: false,
        });
        // contextCollector 读 host 窗口；确保 3 也能走通
        const completeBefore = p.llm.complete;
        const [r2, r3] = await Promise.all([
            p.generateSlots.execute(2),
            p.generateSlots.execute(3),
        ]);
        assert.equal(isOk(r2), true, r2.ok ? '' : r2.error?.message);
        assert.equal(isOk(r3), true, r3.ok ? '' : r3.error?.message);
        assert.equal(r2.value.llmCallCount, 2);
        assert.equal(r3.value.llmCallCount, 2);
        assert.equal(p.llm.complete, completeBefore, 'must not wrap/replace shared llm.complete');
        // 不同楼各跑一轮 → 合计 4 次 LLM
        assert.equal(p.llmCalls.length, 4);
    });
});

describe('D32 autoRender via bus without setTimeout race', () => {
    it('only autoRender + manual generate awaits slot:rendered', async () => {
        const p = buildPipeline();
        p.patchSettings({ autoWriteSlots: false, autoRenderSlots: true });
        p.autoTrigger.start();

        const rendered = waitForEvent(p.bus, APP_EVENTS.SLOT_RENDERED);
        const gen = await p.generateSlots.execute(2);
        assert.equal(isOk(gen), true);
        await rendered;
        const rec = await p.slotRepo.get(2, 1);
        assert.ok(rec.ok && rec.value.images.length >= 1);
    });
});

describe('renderSlot bus emit after inflight clear', () => {
    it('SLOT_RENDERED fires only after isRendering becomes false', async () => {
        const p = buildPipeline();
        await p.generateSlots.execute(2);

        /** @type {boolean|null} */
        let renderingAtEmit = null;
        p.bus.on(APP_EVENTS.SLOT_RENDERED, () => {
            renderingAtEmit = p.renderSlot.isRendering(2, 1);
        });

        const r = await p.renderSlot.execute(2, 1);
        assert.equal(isOk(r), true);
        assert.equal(renderingAtEmit, false, 'subscribers must see isRendering===false');
        assert.equal(p.renderSlot.isRendering(2, 1), false);
    });

    it('failure emits SLOT_RENDER_FAILED after inflight clear', async () => {
        const p = buildPipeline();
        await p.generateSlots.execute(2);
        p.imageGen.generate = async () => ({
            ok: false,
            error: { code: 'UPSTREAM_HTTP', message: 'NAI 500', category: 'upstream' },
        });

        /** @type {boolean|null} */
        let renderingAtEmit = null;
        /** @type {unknown} */
        let failedPayload = null;
        const failed = waitForEvent(p.bus, APP_EVENTS.SLOT_RENDER_FAILED);
        p.bus.on(APP_EVENTS.SLOT_RENDER_FAILED, (payload) => {
            renderingAtEmit = p.renderSlot.isRendering(2, 1);
            failedPayload = payload;
        });

        const r = await p.renderSlot.execute(2, 1);
        assert.equal(isErr(r), true);
        await failed;
        assert.equal(renderingAtEmit, false);
        assert.equal(/** @type {{ messageId?: number }} */ (failedPayload).messageId, 2);
        assert.equal(/** @type {{ slotId?: number }} */ (failedPayload).slotId, 1);
        assert.equal(p.renderSlot.isRendering(2, 1), false);
    });
});
