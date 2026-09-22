import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    filterSortItems,
    filterNestedLibrary,
    parseImportJsonText,
    prepareImportCommit,
    roundTripJson,
    gateCoverUrl,
    buildArtistPreviewRequest,
    pickAllowedSettingsPatch,
    PLUGIN_SETTINGS_KEYS,
    settingsKeysUnchanged,
    applyFormFields,
    mergePresetPrompt,
    resolveDeleteIdsByIdentity,
    assertImportKind,
    formatErrorDisplay,
    canSubmitPaidAction,
    paidActionLabels,
} from '../../src/ui/panels/_lib/library-logic.js';
import { watchModalDismiss, runExclusivePaidAction } from '../../src/ui/panels/_lib/panel-kit.js';
import { ARTIST_PREVIEW_SIZE } from '../../src/domain/model/nai-params.js';
import { defaultNaiParams } from '../../src/domain/model/nai-params.js';
import { defaultPluginSettings } from '../../src/domain/model/plugin-settings.js';
import { installFakeDom } from './fake-dom.js';

describe('ui/panels library-logic', () => {
    it('filters and sorts by name / query', () => {
        const items = [
            { id: '2', name: 'Zeta', model: 'm' },
            { id: '1', name: 'Alpha', model: 'x' },
            { id: '3', name: 'Beta', model: 'alpha-hidden' },
        ];
        const asc = filterSortItems(items, { sort: 'name-asc' });
        assert.deepEqual(asc.map((i) => i.name), ['Alpha', 'Beta', 'Zeta']);

        const hit = filterSortItems(items, { query: 'alp', searchKeys: ['name', 'model'] });
        assert.equal(hit.length, 2);
        assert.ok(hit.some((i) => i.name === 'Alpha'));
        assert.ok(hit.some((i) => i.name === 'Beta'));
    });

    it('filters nested character/tag libraries together', () => {
        const parents = [
            { id: 'g1', name: '组甲', active: true, order: 1 },
            { id: 'g2', name: '组乙', active: false, order: 0 },
        ];
        const children = new Map([
            ['g1', [{ id: 'c1', name: '张三', keywords: ['zhang'] }]],
            ['g2', [{ id: 'c2', name: '李四', keywords: ['li'] }]],
        ]);
        const onlyActive = filterNestedLibrary(parents, children, { activeOnly: true });
        assert.equal(onlyActive.parents.length, 1);
        assert.equal(onlyActive.parents[0].id, 'g1');

        const q = filterNestedLibrary(parents, children, { query: '李' });
        assert.equal(q.parents.length, 1);
        assert.equal(q.parents[0].id, 'g2');
        assert.equal(q.childrenByParentId.get('g2').length, 1);
    });

    it('export → import round-trip keeps payload', () => {
        const envelope = {
            kind: 'artist',
            schemaVersion: 1,
            items: [
                { id: 'a1', name: '串A', positive: 'artist1', negative: 'bad' },
            ],
        };
        const back = roundTripJson(envelope);
        assert.deepEqual(back, envelope);
        const prepared = prepareImportCommit(back, 'artist');
        assert.equal(prepared.ok, true);
        assert.equal(prepared.value.rows.length, 1);
        assert.equal(prepared.value.rows[0].name, '串A');
    });

    it('illegal JSON import fails without producing commit payload', () => {
        const bad = parseImportJsonText('{not-json');
        assert.equal(bad.ok, false);
        assert.match(bad.error, /无法解析 JSON/);

        const prepared = prepareImportCommit('{not-json', 'artist');
        assert.equal(prepared.ok, false);

        let importCalled = false;
        if (prepared.ok) {
            importCalled = true;
        }
        assert.equal(importCalled, false);
    });

    it('wrong kind is rejected before write', () => {
        const prepared = prepareImportCommit(
            { kind: 'tag', libraries: [{ id: '1', name: 'L' }] },
            'artist',
        );
        assert.equal(prepared.ok, false);
        assert.match(prepared.error, /类型不匹配/);
    });

    it('D49: rejects bare arrays and envelopes without kind', () => {
        assert.equal(assertImportKind([{ id: '1' }], 'artist').ok, false);
        assert.equal(prepareImportCommit([{ id: '1', name: 'x' }], 'artist').ok, false);
        assert.equal(assertImportKind({ items: [{ id: '1' }] }, 'artist').ok, false);
        assert.match(assertImportKind({ items: [] }, 'artist').error, /缺少 kind/);
    });

    it('blocks malicious cover URLs', () => {
        assert.equal(gateCoverUrl('javascript:alert(1)'), null);
        assert.equal(gateCoverUrl('data:text/html,hi'), null);
        assert.equal(gateCoverUrl('https://cdn.example/cover.png'), 'https://cdn.example/cover.png');
        assert.ok(gateCoverUrl('data:image/png;base64,abc'));
        // D51：svg 已从白名单移除；面板不得依赖 SVG 封面
        assert.equal(gateCoverUrl('data:image/svg+xml,<svg></svg>'), null);
    });

    it('artist preview uses editing row, never reads or writes activeArtistId', () => {
        const editing = { id: 'edit-9', name: '正在编辑', positive: 'a', negative: 'b' };
        const settings = { activeArtistId: 'global-active-1' };
        const req = buildArtistPreviewRequest(editing, {
            promptText: 'girl',
            activeArtistId: settings.activeArtistId,
        });
        assert.equal(req.artistId, 'edit-9');
        assert.notEqual(req.artistId, settings.activeArtistId);
        assert.equal(settings.activeArtistId, 'global-active-1');
        assert.equal(Object.prototype.hasOwnProperty.call(req, 'activeArtistId'), false);
        assert.deepEqual(req.previewSize, {
            width: ARTIST_PREVIEW_SIZE.width,
            height: ARTIST_PREVIEW_SIZE.height,
        });
    });

    it('settings patch only allows D8 keys; unknown keys dropped', () => {
        const keys = new Set(PLUGIN_SETTINGS_KEYS);
        assert.ok(keys.has('activeArtistId'));
        assert.ok(keys.has('recallLlmConfigId'));
        assert.ok(keys.has('naiParams'));
        assert.equal(keys.has('myCustomKey'), false);

        const patch = pickAllowedSettingsPatch({
            activeArtistId: 'a1',
            myCustomKey: 'nope',
            contextWindowSize: 7,
            matchDefaults: { caseSensitive: true, matchWholeWords: false, extra: 1 },
        });
        assert.equal(patch.activeArtistId, 'a1');
        assert.equal(patch.contextWindowSize, 7);
        assert.equal(patch.myCustomKey, undefined);
        assert.deepEqual(patch.matchDefaults, {
            caseSensitive: true,
            matchWholeWords: false,
        });

        const before = defaultPluginSettings();
        const after = { ...before, activeArtistId: before.activeArtistId };
        assert.equal(
            settingsKeysUnchanged(before, after, ['activeArtistId', 'activeNaiConfigId']),
            true,
        );
    });

    it('D45: applyFormFields preserves unshown fields (all five libraries)', () => {
        // 角色
        const char = {
            id: 'c1',
            groupId: 'g1',
            name: '旧名',
            keywords: ['a'],
            fixedFeatures: 'dna',
            variableFeatures: [{ name: '服', prompt: 'p', legacyNote: 'keep-me' }],
            matchOverrides: null,
            schemaVersion: 1,
            createdAt: 't0',
            updatedAt: 't0',
            mystery: 'survive',
        };
        const charSaved = applyFormFields(char, {
            name: '新名',
            keywords: ['b'],
            fixedFeatures: 'dna2',
            updatedAt: 't1',
        });
        assert.equal(charSaved.mystery, 'survive');
        assert.equal(charSaved.createdAt, 't0');
        assert.equal(charSaved.name, '新名');

        // 标签
        const tag = {
            id: 't1', libraryId: 'l1', key: 'k', value: 'v',
            schemaVersion: 1, createdAt: 't0', extraFlag: true,
        };
        const tagSaved = applyFormFields(tag, { key: 'k2', value: 'v2', updatedAt: 't1' });
        assert.equal(tagSaved.extraFlag, true);
        assert.equal(tagSaved.libraryId, 'l1');

        // 画师
        const artist = {
            id: 'a1', name: 'A', positive: 'p', negative: 'n',
            previewImageRef: 'img-9', schemaVersion: 1, createdAt: 't0',
        };
        const artistSaved = applyFormFields(artist, {
            name: 'B', positive: 'p2', updatedAt: 't1',
        });
        assert.equal(artistSaved.previewImageRef, 'img-9');
        assert.equal(artistSaved.negative, 'n');

        // API
        const llm = {
            id: 'l1', name: 'L', baseUrl: 'u', apiKey: 'k', model: 'm',
            transport: 'st-backend', schemaVersion: 1, createdAt: 't0', vendorHint: 'x',
        };
        const llmSaved = applyFormFields(llm, { name: 'L2', model: 'm2', updatedAt: 't1' });
        assert.equal(llmSaved.vendorHint, 'x');
        assert.equal(llmSaved.transport, 'st-backend');

        // 预设 injection_* 往返
        const prompt = {
            identifier: 'main',
            name: '主',
            role: 'system',
            content: 'hello',
            enabled: true,
            injection_position: 1,
            injection_depth: 4,
            injection_order: 77,
        };
        const merged = mergePresetPrompt(prompt, {
            identifier: 'main',
            name: '主改',
            role: 'user',
            content: 'world',
            enabled: false,
        });
        assert.equal(merged.injection_position, 1);
        assert.equal(merged.injection_depth, 4);
        assert.equal(merged.injection_order, 77);
        assert.equal(merged.name, '主改');
        assert.equal(merged.role, 'user');
        assert.equal(merged.content, 'world');
        assert.equal(merged.enabled, false);
    });

    it('delete after filter/sort uses entity id not visible index', () => {
        const all = [
            { id: 'keep', name: 'A' },
            { id: 'target', name: 'Zeta' },
            { id: 'other', name: 'M' },
        ];
        const visible = filterSortItems(all, { query: 'zet', sort: 'name-asc' });
        assert.equal(visible.length, 1);
        // 可见列表下标 0 ≠ 全库下标 0
        assert.notEqual(visible[0].id, all[0].id);
        const ids = resolveDeleteIdsByIdentity(all, [String(visible[0].id)]);
        assert.deepEqual(ids, ['target']);
        // 错误下标若被当成 id 则不应命中
        assert.deepEqual(resolveDeleteIdsByIdentity(all, ['0']), []);
    });

    it('D47: 4.13 defaults come from domain defaultNaiParams', () => {
        const d = defaultNaiParams();
        assert.equal(typeof d.tag_hint_qt, 'boolean');
        assert.equal(typeof d.tag_hint_uc_preset, 'boolean');
        assert.equal(typeof d.cfg_rescale, 'number');
        assert.equal(d.skip_cfg_above_sigma, null);
        assert.equal(d.sm, false);
        assert.equal(d.sm_dyn, false);
        assert.equal(d.straight_alpha, false);
        assert.equal(d.tag_hint_transparent_background, false);
        const merged = applyFormFields(d, { steps: 30 });
        assert.equal(merged.tag_hint_qt, d.tag_hint_qt);
        assert.equal(merged.steps, 30);
    });

    it('D58: formatErrorDisplay appends hint when present', () => {
        assert.equal(
            formatErrorDisplay({ message: '未配置生图预设', hint: '请到抽屉选择生图预设' }),
            '未配置生图预设（请到抽屉选择生图预设）',
        );
        assert.equal(formatErrorDisplay({ message: '只有消息' }), '只有消息');
        assert.equal(formatErrorDisplay(null, '兜底'), '兜底');
    });

    it('D58: preset picker keys match D8 freeze table', () => {
        const keys = new Set(PLUGIN_SETTINGS_KEYS);
        assert.ok(keys.has('activeImagegenPresetId'));
        assert.ok(keys.has('activeRecallPresetId'));
        const patch = pickAllowedSettingsPatch({
            activeImagegenPresetId: 'ig-1',
            activeRecallPresetId: 'rc-1',
            fakePresetId: 'nope',
        });
        assert.equal(patch.activeImagegenPresetId, 'ig-1');
        assert.equal(patch.activeRecallPresetId, 'rc-1');
        assert.equal(patch.fakePresetId, undefined);
    });

    it('D55: canSubmitPaidAction blocks while busy', () => {
        assert.equal(canSubmitPaidAction(false), true);
        assert.equal(canSubmitPaidAction(true), false);
        const labels = paidActionLabels('artistPreview');
        assert.match(labels.busy, /中/);
        assert.notEqual(labels.idle, labels.busy);
    });
});

