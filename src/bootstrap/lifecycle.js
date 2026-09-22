/**
 * L0 装配 · activate / dispose（manifest hooks）。
 * 归属：W3-J 装配代理实现。W0 仅冻结签名。
 */

/**
 * 插件激活：能力探测、装正则、挂 UI、启动观察器与自动开关。
 * @returns {Promise<void>}
 */
export async function activate() {
    throw new Error('not implemented: activate');
}

/**
 * 插件停用：销毁 UI、取消订阅、释放 blob URL。须可重复调用。
 * @returns {Promise<void>}
 */
export async function dispose() {
    throw new Error('not implemented: dispose');
}
