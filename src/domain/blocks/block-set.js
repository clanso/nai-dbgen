/**
 * L3 领域层 · BlockSet：四块（及未来扩展块）容器。
 * 必须是 Map&lt;variableName, string&gt;，禁止四个具名字段（架构文档 §9）。
 * 不提供「合并成一段」的方法。
 * 归属：W1-A 领域代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {Map<string, string>} BlockSet
 */

/**
 * 创建空 BlockSet（或从条目初始化）。
 * @param {Iterable<[string, string]>} [entries]
 * @returns {BlockSet}
 */
export function createBlockSet(entries) {
    throw new Error('not implemented: createBlockSet');
}

/**
 * @param {BlockSet} set
 * @param {string} variableName 中文主名或 ASCII 别名的规范名（见 variable-map）
 * @param {string} text 空块传 ''
 * @returns {BlockSet} 新 Map（或同引用，由实现决定；推荐不可变）
 */
export function setBlock(set, variableName, text) {
    throw new Error('not implemented: setBlock');
}

/**
 * @param {BlockSet} set
 * @param {string} variableName
 * @returns {string} 缺失时返回 ''（需求：为空则为空）
 */
export function getBlock(set, variableName) {
    throw new Error('not implemented: getBlock');
}

/**
 * @param {BlockSet} set
 * @returns {Readonly<Record<string, string>>} 只读快照，供日志/面板；非拼接
 */
export function blockSetToRecord(set) {
    throw new Error('not implemented: blockSetToRecord');
}
