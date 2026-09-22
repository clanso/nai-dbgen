/**
 * W2-I · 工作台纯逻辑：解耦、replace 透传、NaiCaption 往返、参数默认、XSS。
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { defaultNaiParams, emptyNaiCaption } from '../../src/domain/model/nai-params.js';
import {
    cloneCaption,
    captionToEditorState,
    editorStateToCaption,
    roundTripCaption,
    resolveSessionParams,
    assembleWorkbenchNaiParams,
    WORKBENCH_EDITABLE_NAI_KEYS,
    WORKBENCH_FIXED_NAI_KEYS,
    uncoveredNaiParamKeys,
    buildWritePromptInput,
    buildGenerateImageInput,
    createDecoupledWorkbenchApi,
    formatUnmatchedKeys,
    isWorkbenchAbort,
    canSubmitGenerate,
    gatePreviewUrl,
    previewUrlFromImage,
    emptyCharacterRow,
} from '../../src/ui/workbench/workbench-logic.js';

/**
 * @param {string} base
 * @param {Array<{ pos: string, neg: string, x?: number, y?: number }>} [chars]
 */
function makeCaption(base, chars = []) {
    return {
        v4_prompt: {
            caption: {
                base_caption: base,
                char_captions: chars.map((c) => ({
                    char_caption: c.pos,
                    centers: [{ x: c.x ?? 0.2, y: c.y ?? 0.8 }],
                })),
            },
        },
        v4_negative_prompt: {
            caption: {
                base_caption: `neg:${base}`,
                char_captions: chars.map((c) => ({
                    char_caption: c.neg,
                    centers: [{ x: c.x ?? 0.2, y: c.y ?? 0.8 }],
                })),
            },
        },
    };
}

describe('ui/workbench logic · write / generate 解耦', () => {
    it('写提示词不调 NAI（假 imageGen 零调用）', async () => {
        let imageGenCalls = 0;
        let writeCalls = 0;
        const service = createDecoupledWorkbenchApi({
            async writePrompt(input) {
                writeCalls += 1;
                return {
                    ok: true,
                    value: {
                        caption: makeCaption(input.naturalLanguage || 'auto'),
                        unmatchedKeys: [],
                    },
                };
            },
            async generateImage() {
                imageGenCalls += 1;
                return { ok: true, value: [] };
            },
        });

        const input = buildWritePromptInput({
            naturalLanguage: '花园里的爱丽丝',
            libraryIds: ['lib-a'],
        });
        const r = await service.writePrompt(input);
        assert.equal(r.ok, true);
        assert.equal(writeCalls, 1);
        assert.equal(imageGenCalls, 0, 'writePrompt 路径不得触发 generateImage/NAI');
    });

    it('手填提示词直接出图不调 LLM（假 llm/writePrompt 零调用）', async () => {
        let writeCalls = 0;
        let genCalls = 0;
        const service = createDecoupledWorkbenchApi({
            async writePrompt() {
                writeCalls += 1;
                return { ok: true, value: { caption: emptyNaiCaption(), unmatchedKeys: [] } };
            },
            async generateImage(input) {
                genCalls += 1;
                assert.equal(input.caption.v4_prompt.caption.base_caption, '手填场景');
                return { ok: true, value: [{ blob: new Blob(['x']), mimeType: 'image/png' }] };
            },
        });

        const caption = makeCaption('手填场景');
        const input = buildGenerateImageInput({
            caption,
            replaceCharacterKeywords: false,
            params: resolveSessionParams(),
        });
        const r = await service.generateImage(input);
        assert.equal(r.ok, true);
        assert.equal(genCalls, 1);
        assert.equal(writeCalls, 0, '出图不得触发 writePrompt/LLM');
    });
});

describe('ui/workbench logic · replaceCharacterKeywords', () => {
    it('值只来源于开关：自动生成 / 手改 / 纯手填透传一致', () => {
        const toggleOn = true;
        const toggleOff = false;

        const auto = makeCaption('auto-scene', [{ pos: 'Alice', neg: 'bad' }]);
        const handEdited = cloneCaption(auto);
        handEdited.v4_prompt.caption.base_caption = 'auto-scene, edited';
        const pureHand = makeCaption('纯手填', [{ pos: 'Bob', neg: 'ugly', x: 0.1, y: 0.9 }]);

        for (const caption of [auto, handEdited, pureHand]) {
            const onReq = buildGenerateImageInput({
                caption,
                replaceCharacterKeywords: toggleOn,
            });
            const offReq = buildGenerateImageInput({
                caption,
                replaceCharacterKeywords: toggleOff,
            });
            assert.equal(onReq.replaceCharacterKeywords, true);
            assert.equal(offReq.replaceCharacterKeywords, false);
        }

        // 签名不含 promptSource——无法被推断
        assert.throws(
            () => buildGenerateImageInput({
                caption: makeCaption('x'),
                // @ts-expect-error 故意缺
                replaceCharacterKeywords: undefined,
            }),
            /replaceCharacterKeywords/,
        );
    });

    it('同一开关值下，三种提示词来源透传值完全相同', async () => {
        /** @type {boolean[]} */
        const seen = [];
        const service = createDecoupledWorkbenchApi({
            async writePrompt() {
                return { ok: true, value: { caption: emptyNaiCaption(), unmatchedKeys: [] } };
            },
            async generateImage(input) {
                seen.push(input.replaceCharacterKeywords);
                return { ok: true, value: [] };
            },
        });

        const sources = [
            makeCaption('from-llm'),
            (() => {
                const c = makeCaption('from-llm');
                c.v4_prompt.caption.base_caption = 'half-edited';
                return c;
            })(),
            makeCaption('typed-by-hand'),
        ];
        for (const caption of sources) {
            await service.generateImage(buildGenerateImageInput({
                caption,
                replaceCharacterKeywords: true,
            }));
        }
        assert.deepEqual(seen, [true, true, true]);
    });
});

