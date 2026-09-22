/**
 * L5 UI · 生成工作台（需求 4.15）：写提示词与出图解耦。
 * 归属：W2-I 工作台代理实现。W0 仅冻结签名。
 *
 * 裁决 D13：提示词状态为 NaiCaption（base 文本域 + 角色分镜可增删列表），
 * 不是单一自由文本。写出走 workbenchService.writePrompt → NaiCaption；
 * 出图走 generateImage({ caption: NaiCaption, replaceCharacterKeywords, … })。
 */

/**
 * @param {Element} root
 * @param {object} deps 含 workbenchService / imageGen / repos / host / loadSettings
 * @returns {{ destroy: () => void }}
 */
export function mountWorkbench(root, deps) {
    throw new Error('not implemented: mountWorkbench');
}
