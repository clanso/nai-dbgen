/**
 * L2 宿主适配 · 与酒馆同一套 yaml 解析器（public/lib.js 导出）。
 *
 * 扩展安装 URL（用户级与全局 third-party 相同前缀）：
 *   …/scripts/extensions/third-party/<目录名>/src/adapters/host/st-yaml.js
 * 见 ref/SillyTavern/src/users.js（`/scripts/extensions/third-party/*` 路由）与
 * extensions.js discover 的 `third-party/${f}` 命名。
 *
 * 反代子路径下不能写站点根绝对路径 `/lib.js`；用相对 import.meta.url 解析（对照
 * stable-diffusion 等内置扩展的 `../../../lib.js`）。
 *
 * Node / 演示可注入 npm `yaml`（devDependency，版本对齐酒馆 ^2.8.3）。
 */

/**
 * 自本文件（…/src/adapters/host/）上溯到酒馆 public/ 的相对前缀。
 * host → adapters → src → <扩展根> → third-party → extensions → scripts → public
 */
export const ST_PUBLIC_RELATIVE_PREFIX = '../../../../../../../';

/**
 * @typedef {object} YamlApi
 * @property {(text: string) => unknown} parse
 * @property {(value: unknown) => string} stringify
 */

/**
 * 解析酒馆 public/ 下模块的绝对 URL（随宿主子路径变化）。
 * @param {string} pathFromPublic 如 `lib.js`、`scripts/world-info.js`（可带前导 /）
 * @param {string|URL} [baseUrl=import.meta.url] 便于单测注入假 base
 * @returns {string}
 */
export function resolveStPublicModuleUrl(pathFromPublic, baseUrl = import.meta.url) {
    const rel = String(pathFromPublic ?? '').replace(/^\/+/, '');
    if (!rel) {
        throw new Error('invalid argument: pathFromPublic');
    }
    return new URL(`${ST_PUBLIC_RELATIVE_PREFIX}${rel}`, baseUrl).href;
}

/**
 * @param {unknown} mod
 * @returns {YamlApi|null}
 */
export function yamlApiFromModule(mod) {
    const y = mod?.yaml ?? mod?.default ?? mod;
    if (!y || typeof y.parse !== 'function' || typeof y.stringify !== 'function') {
        return null;
    }
    return {
        parse: (text) => y.parse(text),
        stringify: (value) => y.stringify(value),
    };
}

/**
 * @returns {boolean}
 */
function isNodeRuntime() {
    return typeof process !== 'undefined'
        && Boolean(process.versions)
        && Boolean(process.versions.node);
}

/**
 * 从酒馆 public/lib.js 加载 yaml（仅浏览器宿主）。
 * @param {{ url?: string }} [opts]
 * @returns {Promise<YamlApi>}
 */
export async function loadStYamlApi(opts = {}) {
    const url = opts.url ?? resolveStPublicModuleUrl('lib.js');
    let mod;
    try {
        mod = await import(url);
    } catch (cause) {
        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`无法加载酒馆 lib.js（${url}）：${detail}`);
    }
    const api = yamlApiFromModule(mod);
    if (!api) {
        throw new Error('酒馆 lib.js 未导出可用的 yaml');
    }
    return api;
}

/**
 * @param {object} [deps]
 * @param {YamlApi} [deps.yaml] 直接注入
 * @param {() => Promise<YamlApi>|YamlApi} [deps.load] 懒加载
 * @returns {Promise<YamlApi>}
 */
export async function resolveYamlApi(deps = {}) {
    if (deps.yaml) {
        return deps.yaml;
    }
    if (typeof deps.load === 'function') {
        return deps.load();
    }
    try {
        return await loadStYamlApi();
    } catch (stErr) {
        // 仅 Node 单测回退 npm yaml；浏览器裸 import('yaml') 必然失败，不得覆盖真实原因
        if (isNodeRuntime()) {
            try {
                const mod = await import('yaml');
                const api = yamlApiFromModule(mod);
                if (api) {
                    return api;
                }
            } catch {
                // ignore — 下面抛出酒馆侧错误
            }
        }
        if (stErr instanceof Error) {
            throw stErr;
        }
        throw new Error(`无法加载酒馆 YAML 解析器：${String(stErr)}`);
    }
}

/**
 * @param {YamlApi} yaml
 * @param {unknown} text
 * @returns {{ ok: true, value: unknown } | { ok: false, error: string }}
 */
export function parseYamlDocument(yaml, text) {
    if (text == null) {
        return { ok: true, value: undefined };
    }
    if (typeof text !== 'string') {
        return { ok: false, error: '须为文本' };
    }
    const trimmed = text.trim();
    if (!trimmed) {
        return { ok: true, value: undefined };
    }
    try {
        return { ok: true, value: yaml.parse(trimmed) };
    } catch (cause) {
        return {
            ok: false,
            error: cause instanceof Error ? cause.message : String(cause),
        };
    }
}

/**
 * @param {YamlApi} yaml
 * @param {unknown} text
 * @returns {{ ok: true, value: Record<string, unknown>|undefined } | { ok: false, error: string }}
 */
export function parseYamlObject(yaml, text) {
    const parsed = parseYamlDocument(yaml, text);
    if (!parsed.ok) {
        return parsed;
    }
    if (parsed.value === undefined) {
        return { ok: true, value: undefined };
    }
    if (parsed.value === null || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
        return { ok: false, error: '须为 YAML 对象（键值对）' };
    }
    return { ok: true, value: /** @type {Record<string, unknown>} */ (parsed.value) };
}

/**
 * @param {YamlApi} yaml
 * @param {unknown} text
 * @returns {{ ok: true, value: unknown[]|undefined } | { ok: false, error: string }}
 */
export function parseYamlArray(yaml, text) {
    const parsed = parseYamlDocument(yaml, text);
    if (!parsed.ok) {
        return parsed;
    }
    if (parsed.value === undefined) {
        return { ok: true, value: undefined };
    }
    if (!Array.isArray(parsed.value)) {
        return { ok: false, error: '须为 YAML 列表' };
    }
    return { ok: true, value: parsed.value };
}
