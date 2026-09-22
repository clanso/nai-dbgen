import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    resolveMessageIdFromElement,
    resolveSlotIdFromElement,
    ensureSlotUnprefixedClasses,
    createSlotMountObserver,
    SLOT_ROOT_CLASS,
    SLOT_BTN_CLASS,
    isHostStreamingActive,
} from '../../src/adapters/host/slot-mount.observer.js';
import { stripSlotTokens } from '../../src/domain/slot/slot-token.js';
import {
    createGenerateInterceptor,
    registerGenerateInterceptorGlobal,
    unregisterGenerateInterceptorGlobal,
    GENERATE_INTERCEPTOR_GLOBAL_NAME,
} from '../../src/adapters/host/generate-interceptor.js';

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

    it('isHostStreamingActive 无 SillyTavern 时为 false', () => {
        const prev = globalThis.SillyTavern;
        delete globalThis.SillyTavern;
        assert.equal(isHostStreamingActive(), false);
        globalThis.SillyTavern = prev;
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
        assert.equal(chat[0].mes, stripSlotTokens('hello <IMG>\n1\n</IMG>  world').replace(/SECRET/g, ''));
        // transform already removed SECRET; stripSlotTokens first then transform
        assert.equal(chat[0].mes.includes('<IMG>'), false);
        assert.equal(chat[0].mes.includes('SECRET'), false);
        assert.equal(chat[1].mes, 'no-slot');
    });

    it('register / unregister 全局名', () => {
        const fn = createGenerateInterceptor();
        registerGenerateInterceptorGlobal(fn);
        assert.equal(globalThis[GENERATE_INTERCEPTOR_GLOBAL_NAME], fn);
        unregisterGenerateInterceptorGlobal();
        assert.equal(globalThis[GENERATE_INTERCEPTOR_GLOBAL_NAME], undefined);
    });
});