describe('ui/workbench logic · NaiCaption 结构往返', () => {
    it('多角色 + centers 往返不丢信息', () => {
        const original = makeCaption('场景', [
            { pos: '角色甲正向', neg: '角色甲负向', x: 0.25, y: 0.75 },
            { pos: '角色乙正向', neg: '角色乙负向', x: 0.8, y: 0.2 },
        ]);
        const back = roundTripCaption(original);
        assert.equal(back.v4_prompt.caption.base_caption, '场景');
        assert.equal(back.v4_negative_prompt.caption.base_caption, 'neg:场景');
        assert.equal(back.v4_prompt.caption.char_captions.length, 2);
        assert.equal(back.v4_prompt.caption.char_captions[0].char_caption, '角色甲正向');
        assert.equal(back.v4_negative_prompt.caption.char_captions[1].char_caption, '角色乙负向');
        assert.equal(back.v4_prompt.caption.char_captions[0].centers[0].x, 0.25);
        assert.equal(back.v4_prompt.caption.char_captions[1].centers[0].y, 0.2);

        // editor state 路径同样保留
        const state = captionToEditorState(original);
        assert.equal(state.characters.length, 2);
        const rebuilt = editorStateToCaption(state);
        assert.deepEqual(
            rebuilt.v4_prompt.caption.char_captions.map((c) => c.char_caption),
            ['角色甲正向', '角色乙正向'],
        );
    });

    it('空 caption 有合法骨架', () => {
        const empty = cloneCaption(null);
        assert.equal(empty.v4_prompt.caption.base_caption, '');
        assert.deepEqual(empty.v4_prompt.caption.char_captions, []);
        assert.ok(emptyCharacterRow());
    });
});

describe('ui/workbench logic · unmatchedKeys / 参数默认 / 取消 / XSS', () => {
    it('unmatchedKeys 会被格式化为可见文案', () => {
        assert.equal(formatUnmatchedKeys([]), '');
        assert.equal(formatUnmatchedKeys(null), '');
        assert.match(formatUnmatchedKeys(['garden', 'fabricated']), /未命中标签 key/);
        assert.match(formatUnmatchedKeys(['garden', 'fabricated']), /garden/);
        assert.match(formatUnmatchedKeys(['garden', 'fabricated']), /fabricated/);
    });

    it('参数默认值来自 domain 而非写死', () => {
        const domain = defaultNaiParams();
        const resolved = resolveSessionParams({});
        assert.equal(resolved.model, domain.model);
        assert.equal(resolved.width, domain.width);
        assert.equal(resolved.height, domain.height);
        assert.equal(resolved.steps, domain.steps);
        assert.equal(resolved.sampler, domain.sampler);
        assert.equal(resolved.n_samples, domain.n_samples);
        assert.equal(resolved.skip_cfg_above_sigma, domain.skip_cfg_above_sigma);
        assert.equal(resolved.tag_hint_transparent_background, domain.tag_hint_transparent_background);
        assert.equal(resolved.qualityStrategy, domain.qualityStrategy);

        const overridden = resolveSessionParams({
            naiParams: { width: 1024, steps: 20 },
        });
        assert.equal(overridden.width, 1024);
        assert.equal(overridden.steps, 20);
        assert.equal(overridden.model, domain.model, '未覆盖字段仍走 domain 默认');
    });

    it('进行中禁按钮；Abort 识别为非失败', () => {
        assert.equal(canSubmitGenerate(false), true);
        assert.equal(canSubmitGenerate(true), false);
        assert.equal(isWorkbenchAbort({ code: 'UPSTREAM_ABORTED', message: '取消' }), true);
        assert.equal(isWorkbenchAbort({ ok: false, error: { code: 'NAI_ABORTED' } }), true);
        assert.equal(isWorkbenchAbort({ code: 'UPSTREAM_401', message: '鉴权失败' }), false);
    });

    it('恶意图片 URL 被拦；预览不依赖 SVG data', () => {
        assert.equal(gatePreviewUrl('javascript:alert(1)'), null);
        assert.equal(gatePreviewUrl('data:text/html,x'), null);
        assert.equal(gatePreviewUrl('data:image/svg+xml,<svg></svg>'), null);
        assert.equal(gatePreviewUrl('https://cdn.example/a.png'), 'https://cdn.example/a.png');
        assert.ok(gatePreviewUrl('data:image/png;base64,abc'));

        const fakeUrlApi = {
            createObjectURL() { return 'javascript:evil'; },
            revokeObjectURL() {},
        };
        const bad = previewUrlFromImage(
            { blob: /** @type {any} */ ({}), mimeType: 'image/png' },
            fakeUrlApi,
        );
        assert.equal(bad.url, null);
    });
});

