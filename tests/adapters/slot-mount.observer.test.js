import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveMessageIdFromElement,
    resolveSlotIdFromElement,
    ensureSlotUnprefixedClasses,
    createSlotMountObserver,
    collectUnmountedSlots,
    SLOT_ROOT_CLASS,
    SLOT_BTN_CLASS,
    SLOT_MOUNTED_ATTR,
    isHostStreamingActive,
} from '../../src/adapters/host/slot-mount.observer.js';
import { stripSlotTokens } from '../../src/domain/slot/slot-token.js';
import {
    createGenerateInterceptor,
    registerGenerateInterceptorGlobal,
    unregisterGenerateInterceptorGlobal,
    GENERATE_INTERCEPTOR_GLOBAL_NAME,
} from '../../src/adapters/host/generate-interceptor.js';

/**
 * @param {number} slotId
 * @param {number} mesId
 */
function makeSlotNode(slotId, mesId) {
    /** @type {Record<string, string>} */
    const attrs = { 'data-slot': String(slotId) };
    const mes = {
        getAttribute(n) {
            return n === 'mesid' ? String(mesId) : null;
        },
    };
    return {
        getAttribute(n) {
            return attrs[n] ?? null;
        },
        setAttribute(n, v) {
            attrs[n] = String(v);
        },
        removeAttribute(n) {
            delete attrs[n];
        },
        classList: {
            add() {},
        },
        querySelector() {
            return null;
        },
        closest(sel) {
            if (sel === '.mes[mesid]' || sel === '.mes') {
                return mes;
            }
            return null;
        },
    };
}

describe('slot-mount.observer pure helpers', () => {
    it('resolveSlotIdFromElement', () => {
        const el = {
            getAttribute(name) {
                return name === 'data-slot' ? '3' : null;
            },
        };
        assert.equal(resolveSlotIdFromElement(el), 3);
        assert.equal(resolveSlotIdFromElement({ getAttribute: () => '0' }), -1);
        assert.equal(resolveSlotIdFromElement(null), -1);
    });

    it('resolveMessageIdFromElement 走 closest(.mes[mesid])', () => {
        const mes = {
            getAttribute(name) {
                return name === 'mesid' ? '12' : null;
            },
        };
        const el = {
            closest(sel) {
                return sel === '.mes[mesid]' ? mes : null;
            },
        };
        assert.equal(resolveMessageIdFromElement(el), 12);
        assert.equal(resolveMessageIdFromElement({ closest: () => null }), -1);
    });

    it('ensureSlotUnprefixedClasses 补 nd-slot / nd-slot__btn', () => {
        const classes = new Set(['custom-nai-slot']);
        const btnClasses = new Set(['custom-nai-slot-btn']);
        const root = {
            classList: {
                add(c) {
                    classes.add(c);
                },
            },
            querySelector(sel) {
                if (String(sel).includes('button') || String(sel).includes('nai-slot-btn')) {
                    return {
                        classList: {
                            add(c) {
                                btnClasses.add(c);
                            },
                        },
                    };
                }
                return null;
            },
        };
        ensureSlotUnprefixedClasses(root);
        assert.equal(classes.has(SLOT_ROOT_CLASS), true);
        assert.equal(btnClasses.has(SLOT_BTN_CLASS), true);
    });

    it('createSlotMountObserver start/stop 幂等', () => {
        const mounts = [];
        const observer = createSlotMountObserver({
            getChatRoot: () => null,
            mountSlot(_messageEl, messageId, slotId) {
                mounts.push({ messageId, slotId });
            },
        });
        observer.start();
        observer.start();
        observer.reconcile();
        observer.stop();
        observer.stop();
        assert.deepEqual(mounts, []);
    });
});

