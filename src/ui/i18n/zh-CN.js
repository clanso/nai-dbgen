/**
 * L5 UI · 中文文案字典（架构 §8.8）。不做完整 i18n，仅提取口子。
 * 归属：W1-E 组件代理实现。W0 仅冻结签名。
 */

/** @type {Readonly<Record<string, string>>} */
export const zhCN = Object.freeze({
    'app.name': '酒馆数据库生图',
    'slot.generate': '生图',
    'slot.regenerate': '重新生成',
});

/**
 * @param {string} key
 * @param {Record<string, string|number>} [params]
 * @returns {string}
 */
export function t(key, params) {
    throw new Error('not implemented: t');
}
