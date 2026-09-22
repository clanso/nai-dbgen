/**
 * L3 领域层 · 角色库注入块格式化（需求 4.1 缩进格式唯一定义点）。
 * 归属：W1-A 领域代理实现。W0 仅冻结签名。
 */

/**
 * @typedef {import('../model/character.js').Character} Character
 */

/**
 * 将命中角色格式化为「角色库」变量文本。
 * 固定/非固定必须标明；无非固定条目时不输出空的「非固定特征」段。
 * @param {Character[]} characters
 * @returns {string}
 */
export function formatCharacterBlock(characters) {
    if (!Array.isArray(characters) || characters.length === 0) {
        return '';
    }
    /** @type {string[]} */
    const parts = [];
    for (const character of characters) {
        if (!character) {
            continue;
        }
        const name = String(character.name ?? '');
        const fixed = String(character.fixedFeatures ?? '');
        /** @type {string[]} */
        const lines = [`${name}：`, `固定特征：${fixed}`];
        const vars = Array.isArray(character.variableFeatures)
            ? character.variableFeatures.filter((v) => v && (v.name || v.prompt))
            : [];
        if (vars.length > 0) {
            lines.push('非固定特征：');
            for (const vf of vars) {
                lines.push(`   ${String(vf.name ?? '')}：${String(vf.prompt ?? '')}`);
            }
        }
        parts.push(lines.join('\n'));
    }
    return parts.join('\n\n');
}