describe('slot-mount streaming (R-09)', () => {
    /** @type {unknown} */
    let prevSt;

    beforeEach(() => {
        prevSt = globalThis.SillyTavern;
    });

    afterEach(() => {
        if (prevSt === undefined) {
            delete globalThis.SillyTavern;
        } else {
            globalThis.SillyTavern = prevSt;
        }
    });

    it('isHostStreamingActive 识别真实 streamingProcessor 形态', () => {
        delete globalThis.SillyTavern;
        assert.equal(isHostStreamingActive(), false);

        globalThis.SillyTavern = {
            getContext: () => ({ streamingProcessor: null }),
        };
        assert.equal(isHostStreamingActive(), false);

        globalThis.SillyTavern = {
            getContext: () => ({
                streamingProcessor: { messageId: 3, isFinished: true, isStopped: false },
            }),
        };
        assert.equal(isHostStreamingActive(), false);

        globalThis.SillyTavern = {
            getContext: () => ({
                streamingProcessor: { messageId: 3, isFinished: false, isStopped: true },
            }),
        };
        assert.equal(isHostStreamingActive(), false);

        globalThis.SillyTavern = {
            getContext: () => ({
                streamingProcessor: { messageId: 3, isFinished: false, isStopped: false },
            }),
        };
        assert.equal(isHostStreamingActive(), true);
    });

    it('流式中 reconcile 不挂载；结束后才挂', () => {
        const slot = makeSlotNode(1, 7);
        const root = {
            querySelectorAll() {
                return [slot];
            },
        };
        const mounts = [];
        const observer = createSlotMountObserver({
            getChatRoot: () => root,
            mountSlot(_el, messageId, slotId) {
                mounts.push({ messageId, slotId });
            },
        });

        const sp = { messageId: 7, isFinished: false, isStopped: false };
        globalThis.SillyTavern = { getContext: () => ({ streamingProcessor: sp }) };

        observer.reconcile();
        assert.deepEqual(mounts, []);
        assert.equal(slot.getAttribute(SLOT_MOUNTED_ATTR), null);

        // settled：流式结束
        sp.isFinished = true;
        observer.reconcile();
        assert.deepEqual(mounts, [{ messageId: 7, slotId: 1 }]);
        assert.equal(slot.getAttribute(SLOT_MOUNTED_ATTR), '1');

        // 幂等：再 reconcile 不重复挂
        observer.reconcile();
        assert.equal(mounts.length, 1);
    });

    it('collectUnmountedSlots 跳过已挂载', () => {
        const a = makeSlotNode(1, 0);
        a.setAttribute(SLOT_MOUNTED_ATTR, '1');
        const b = makeSlotNode(2, 0);
        const root = { querySelectorAll: () => [a, b] };
        const list = collectUnmountedSlots(root);
        assert.equal(list.length, 1);
        assert.equal(list[0], b);
    });
});

describe('generate-interceptor', () => {
    it('幂等剥离 slot 并跑 outbound transforms', async () => {
        const fn = createGenerateInterceptor({
            getTransforms: () => [
                (mes) => mes.replace(/SECRET/g, ''),
            ],
        });
        const chat = [
            { mes: 'hello <IMG>\n1\n</IMG> SECRET world' },
            { mes: 'no-slot' },
        ];
        await fn(chat, 0, () => {}, 'normal');
        assert.equal(chat[0].mes.includes('<IMG>'), false);
        assert.equal(chat[0].mes.includes('SECRET'), false);
        assert.equal(chat[1].mes, 'no-slot');
        assert.ok(stripSlotTokens('x <IMG>1</IMG> y').includes('x'));
    });

    it('register / unregister 全局名', () => {
        const fn = createGenerateInterceptor();
        registerGenerateInterceptorGlobal(fn);
        assert.equal(globalThis[GENERATE_INTERCEPTOR_GLOBAL_NAME], fn);
        unregisterGenerateInterceptorGlobal();
        assert.equal(globalThis[GENERATE_INTERCEPTOR_GLOBAL_NAME], undefined);
    });
});