describe('ui/panels confirmDanger dismiss (D50)', () => {
    /** @type {ReturnType<typeof installFakeDom>|null} */
    let fake = null;
    /** @type {typeof MutationObserver|undefined} */
    let prevMO;

    beforeEach(() => {
        fake = installFakeDom();
        prevMO = globalThis.MutationObserver;
        /** @type {Function[]} */
        const cbs = [];
        globalThis.MutationObserver = class {
            /**
             * @param {Function} cb
             */
            constructor(cb) {
                this._cb = cb;
                cbs.push(cb);
            }

            observe() {}

            disconnect() {}

            /**
             * 测试辅助：模拟 DOM 变更通知
             */
            static flush() {
                for (const cb of cbs) cb([]);
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

    it('fires settle(false) immediately when element disconnects', () => {
        const parent = document.createElement('div');
        const body = document.createElement('div');
        parent.appendChild(body);
        document.body.appendChild(parent);

        let settled = null;
        const unwatch = watchModalDismiss(body, () => {
            settled = false;
        });

        assert.equal(settled, null);
        parent.removeChild(body);
        // isConnected on FakeElement stays true by default — force false
        body.isConnected = false;
        globalThis.MutationObserver.flush();
        assert.equal(settled, false);
        unwatch();
    });
});

describe('ui/panels runExclusivePaidAction (D55)', () => {
    /** @type {ReturnType<typeof installFakeDom>|null} */
    let fake = null;

    beforeEach(() => {
        fake = installFakeDom();
    });

    afterEach(() => {
        fake?.restore();
        fake = null;
    });

    it('preview busy: second submit does not start; NAI called once; restores after fail', async () => {
        const btn = document.createElement('button');
        btn.textContent = '手填预览生图';
        document.body.appendChild(btn);

        let naiCalls = 0;
        /** @type {() => void} */
        let release;
        const gate = new Promise((resolve) => {
            release = resolve;
        });

        const first = runExclusivePaidAction({
            button: btn,
            idleLabel: '手填预览生图',
            busyLabel: '预览生成中…',
            run: async () => {
                naiCalls += 1;
                await gate;
                throw new Error('boom');
            },
        });

        // 进行中再点
        const second = await runExclusivePaidAction({
            button: btn,
            idleLabel: '手填预览生图',
            busyLabel: '预览生成中…',
            run: async () => {
                naiCalls += 1;
            },
        });
        assert.equal(second.started, false);
        assert.equal(btn.disabled, true);
        assert.equal(btn.textContent, '预览生成中…');
        assert.equal(btn.dataset.ndBusy, '1');

        release();
        let firstErr = null;
        try {
            await first;
        } catch (e) {
            firstErr = e;
        }
        assert.ok(firstErr);
        assert.equal(naiCalls, 1);
        // 失败后恢复可点
        assert.equal(btn.disabled, false);
        assert.equal(btn.textContent, '手填预览生图');
        assert.equal(btn.dataset.ndBusy, '0');

        // 恢复后可以再点
        const third = await runExclusivePaidAction({
            button: btn,
            idleLabel: '手填预览生图',
            busyLabel: '预览生成中…',
            run: async () => {
                naiCalls += 1;
                return 'ok';
            },
        });
        assert.equal(third.started, true);
        assert.equal(naiCalls, 2);
        assert.equal(btn.disabled, false);
    });
});
