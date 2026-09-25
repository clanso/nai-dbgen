import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { openImportExportModal, confirmAsk } from '../../src/ui/panels/_lib/panel-kit.js';

/**
 * 冷启动装配：host.openModal 同步挂 dialog（对齐 fake-host 的「先上屏」），
 * 不 await 关闭——否则 openModal 包装层会永远等不到返回。
 * @returns {{ host: { openModal: Function, toast: Function }, dialogs: any[] }}
 */
function createStackingHost() {
    /** @type {any[]} */
    const dialogs = [];
    const host = {
        toast() {},
        /**
         * @param {{ element?: Element, title?: string }} opts
         */
        async openModal(opts) {
            const dlg = document.createElement('dialog');
            dlg.setAttribute('open', '');
            dlg.className = 'popup nd-root nd-popup';
            if (opts?.element) {
                dlg.appendChild(opts.element);
            }
            document.body.appendChild(dlg);
            dialogs.push(dlg);
            // 故意不 resolve「关闭」——与 preview/fake-host 一样；modal.js 不得 await 本 Promise
        },
    };
    return { host, dialogs };
}

/**
 * @param {any} root
 * @param {string} label
 * @returns {any|null}
 */
function findButton(root, label) {
    /** @type {any|null} */
    let hit = null;
    /**
     * @param {any} node
     */
    function walk(node) {
        if (!node || hit) return;
        if (node.tagName === 'BUTTON' && String(node.textContent || '').includes(label)) {
            hit = node;
            return;
        }
        for (const c of node.childNodes || []) walk(c);
    }
    walk(root);
    return hit;
}

/**
 * @param {any} btn
 */
async function click(btn) {
    for (const l of btn._listeners.filter((x) => x.type === 'click')) {
        l.fn({ preventDefault() {}, stopPropagation() {} });
    }
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
}

describe('ui/panels autoImport + nested confirmAsk', () => {
    /** @type {ReturnType<typeof installFakeDom>|null} */
    let fake = null;
    /** @type {typeof MutationObserver|undefined} */
    let prevMO;

    beforeEach(() => {
        fake = installFakeDom();
        prevMO = globalThis.MutationObserver;
        /** @type {Set<Function>} */
        const cbs = new Set();
        globalThis.MutationObserver = class {
            /**
             * @param {Function} cb
             */
            constructor(cb) {
                this._cb = cb;
                cbs.add(cb);
            }

            observe() {}

            disconnect() {
                cbs.delete(this._cb);
            }
        };
        globalThis.MutationObserver.flush = () => {
            for (const cb of cbs) cb([]);
        };
    });

    afterEach(() => {
        if (prevMO) globalThis.MutationObserver = prevMO;
        else delete globalThis.MutationObserver;
        fake?.restore();
        fake = null;
    });

    it('autoImport(skip) 跑完不超时，且不弹 confirmAsk', async () => {
        const { host } = createStackingHost();
        let importCalls = 0;
        // 若 autoImport 误走覆盖确认并 await 永不 resolve，会挂起；用超时兜住
        const rows = [
            {
                name: 'Auto A',
                sequence: 1,
                positivePrompt: 'p',
                negativePrompt: 'n',
                referenceImage: null,
            },
            {
                name: 'Auto B',
                sequence: 2,
                positivePrompt: 'p2',
                negativePrompt: 'n2',
                referenceImage: null,
            },
        ];

        const work = openImportExportModal(
            {
                host,
                // 探测：若有人把 confirmAsk 挂到 auto 路径，计数会涨
            },
            '自动导入',
            'artist',
            async (data, strategy) => {
                importCalls += 1;
                assert.equal(strategy, 'skip');
                assert.ok(Array.isArray(data));
                assert.equal(data.length, 2);
                return { imported: 2, skipped: 0, errors: [] };
            },
            async () => [],
            undefined,
            { autoImport: { data: rows, strategy: 'skip' } },
        );

        const handle = await Promise.race([
            work,
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('autoImport timed out (likely awaiting confirmAsk)')), 2000);
            }),
        ]);

        assert.equal(importCalls, 1);
        assert.equal(typeof handle.destroy, 'function');
        handle.destroy();
    });

    it('autoImport 在 rAF 永不回调时仍执行导入', async () => {
        const { host } = createStackingHost();
        let importCalls = 0;
        const prevRaf = globalThis.requestAnimationFrame;
        globalThis.requestAnimationFrame = () => 0;
        const rows = [
            {
                name: 'Bg A',
                sequence: 1,
                positivePrompt: 'p',
                negativePrompt: 'n',
                referenceImage: null,
            },
        ];
        try {
            const work = openImportExportModal(
                { host },
                '后台自动导入',
                'artist',
                async () => {
                    importCalls += 1;
                    return { imported: 1, skipped: 0, errors: [] };
                },
                async () => [],
                undefined,
                { autoImport: { data: rows, strategy: 'skip' } },
            );
            const handle = await Promise.race([
                work,
                new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('autoImport timed out waiting for rAF')), 2000);
                }),
            ]);
            assert.equal(importCalls, 1);
            handle.destroy();
        } finally {
            if (prevRaf) globalThis.requestAnimationFrame = prevRaf;
            else delete globalThis.requestAnimationFrame;
        }
    });

    it('导入弹层之上的 confirmAsk 能 resolve（覆盖 / 取消）', async () => {
        const { host, dialogs } = createStackingHost();

        const ie = await openImportExportModal(
            { host },
            '手动导入',
            'artist',
            async () => ({ imported: 0, skipped: 0, errors: [] }),
            async () => [],
        );
        assert.ok(dialogs.length >= 1, 'import dialog mounted');

        const askOk = confirmAsk({ host }, {
            title: '覆盖导入',
            message: '将覆盖 1 条已有记录。',
            okLabel: '覆盖',
            cancelLabel: '取消',
            okVariant: 'danger',
        });

        await new Promise((r) => setTimeout(r, 0));
        assert.ok(dialogs.length >= 2, 'confirm dialog stacked on import');

        const confirmDlg = dialogs[dialogs.length - 1];
        const okBtn = findButton(confirmDlg, '覆盖');
        assert.ok(okBtn, '覆盖 button');
        await click(okBtn);

        const ok = await Promise.race([
            askOk,
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('confirmAsk(ok) timed out')), 2000);
            }),
        ]);
        assert.equal(ok, true);

        const askCancel = confirmAsk({ host }, {
            title: '覆盖导入',
            message: '将覆盖 2 条已有记录。',
            okLabel: '覆盖',
            cancelLabel: '取消',
            okVariant: 'danger',
        });
        await new Promise((r) => setTimeout(r, 0));
        const cancelDlg = dialogs[dialogs.length - 1];
        const cancelBtn = findButton(cancelDlg, '取消');
        assert.ok(cancelBtn, '取消 button');
        await click(cancelBtn);
        const cancelled = await Promise.race([
            askCancel,
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('confirmAsk(cancel) timed out')), 2000);
            }),
        ]);
        assert.equal(cancelled, false);

        // 导入弹层仍可销毁（未因嵌套确认损坏）
        ie.destroy();
    });
});