describe('ui/workbench logic · D47 4.13 全字段覆盖', () => {
    it('defaultNaiParams 每个键要么可改要么在 FIXED 白名单（缺一失败）', () => {
        const missing = uncoveredNaiParamKeys();
        assert.deepEqual(
            missing,
            [],
            `领域层有未覆盖键，请补控件或写入 WORKBENCH_FIXED_NAI_KEYS：${missing.join(', ')}`,
        );

        // 可改列表不得含 FIXED；FIXED 必须是 domain 真有的键
        const domain = new Set(Object.keys(defaultNaiParams()));
        for (const key of WORKBENCH_EDITABLE_NAI_KEYS) {
            assert.ok(domain.has(key), `可改键不在 domain：${key}`);
            assert.equal(
                Object.prototype.hasOwnProperty.call(WORKBENCH_FIXED_NAI_KEYS, key),
                false,
                `键同时出现在可改与 FIXED：${key}`,
            );
        }
        for (const key of Object.keys(WORKBENCH_FIXED_NAI_KEYS)) {
            assert.ok(domain.has(key), `FIXED 白名单键不在 domain：${key}`);
            assert.ok(
                String(WORKBENCH_FIXED_NAI_KEYS[key]).trim().length > 0,
                `FIXED 键缺少理由注释：${key}`,
            );
        }
    });

    it('assembleWorkbenchNaiParams 读到 Variety / 透明底 / qualityStrategy 等新增字段', () => {
        const base = defaultNaiParams();
        const off = assembleWorkbenchNaiParams(base, {
            varietyEnabled: false,
            skip_cfg_above_sigma: 19,
            tag_hint_transparent_background: false,
            qualityStrategy: 'field',
            sm: false,
            tag_hint_qt: true,
        });
        assert.equal(off.skip_cfg_above_sigma, null, '未启用 Variety → null');
        assert.equal(off.tag_hint_transparent_background, false);
        assert.equal(off.qualityStrategy, 'field');
        assert.equal(off.n_samples, base.n_samples);
        assert.equal(off.schemaVersion, base.schemaVersion);

        const on = assembleWorkbenchNaiParams(base, {
            model: 'nai-diffusion-5-full',
            width: 1024,
            height: 1536,
            steps: 30,
            scale: 6.5,
            sampler: 'k_euler',
            noise_schedule: 'native',
            seed: 42,
            seedRandom: false,
            image_format: 'webp',
            qualityToggle: false,
            tag_hint_qt: false,
            ucPreset: 2,
            tag_hint_uc_preset: false,
            cfg_rescale: 0.3,
            varietyEnabled: true,
            skip_cfg_above_sigma: 19,
            sm: true,
            sm_dyn: true,
            straight_alpha: true,
            tag_hint_transparent_background: true,
            qualityStrategy: 'caption',
        });
        assert.equal(on.model, 'nai-diffusion-5-full');
        assert.equal(on.width, 1024);
        assert.equal(on.height, 1536);
        assert.equal(on.steps, 30);
        assert.equal(on.scale, 6.5);
        assert.equal(on.sampler, 'k_euler');
        assert.equal(on.noise_schedule, 'native');
        assert.equal(on.seed, 42);
        assert.equal(on.seedRandom, false);
        assert.equal(on.image_format, 'webp');
        assert.equal(on.qualityToggle, false);
        assert.equal(on.tag_hint_qt, false);
        assert.equal(on.ucPreset, 2);
        assert.equal(on.tag_hint_uc_preset, false);
        assert.equal(on.cfg_rescale, 0.3);
        assert.equal(on.skip_cfg_above_sigma, 19);
        assert.equal(on.sm, true);
        assert.equal(on.sm_dyn, true);
        assert.equal(on.straight_alpha, true);
        assert.equal(on.tag_hint_transparent_background, true);
        assert.equal(on.qualityStrategy, 'caption');

        // 每个可改键都真的出现在组装结果里（与 domain 同名）
        for (const key of WORKBENCH_EDITABLE_NAI_KEYS) {
            assert.ok(
                Object.prototype.hasOwnProperty.call(on, key),
                `assemble 结果缺少可改键 ${key}`,
            );
        }
    });
});
