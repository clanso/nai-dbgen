/**
 * L5 UI · 中文文案字典（架构 §8.8）。不做完整 i18n，仅提取口子。
 * 归属：W1-E 组件代理实现。W0 仅冻结签名。
 */

/** @type {Readonly<Record<string, string>>} */
export const zhCN = Object.freeze({
    'app.name': '酒馆数据库生图',
    'slot.generate': '生图',
    'slot.regenerate': '重新生成',

    'empty.title': '这里还是空的',
    'empty.library': '没有匹配的条目，换一个筛选条件试试。',

    'common.clear': '清除',
    'common.cancel': '取消',
    'common.confirm': '确认',
    'common.search': '搜索',
    'common.import': '导入',
    'common.export': '导出',
    'common.preview': '预览',
    'common.close': '关闭',

    'picker.searchPlaceholder': '搜索并选择当前项',
    'picker.noResults': '没有匹配项',
    'picker.clear': '清除当前选择',

    'import.dropTitle': '拖入资料文件',
    'import.dropHint': '支持 .json；也可以粘贴原始文本。导入前一定先预览。',
    'import.pickFile': '选择文件',
    'import.pastePlaceholder': '或在这里粘贴 JSON',
    'import.parsePaste': '解析粘贴内容',
    'import.previewTitle': '导入预览',
    'import.summary': '识别 {count} 条',
    'import.duplicateStrategy': '重复内容',
    'import.skip': '跳过重复',
    'import.overwrite': '覆盖已有',
    'import.rename': '另存为新副本',
    'import.commit': '导入已勾选',
    'import.exportTitle': '导出当前库',
    'import.exportHint': '导出为 JSON 信封，可再导入到本插件。',
    'import.exportButton': '导出 JSON',
    'import.parseError': '无法解析 JSON：{message}',
    'import.empty': '没有可预览的条目',
    'import.done': '导入完成',
    'import.colSelect': '选择',
    'import.colName': '名称',
    'import.colId': 'ID',
    'import.colKind': '类型',

    'modal.fallbackTitle': '对话框',

    'library.searchPlaceholder': '搜索资料库',
    'library.filter': '筛选',
    'library.sort': '排序',
    'library.create': '＋新建',
    'library.enabled': '启用',

    'nested.emptyParents': '还没有分组或库。',
    'nested.emptyChildren': '此组暂无条目。',
    'nested.expand': '展开',
    'nested.collapse': '折叠',
});

/**
 * @param {string} key
 * @param {Record<string, string|number>} [params]
 * @returns {string}
 */
export function t(key, params) {
    const rawKey = key == null ? '' : String(key);
    let text = Object.prototype.hasOwnProperty.call(zhCN, rawKey)
        ? zhCN[rawKey]
        : rawKey;
    if (params && typeof params === 'object') {
        text = text.replace(/\{(\w+)\}/g, (match, name) => {
            if (Object.prototype.hasOwnProperty.call(params, name)) {
                const value = params[name];
                return value == null ? '' : String(value);
            }
            return match;
        });
    }
    return text;
}
