/**
 * 生图模型回文：一行一个字段。程序再套成 NAI caption 树。
 * 字段名：slotid / size / analysis / scene / scene_uc / char / char_uc。
 * char 可写成 `0.4,0.6 | 提示词`；没有坐标时用画面中心。
 */

const FIELD_RE = /^(slotid|size|analysis|scene|scene_uc|char|char_uc)\s*[:：]\s*(.*)$/;

/**
 * @param {string} raw
 * @returns {{ x: number, y: number, text: string }}
 */
function splitCharLine(raw) {
    const text = String(raw ?? '').trim();
    const m = text.match(/^([0-9]*\.?[0-9]+)\s*,\s*([0-9]*\.?[0-9]+)\s*\|\s*([\s\S]*)$/);
    if (!m) {
        return { x: 0.5, y: 0.5, text };
    }
    const x = Number(m[1]);
    const y = Number(m[2]);
    const ok = Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= 1 && y >= 0 && y <= 1;
    return {
        x: ok ? x : 0.5,
        y: ok ? y : 0.5,
        text: m[3].trim(),
    };
}

/**
 * @param {string} text
 * @returns {Array<Record<string, string|string[]>>}
 */
function splitBlocks(text) {
    /** @type {Array<Record<string, string|string[]>>} */
    const blocks = [];
    /** @type {Record<string, string|string[]>|null} */
    let cur = null;
    /** @type {string|null} */
    let field = null;

    const push = () => {
        if (cur && (cur.slotid || cur.scene || cur.chars)) {
            blocks.push(cur);
        }
    };

    for (const line of String(text ?? '').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === '---') {
            push();
            cur = null;
            field = null;
            continue;
        }
        const m = trimmed.match(FIELD_RE);
        if (m) {
            if (m[1] === 'slotid' && cur && cur.slotid) {
                push();
                cur = null;
                field = null;
            }
            if (!cur) {
                cur = { chars: [], char_ucs: [] };
            }
            field = m[1];
            if (field === 'char') {
                /** @type {string[]} */ (cur.chars).push(m[2]);
            } else if (field === 'char_uc') {
                /** @type {string[]} */ (cur.char_ucs).push(m[2]);
            } else {
                cur[field] = m[2];
            }
            continue;
        }
        if (cur && field && trimmed) {
            if (field === 'char') {
                const list = /** @type {string[]} */ (cur.chars);
                list[list.length - 1] = `${list[list.length - 1]}\n${line.trim()}`;
            } else if (field === 'char_uc') {
                const list = /** @type {string[]} */ (cur.char_ucs);
                list[list.length - 1] = `${list[list.length - 1]}\n${line.trim()}`;
            } else {
                cur[field] = `${cur[field] || ''}\n${line.trim()}`;
            }
        }
    }
    push();
    return blocks;
}

/**
 * @param {Record<string, string|string[]>} block
 * @returns {import('./nai-params.js').NaiCaption}
 */
function blockToCaption(block) {
    const chars = /** @type {string[]} */ (block.chars || []);
    const ucs = /** @type {string[]} */ (block.char_ucs || []);
    const posChars = chars.map((line) => {
        const parsed = splitCharLine(line);
        return {
            char_caption: parsed.text,
            centers: [{ x: parsed.x, y: parsed.y }],
        };
    });
    const negCount = Math.max(chars.length, ucs.length);
    const negChars = [];
    for (let i = 0; i < negCount; i += 1) {
        negChars.push({ char_caption: String(ucs[i] ?? '').trim() });
    }
    return {
        v4_prompt: {
            caption: {
                base_caption: String(block.scene ?? '').trim(),
                char_captions: posChars,
            },
        },
        v4_negative_prompt: {
            caption: {
                base_caption: String(block.scene_uc ?? '').trim(),
                char_captions: negChars,
            },
        },
    };
}

/**
 * 多图回文。没有 slotid 行时返回空数组。
 * @param {unknown} text
 * @returns {object[]}
 */
export function parseFlatSlotPlans(text) {
    return splitBlocks(text)
        .filter((b) => String(b.slotid ?? '').trim())
        .map((b) => {
            /** @type {Record<string, unknown>} */
            const item = {
                slotid: String(b.slotid).trim(),
                caption: blockToCaption(b),
            };
            const size = String(b.size ?? '').trim();
            const analysis = String(b.analysis ?? '').trim();
            if (size) {
                item.size = size;
            }
            if (analysis) {
                item.analysis = analysis;
            }
            return item;
        });
}

/**
 * 单图回文：没有 slotid 也收。
 * @param {unknown} text
 * @returns {{ caption: import('./nai-params.js').NaiCaption, size?: string, analysis?: string }|null}
 */
export function parseFlatSingleCaption(text) {
    const blocks = splitBlocks(text);
    const block = blocks.find((b) => b.scene || (Array.isArray(b.chars) && b.chars.length > 0));
    if (!block) {
        return null;
    }
    /** @type {{ caption: import('./nai-params.js').NaiCaption, size?: string, analysis?: string }} */
    const out = { caption: blockToCaption(block) };
    const size = String(block.size ?? '').trim();
    const analysis = String(block.analysis ?? '').trim();
    if (size) {
        out.size = size;
    }
    if (analysis) {
        out.analysis = analysis;
    }
    return out;
}
