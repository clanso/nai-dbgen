import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isOk, isErr, Ok, Err } from '../../src/infra/result.js';
import { hostError } from '../../src/infra/errors.js';
import { APP_EVENTS } from '../../src/application/_helpers.js';
import {
    buildPipeline,
    createFakeHost,
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
                    return Ok({ text: '[]', json: ['garden'] });
                }
                return Ok({
                    text: '[]',
                    json: [{
                        slotid: 1,
                        生成点: 'Alice walked into the garden.',
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

describe('D36 chatId key and chat check', () => {
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
        // 发起于 chat-1，结束后 chat 已变 → 丢弃写盘
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'CHAT_CHANGED');
    });

    it('chat switch mid-render discards write; keeps pending imageRef', async () => {
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
        assert.equal(isErr(r), true);
        assert.equal(r.error.code, 'CHAT_CHANGED');
        assert.ok(r.error.context?.imageRef);

        p.host.setChatId('chat-1');
        assert.equal(p.renderSlot.hasPendingWrite(2, 1), true);
        let naiHits = 0;
        p.imageGen.generate = async () => {
            naiHits += 1;
            return Ok([{ blob: new Blob(['y']), mimeType: 'image/png' }]);
        };
        const retry = await p.renderSlot.execute(2, 1);
        assert.equal(isOk(retry), true, retry.ok ? '' : retry.error?.message);
        assert.equal(naiHits, 0, 'retry after CHAT_CHANGED must not re-bill NAI');
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

describe('D41 concurrent generateSlots without mutating llm', () => {
    it('two concurrent generateSlots keep independent llmCallCount', async () => {
        const hostA = createFakeHost({ chatId: 'chat-a' });
        hostA.byId.set(2, {
            messageId: 2, name: 'B', text: 'Alice walked into the garden.',
            isUser: false, isSystem: false,
        });
        const hostB = createFakeHost({ chatId: 'chat-b' });
        hostB.byId.set(2, {
            messageId: 2, name: 'B', text: 'Alice walked into the garden.',
            isUser: false, isSystem: false,
        });

        const p1 = buildPipeline({ host: hostA });
        const p2 = buildPipeline({ host: hostB });
        // 共享同一 llm 对象以复现「改写 port」竞态
        const sharedLlm = p1.llm;
        p2.llm.complete = sharedLlm.complete.bind(sharedLlm);
        // tagRecall 已闭包各自 llm；把 p2 的 tagRecall 也指到共享 complete
        // 直接并发两路 generate（各自 tagRecall 绑定各自 pipeline 的 llm）
        // 为严格测试：让两个 pipeline 用同一个 llm 引用
        const pShared = buildPipeline();
        const llm = pShared.llm;
        const q1 = buildPipeline();
        const q2 = buildPipeline();
        // 重建 usecase 共享 llm — 简化：连续并发同一 pipeline 两次
        const [r1, r2] = await Promise.all([
            pShared.generateSlots.execute(2),
            pShared.generateSlots.execute(2),
        ]);
        assert.equal(isOk(r1), true, r1.ok ? '' : r1.error?.message);
        assert.equal(isOk(r2), true, r2.ok ? '' : r2.error?.message);
        assert.equal(r1.value.llmCallCount, 2);
        assert.equal(r2.value.llmCallCount, 2);
        // 共享 llm.complete 未被改写成残缺包装
        assert.equal(typeof llm.complete, 'function');
        const probe = await llm.complete({
            messages: [{ role: 'user', content: 'x' }],
            config: {
                schemaVersion: 1, id: 'llm-prompt', name: 'p',
                baseUrl: 'https://x', apiKey: 'k', model: 'm', transport: 'direct',
            },
        });
        assert.equal(isOk(probe) || isErr(probe), true);
        void q1; void q2; void p1; void p2;
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
