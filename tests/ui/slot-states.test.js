/**
 * W2-G · slot 状态机 / Abort / 持久恢复 / D43 Result 契约（纯函数）。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    classifyGenerateSettlement,
    deriveSlotUiView,
    isAbortFailure,
    isAlreadyRenderedFailure,
    latestImageEntry,
    recordHasImage,
    shouldTreatAsError,
    slotButtonLabel,
    slotErrorMessage,
    slotErrorTraceId,
    slotStateClass,
} from '../../src/ui/slot-widget/slot-states.js';
import { hasClassToken } from '../../src/ui/slot-widget/constants.js';

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
        const errView = deriveSlotUiView(null, {
            status: 'error',
            error: { message: '上游失败', traceId: 'tr-1' },
        });
        assert.equal(errView.state, 'error');
        assert.equal(errView.errorMessage, '上游失败');
        assert.equal(errView.traceId, 'tr-1');
    });

    it('Abort 不计作失败', () => {
        assert.equal(isAbortFailure({ code: 'UPSTREAM_ABORTED' }), true);
        assert.equal(shouldTreatAsError({ code: 'UPSTREAM_ABORTED' }), false);
        const view = deriveSlotUiView(
            { images: [] },
            { status: 'error', error: { code: 'UPSTREAM_ABORTED', message: '已取消' } },
        );
        assert.equal(view.state, 'idle');
        assert.equal(view.showError, false);
    });

    it('SLOT_ALREADY_RENDERED 不弹红错', () => {
        assert.equal(isAlreadyRenderedFailure({ code: 'SLOT_ALREADY_RENDERED' }), true);
        assert.equal(shouldTreatAsError({ code: 'SLOT_ALREADY_RENDERED' }), false);
        assert.equal(
            classifyGenerateSettlement({
                ok: false,
                error: { code: 'SLOT_ALREADY_RENDERED', message: 'slot #1 已有图片' },
            }).kind,
            'already',
        );
        const view = deriveSlotUiView(
            { images: [{ imageRef: 'x' }] },
            { status: 'error', error: { code: 'SLOT_ALREADY_RENDERED' } },
        );
        assert.equal(view.state, 'done');
        assert.equal(view.showError, false);
    });

    it('D43：undefined / 非 Result → invalid（不得当成功）', () => {
        assert.equal(classifyGenerateSettlement(undefined).kind, 'invalid');
        assert.equal(classifyGenerateSettlement(null).kind, 'invalid');
        assert.equal(classifyGenerateSettlement({}).kind, 'invalid');
        assert.equal(classifyGenerateSettlement('ok').kind, 'invalid');
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

    it('从持久层恢复：已出图 → done', () => {
        const record = {
            images: [{ imageRef: 'old' }, { imageRef: 'latest-ref' }],
        };
        assert.equal(recordHasImage(record), true);
        assert.deepEqual(latestImageEntry(record), { imageRef: 'latest-ref' });
        const view = deriveSlotUiView(record, null);
        assert.equal(view.state, 'done');
        assert.equal(view.buttonLabel, slotButtonLabel('done'));
        assert.equal(view.stateClass, slotStateClass('done'));
    });

    it('记录在但缓存已清 → idle（可再出）', () => {
        const view = deriveSlotUiView(
            { images: [{ imageRef: 'gone' }] },
            { cacheMissing: true },
        );
        assert.equal(view.state, 'idle');
        assert.equal(view.showImage, false);
        assert.equal(view.canClick, true);
        assert.equal(view.buttonLabel, slotButtonLabel('idle'));
    });

    it('generating 优先于已有图', () => {
        const view = deriveSlotUiView(
            { images: [{ imageRef: 'prev' }] },
            { status: 'generating' },
        );
        assert.equal(view.state, 'generating');
        assert.equal(view.busy, true);
    });

    it('失败态展示中文 message 与 traceId', () => {
        const view = deriveSlotUiView(null, {
            status: 'error',
            error: { message: '找不到 slot #3', traceId: 'abc-trace' },
        });
        assert.equal(view.showError, true);
        assert.equal(view.errorMessage, '找不到 slot #3');
        assert.equal(view.traceId, 'abc-trace');
    });

    it('超出保留范围：有缓存图仍不可点击再出图', () => {
        const withCache = deriveSlotUiView(null, {
            beyondRetain: true,
            hasCachedImage: true,
        });
        assert.equal(withCache.state, 'beyond_retain');
        assert.equal(withCache.showImage, true);
        assert.equal(withCache.canClick, false);
        assert.match(withCache.errorMessage, /超出保留范围/);

        const noCache = deriveSlotUiView(null, {
            beyondRetain: true,
            hasCachedImage: false,
        });
        assert.equal(noCache.state, 'beyond_retain');
        assert.equal(noCache.showImage, false);
        assert.equal(noCache.canClick, false);
    });

    it('loadError 优先且不可点击', () => {
        const view = deriveSlotUiView(
            { images: [{ imageRef: 'x' }] },
            { loadError: true, loadErrorMessage: '网络失败' },
        );
        assert.equal(view.state, 'load_error');
        assert.equal(view.canClick, false);
        assert.equal(view.errorMessage, '网络失败');
    });

    it('hasClassToken 精确匹配，不误匹配子串', () => {
        const el = { className: 'custom-nai-slot-btn nd-other' };
        assert.equal(hasClassToken(el, 'nai-slot-btn'), false);
        assert.equal(hasClassToken(el, 'custom-nai-slot-btn'), true);
        assert.equal(hasClassToken({ className: 'nd-slot__btn' }, 'nd-slot__btn'), true);
        assert.equal(hasClassToken({ className: 'nd-slot__btn-extra' }, 'nd-slot__btn'), false);
        assert.equal(hasClassToken({ className: 'x nd-slot__btn y' }, 'nd-slot__btn'), true);
    });
});
