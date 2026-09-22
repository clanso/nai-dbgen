/**
 * L3 领域层 · &lt;IMG&gt;n&lt;/IMG&gt; 的唯一解析/生成处。
 * 展示正则与出站剥离必须共用本定义，防止漂移。
 * 归属：W1-A 领域代理实现。W0 仅冻结签名。
 */

/** 与 assets/regex 及剥离逻辑共用的源模式（实现导出编译后的 RegExp 与模板）。 */
export const SLOT_TOKEN_PATTERN_SOURCE = '<IMG>\\s*(\\d+)\\s*</IMG>';

/**
 * @returns {RegExp} 全局正则，用于匹配正文中的 slot
 */
export function createSlotTokenRegex() {
    return new RegExp(SLOT_TOKEN_PATTERN_SOURCE, 'gi');
}

/**
 * @param {number} slotId
 * @returns {string} `<IMG>\n{n}\n</IMG>` 规范形态
 */
export function formatSlotToken(slotId) {
    const id = Number(slotId);
    if (!Number.isInteger(id) || id < 1) {
        throw new Error('invalid argument: slotId');
    }
    return `<IMG>\n${id}\n</IMG>`;
}

/**
 * @param {string} text
 * @returns {number[]} 正文中出现的全部 slotId（保序）
 */
export function parseSlotIds(text) {
    if (typeof text !== 'string' || text.length === 0) {
        return [];
    }
    const re = createSlotTokenRegex();
    /** @type {number[]} */
    const ids = [];
    let m = re.exec(text);
    while (m) {
        ids.push(Number(m[1]));
        m = re.exec(text);
    }
    return ids;
}

/**
 * 从文本中删除全部 slot 标记（正文保留）。用于上下文块与出站兜底。
 * @param {string} text
 * @returns {string}
 */
export function stripSlotTokens(text) {
    if (typeof text !== 'string') {
        return '';
    }
    return text.replace(createSlotTokenRegex(), '');
}

/**
 * 正则 1 的 replaceString 骨架（含 $1）；由宿主安装器写入。
 * @returns {string}
 */
export function slotWidgetReplaceTemplate() {
    return '<div class="nai-slot" data-slot="$1">'
        + '<button class="nai-slot-btn"></button>'
        + '<div class="nai-slot-img"></div>'
        + '</div>';
}
