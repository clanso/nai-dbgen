/**
 * L5 UI · 运行配置（上下文楼数、自动开关、4.13 参数） 管理面板。
 * 归属：W2-H 面板代理实现。W0 仅冻结签名。
 * 键名严格按 D8。
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
import { PLUGIN_SETTINGS_KEYS, pickAllowedSettingsPatch } from '../_lib/library-logic.js';
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
    const nai = { ...defaultNaiParams(), ...(current.naiParams || {}) };

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

    const width = createNumberField({ label: '宽', value: nai.width, min: 64, max: 2048, step: 64 });
    const height = createNumberField({ label: '高', value: nai.height, min: 64, max: 2048, step: 64 });
    const steps = createNumberField({ label: 'steps', value: nai.steps, min: 1, max: 50, step: 1 });
    const scale = createNumberField({ label: 'scale', value: nai.scale, min: 0, max: 10, step: 0.1 });
    const seed = createNumberField({ label: 'seed', value: nai.seed, min: 0, max: 4294967295, step: 1 });
    const seedRandom = createCheckbox({ label: '随机 seed', checked: nai.seedRandom !== false });
    const model = createField({ label: '模型', value: nai.model ?? '' });
    const sampler = createField({ label: 'sampler', value: nai.sampler ?? '' });
    const noise = createField({ label: 'noise_schedule', value: nai.noise_schedule ?? '' });
    const imageFormat = createSelect({
        label: '图片格式',
        value: nai.image_format === 'webp' ? 'webp' : 'png',
        options: [
            { value: 'png', label: 'png' },
            { value: 'webp', label: 'webp' },
        ],
    });
    const qualityToggle = createCheckbox({ label: 'qualityToggle', checked: nai.qualityToggle !== false });
    const ucPreset = createNumberField({ label: 'ucPreset', value: nai.ucPreset ?? 0, min: 0, max: 10, step: 1 });

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
            imageFormat.el, qualityToggle.el, ucPreset.el,
        ],
    });

    const saveBtn = createButton({
        label: '保存设置',
        variant: 'primary',
        onClick: () => {
            err.clear();
            const patch = pickAllowedSettingsPatch({
                contextWindowSize: contextN.getValue(),
                autoWriteSlots: autoWrite.getValue(),
                autoRenderSlots: autoRender.getValue(),
                matchDefaults: {
                    caseSensitive: caseSensitive.getValue(),
                    matchWholeWords: wholeWords.getValue(),
                },
                naiParams: {
                    ...nai,
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
                    ucPreset: ucPreset.getValue(),
                },
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
