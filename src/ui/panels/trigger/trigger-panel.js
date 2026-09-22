/**
 * L5 UI · 运行配置（上下文楼数、自动开关、4.13 参数） 管理面板。
 * 归属：W2-H 面板代理实现。W0 仅冻结签名。
 * 键名严格按 D8；4.13 控件默认值一律取自 defaultNaiParams（D47）。
 */

import {
    createNumberField,
    createToggle,
    createCheckbox,
    createField,
    createSelect,
    createFieldGroup,
    createDetails,
    createButton,
    createInlineError,
} from '../../common/controls.js';
import { defaultNaiParams } from '../../../domain/model/nai-params.js';
import { PLUGIN_SETTINGS_KEYS, pickAllowedSettingsPatch, applyFormFields } from '../_lib/library-logic.js';
import { el, setText, settingsApi, toast } from '../_lib/panel-kit.js';

/**
 * @param {Element} root
 * @param {object} deps repos / services / host / bus
 * @returns {{ destroy: () => void }}
 */
export function mountTriggerPanel(root, deps) {
    if (!(root instanceof Element)) {
        throw new Error('mountTriggerPanel: root must be an Element');
    }

    const settings = settingsApi(deps);
    const host = deps?.host;
    const current = settings.load();
    const defaults = defaultNaiParams();
    const nai = applyFormFields(defaults, current.naiParams || {});

    const shell = el('div', 'nd-panel nd-panel--trigger');
    const err = createInlineError();

    const contextN = createNumberField({
        label: '上下文楼数（最近 N 条 AI 回复）',
        value: current.contextWindowSize ?? 5,
        min: 1,
        max: 100,
        step: 1,
    });
    const autoWrite = createToggle({
        label: '自动写 slot（新 AI 楼落定后跑步骤 4–5）',
        checked: current.autoWriteSlots === true,
    });
    const autoRender = createToggle({
        label: '自动出图（已生图编号不重出）',
        checked: current.autoRenderSlots === true,
    });
    const caseSensitive = createCheckbox({
        label: '关键字默认区分大小写',
        checked: current.matchDefaults?.caseSensitive === true,
    });
    const wholeWords = createCheckbox({
        label: '关键字默认全词匹配',
        checked: current.matchDefaults?.matchWholeWords === true,
    });

    const model = createField({ label: '模型', value: String(nai.model ?? defaults.model) });
    const width = createNumberField({
        label: '宽',
        value: Number(nai.width ?? defaults.width),
        min: 64,
        max: 2048,
        step: 64,
    });
    const height = createNumberField({
        label: '高',
        value: Number(nai.height ?? defaults.height),
        min: 64,
        max: 2048,
        step: 64,
    });
    const steps = createNumberField({
        label: 'steps',
        value: Number(nai.steps ?? defaults.steps),
        min: 1,
        max: 50,
        step: 1,
    });
    const scale = createNumberField({
        label: 'scale',
        value: Number(nai.scale ?? defaults.scale),
        min: 0,
        max: 10,
        step: 0.1,
    });
    const sampler = createField({
        label: 'sampler',
        value: String(nai.sampler ?? defaults.sampler),
    });
    const noise = createField({
        label: 'noise_schedule',
        value: String(nai.noise_schedule ?? defaults.noise_schedule),
    });
    const seed = createNumberField({
        label: 'seed',
        value: Number(nai.seed ?? defaults.seed),
        min: 0,
        max: 4294967295,
        step: 1,
    });
    const seedRandom = createCheckbox({
        label: '随机 seed',
        checked: nai.seedRandom !== false,
    });
    const imageFormat = createSelect({
        label: '图片格式',
        value: nai.image_format === 'webp' ? 'webp' : 'png',
        options: [
            { value: 'png', label: 'png' },
            { value: 'webp', label: 'webp' },
        ],
    });
    const qualityToggle = createCheckbox({
        label: 'qualityToggle',
        checked: nai.qualityToggle !== false,
    });
    const tagHintQt = createCheckbox({
        label: 'tag_hint_qt',
        checked: nai.tag_hint_qt !== false,
    });
    const ucPreset = createNumberField({
        label: 'ucPreset',
        value: Number(nai.ucPreset ?? defaults.ucPreset),
        min: 0,
        max: 10,
        step: 1,
    });
    const tagHintUc = createCheckbox({
        label: 'tag_hint_uc_preset',
        checked: nai.tag_hint_uc_preset !== false,
    });
    const cfgRescale = createNumberField({
        label: 'cfg_rescale',
        value: Number(nai.cfg_rescale ?? defaults.cfg_rescale),
        min: 0,
        max: 1,
        step: 0.01,
    });
    const varietyEnabled = createCheckbox({
        label: '启用 Variety（skip_cfg_above_sigma）',
        checked: nai.skip_cfg_above_sigma != null,
    });
    const varietySigma = createNumberField({
        label: 'skip_cfg_above_sigma',
        value: nai.skip_cfg_above_sigma == null
            ? 0
            : Number(nai.skip_cfg_above_sigma),
        min: 0,
        max: 100,
        step: 0.1,
    });
    const sm = createCheckbox({ label: 'sm（SMEA）', checked: nai.sm === true });
    const smDyn = createCheckbox({ label: 'sm_dyn', checked: nai.sm_dyn === true });
    const straightAlpha = createCheckbox({
        label: 'straight_alpha',
        checked: nai.straight_alpha === true,
    });
    const tagHintTransparent = createCheckbox({
        label: 'tag_hint_transparent_background',
        checked: nai.tag_hint_transparent_background === true,
    });
    const qualityStrategy = createSelect({
        label: 'qualityStrategy',
        value: nai.qualityStrategy === 'caption' ? 'caption' : 'field',
        options: [
            { value: 'field', label: 'field' },
            { value: 'caption', label: 'caption' },
        ],
    });

    const keysHint = el('p', 'nd-muted');
    setText(keysHint, `可写键（D8）：${PLUGIN_SETTINGS_KEYS.join(', ')}`);

    const basic = createFieldGroup({
        title: '运行开关',
        children: [contextN.el, autoWrite.el, autoRender.el, caseSensitive.el, wholeWords.el],
    });
    const naiGroup = createDetails({
        summary: '4.13 生图固定参数',
        open: true,
        body: [
            model.el, width.el, height.el, steps.el, scale.el,
            sampler.el, noise.el, seed.el, seedRandom.el,
            imageFormat.el, qualityToggle.el, tagHintQt.el,
            ucPreset.el, tagHintUc.el, cfgRescale.el,
            varietyEnabled.el, varietySigma.el,
            sm.el, smDyn.el, straightAlpha.el, tagHintTransparent.el,
            qualityStrategy.el,
        ],
    });

    const saveBtn = createButton({
        label: '保存设置',
        variant: 'primary',
        onClick: () => {
            err.clear();
            const skipCfg = varietyEnabled.getValue()
                ? varietySigma.getValue()
                : null;
            const patch = pickAllowedSettingsPatch({
                contextWindowSize: contextN.getValue(),
                autoWriteSlots: autoWrite.getValue(),
                autoRenderSlots: autoRender.getValue(),
                matchDefaults: {
                    caseSensitive: caseSensitive.getValue(),
                    matchWholeWords: wholeWords.getValue(),
                },
                naiParams: applyFormFields(nai, {
                    model: model.getValue(),
                    width: width.getValue(),
                    height: height.getValue(),
                    steps: steps.getValue(),
                    scale: scale.getValue(),
                    sampler: sampler.getValue(),
                    noise_schedule: noise.getValue(),
                    seed: seed.getValue(),
                    seedRandom: seedRandom.getValue(),
                    image_format: imageFormat.getValue(),
                    qualityToggle: qualityToggle.getValue(),
                    tag_hint_qt: tagHintQt.getValue(),
                    ucPreset: ucPreset.getValue(),
                    tag_hint_uc_preset: tagHintUc.getValue(),
                    cfg_rescale: cfgRescale.getValue(),
                    skip_cfg_above_sigma: skipCfg,
                    sm: sm.getValue(),
                    sm_dyn: smDyn.getValue(),
                    straight_alpha: straightAlpha.getValue(),
                    tag_hint_transparent_background: tagHintTransparent.getValue(),
                    qualityStrategy: qualityStrategy.getValue(),
                    n_samples: defaults.n_samples,
                    schemaVersion: defaults.schemaVersion,
                }),
            });
            settings.patch(patch);
            toast(host, 'success', '运行配置已保存');
        },
    });

    shell.append(err.el, basic.el, naiGroup.el, keysHint, saveBtn);
    root.appendChild(shell);

    let destroyed = false;
    return {
        destroy() {
            if (destroyed) return;
            destroyed = true;
            err.destroy();
            contextN.destroy();
            autoWrite.destroy();
            autoRender.destroy();
            caseSensitive.destroy();
            wholeWords.destroy();
            basic.destroy();
            naiGroup.destroy();
            shell.remove();
        },
    };
}
