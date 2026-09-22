/**
 * W2-G · slot 状态机 / Abort / 持久恢复 / 文案（纯函数）。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    classifyGenerateSettlement,
    deriveSlotUiView,
    isAbortFailure,
    latestImageEntry,
    recordHasImage,
    shouldTreatAsError,
    slotButtonLabel,
    slotErrorMessage,
    slotErrorTraceId,
    slotStateClass,
} from '../../src/ui/slot-widget/slot-states.js';

describe('ui/slot slot-states', () => {
    it('四态：idle / generating / done / error', () => {
        assert.equal(deriveSlotUiView(null, null).state, 'idle');
        assert.equal(deriveSlotUiView({ images: [] }, null).state, 'idle');

        assert.equal(
            deriveSlotUiView(null, { status: 'generating' }).state,
            'generating',
        );

        const doneRec = {
            images: [{ imageRef: 'img-1', createdAt: 't', naiConfigId: null, artistId: null }],
        };
        assert.equal(deriveSlotUiView(doneRec, null).state, 'done');
        assert.equal(deriveSlotUiView(doneRec, { status: undefined }).state, 'done');

        const errView = deriveSlotUiView(null, {
            status: 'error',
            error: { message: '上游失败', traceId: 'tr-1' },
        });
        assert.equal(errView.state, 'error');
        assert.equal(errView.errorMessage, '上游失败');
        assert.equal(errView.traceId, 'tr-1');
    });

    it('Abort 不计作失败：恢复 idle/done，不进 error', () => {
        assert.equal(isAbortFailure({ code: 'UPSTREAM_ABORTED' }), true);
        assert.equal(isAbortFailure({ code: 'NAI_ABORTED' }), true);
        assert.equal(isAbortFailure({ name: 'AbortError' }), true);
        assert.equal(isAbortFailure({ ok: false, error: { code: 'UPSTREAM_ABORTED' } }), true);
        assert.equal(shouldTreatAsError({ code: 'UPSTREAM_ABORTED' }), false);

        // runtime 若误标 error+abort，derive 应忽略（shouldTreatAsError=false → 按 record）
        const view = deriveSlotUiView(
            { images: [] },
            { status: 'error', error: { code: 'UPSTREAM_ABORTED', message: '已取消' } },
        );
        assert.equal(view.state, 'idle');
        assert.equal(view.showError, false);

        const doneRec = { images: [{ imageRef: 'x' }] };
        const view2 = deriveSlotUiView(doneRec, {
            status: 'error',
            error: { code: 'UPSTREAM_ABORTED' },
        });
        assert.equal(view2.state, 'done');
    });

    it('classifyGenerateSettlement：ok / abort / error', () => {
        assert.equal(classifyGenerateSettlement(undefined).kind, 'ok');
        assert.equal(classifyGenerateSettlement({ ok: true, value: 1 }).kind, 'ok');
        assert.equal(
            classifyGenerateSettlement({ ok: false, error: { code: 'UPSTREAM_ABORTED' } }).kind,
            'abort',
        );
        const err = classifyGenerateSettlement({
            ok: false,
            error: { message: 'NAI 失败', traceId: 't9' },
        });
        assert.equal(err.kind, 'error');
        assert.equal(slotErrorMessage(err.error), 'NAI 失败');
        assert.equal(slotErrorTraceId(err.error), 't9');
    });

    it('从持久层恢复：已出图 record → done，按钮为重新生成', () => {
        const record = {
            images: [
                { imageRef: 'old' },
                { imageRef: 'latest-ref' },
            ],
        };
        assert.equal(recordHasImage(record), true);
        assert.deepEqual(latestImageEntry(record), { imageRef: 'latest-ref' });

        const view = deriveSlotUiView(record, null);
        assert.equal(view.state, 'done');
        assert.equal(view.buttonLabel, slotButtonLabel('done'));
        assert.equal(view.stateClass, slotStateClass('done'));
        assert.equal(view.showImage, true);
        assert.equal(view.busy, false);
    });

    it('generating 优先于已有图（重渲存活：不丢进行中）', () => {
        const record = { images: [{ imageRef: 'prev' }] };
        const view = deriveSlotUiView(record, { status: 'generating' });
        assert.equal(view.state, 'generating');
        assert.equal(view.busy, true);
        assert.equal(view.buttonLabel, '生图中…');
    });

    it('失败态展示中文 message 与 traceId', () => {
        const view = deriveSlotUiView(null, {
            status: 'error',
            error: { message: '找不到 slot #3', traceId: 'abc-trace' },
            traceId: 'fallback',
        });
        assert.equal(view.showError, true);
        assert.equal(view.errorMessage, '找不到 slot #3');
        assert.equal(view.traceId, 'abc-trace');
        assert.equal(view.buttonLabel, '重试');
    });
});
