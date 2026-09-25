/**
 * L5 UI · 提示词面板纯函数（分层展示 / 摘要 / 搜索过滤）。
 * 复制文本格式见 `../common/prompt-text.js`。
 * 归属：W2-H 面板代理。
 */

import {
    formatPromptText,
    isUsableArtist,
} from '../../common/prompt-text.js';

export { isUsableArtist } from '../../common/prompt-text.js';

/** 与 domain/slot/slot-token 同源；ui 层不得直引 domain/slot，本地镜像剥标记。 */
const SLOT_TOKEN_RE = /<IMG>\s*\d+\s*<\/IMG>/gi;

/**
 * 剥 slot 标记并压空白，取前 maxLen 字作楼层摘要。
 * @param {string} [text]
 * @param {number} [maxLen=40]
 * @returns {string}
 */
export function summarizeMessageText(text, maxLen = 40) {
    const raw = typeof text === 'string' ? text : '';
    const stripped = raw.replace(SLOT_TOKEN_RE, ' ');
    const compact = stripped.replace(/\s+/g, ' ').trim();
    if (!compact) return '';
    const limit = Number.isFinite(maxLen) && maxLen > 0 ? Math.floor(maxLen) : 40;
    return compact.length <= limit ? compact : `${compact.slice(0, limit)}…`;
}

/**
 * @param {import('../../../domain/model/nai-params.js').NaiCaption|null|undefined} caption
 * @returns {{ positive: string, negative: string, characters: string, charCount: number }}
 */
export function extractCaptionParts(caption) {
    const pos = caption?.v4_prompt?.caption;
    const neg = caption?.v4_negative_prompt?.caption;
    const positive = pos && typeof pos.base_caption === 'string' ? pos.base_caption : '';
    const negative = neg && typeof neg.base_caption === 'string' ? neg.base_caption : '';
    /** @type {string[]} */
    const chars = [];
    const list = Array.isArray(pos?.char_captions) ? pos.char_captions : [];
    for (const item of list) {
        const line = item && typeof item.char_caption === 'string'
            ? item.char_caption.trim()
            : '';
        if (line) chars.push(line);
    }
    return {
        positive,
        negative,
        characters: chars.join('\n'),
        charCount: chars.length,
    };
}

/**
 * 折叠标题用的单行摘要；过长截断。
 * @param {string} [text]
 * @param {number} [maxLen=36]
 * @returns {string}
 */
export function foldSummarySnippet(text, maxLen = 36) {
    const raw = typeof text === 'string' ? text : '';
    const compact = raw.replace(/\s+/g, ' ').trim();
    if (!compact) return '';
    const limit = Number.isFinite(maxLen) && maxLen > 0 ? Math.floor(maxLen) : 36;
    return compact.length <= limit ? compact : `${compact.slice(0, limit)}…`;
}

/**
 * 拼接可搜索的分类纯文本（含画师串段，若传入）。
 * @param {import('../../../domain/model/slot.js').SlotRecord} record
 * @param {{ positive?: string, negative?: string }|null} [artist]
 * @returns {string}
 */
export function recordSearchBlob(record, artist = null) {
    const usable = isUsableArtist(artist);
    return formatPromptText(record?.caption, {
        artist: usable ? artist : null,
        includeArtist: usable,
    }).toLowerCase();
}

/**
 * @typedef {'ok'|'error'} FloorStatus
 */

/**
 * @typedef {object} FloorGroup
 * @property {number} messageId
 * @property {string} summary
 * @property {FloorStatus} status
 * @property {import('../../../domain/model/slot.js').SlotRecord[]} [records]
 * @property {string} [errorMessage]
 */

/**
 * 按提示词内容过滤楼组；空 query 原样返回。读失败楼在有 query 时隐藏。
 * @param {FloorGroup[]} groups
 * @param {string} [query]
 * @param {object} [opts]
 * @param {(record: import('../../../domain/model/slot.js').SlotRecord) => ({ positive?: string, negative?: string }|null|undefined)} [opts.artistFor]
 * @returns {FloorGroup[]}
 */
export function filterFloorGroups(groups, query, opts = {}) {
    const q = String(query ?? '').trim().toLowerCase();
    if (!q) return Array.isArray(groups) ? groups.slice() : [];
    const artistFor = typeof opts?.artistFor === 'function'
        ? opts.artistFor
        : () => null;
    /** @type {FloorGroup[]} */
    const out = [];
    for (const g of groups || []) {
        if (!g || g.status !== 'ok') continue;
        const records = (g.records || []).filter((r) => {
            const artist = artistFor(r) ?? null;
            return recordSearchBlob(r, artist).includes(q);
        });
        if (records.length) {
            out.push({ ...g, records });
        }
    }
    return out;
}

/**
 * @typedef {{ label: string, text: string }} PromptKvRow
 */

/**
 * @typedef {object} PromptCharBlock
 * @property {string} title
 * @property {PromptKvRow[]} rows
 */

/**
 * @typedef {object} PromptDisplaySection
 * @property {string} title
 * @property {PromptKvRow[]} [rows]
 * @property {PromptCharBlock[]} [children]
 */

/**
 * @typedef {object} PromptDisplayModel
 * @property {PromptDisplaySection[]} sections
 * @property {boolean} hasArtist
 */

/**
 * @param {string|null|undefined} text
 * @returns {boolean}
 */
function hasDisplayText(text) {
    return typeof text === 'string' && text.trim().length > 0;
}

/**
 * 卡片右侧分层展示模型：空行/空大类不出现；不含位置。
 * @param {import('../../../domain/model/nai-params.js').NaiCaption|null|undefined} caption
 * @param {{ positive?: string, negative?: string }|null|undefined} artist
 * @returns {PromptDisplayModel}
 */
export function buildPromptDisplayModel(caption, artist) {
    /** @type {PromptDisplaySection[]} */
    const sections = [];
    let hasArtist = false;

    if (isUsableArtist(artist)) {
        /** @type {PromptKvRow[]} */
        const rows = [];
        const rec = /** @type {Record<string, unknown>} */ (artist);
        const pos = String(rec.positivePrompt ?? rec.positive ?? '');
        const neg = String(rec.negativePrompt ?? rec.negative ?? '');
        if (hasDisplayText(pos)) rows.push({ label: '正面', text: pos });
        if (hasDisplayText(neg)) rows.push({ label: '负面', text: neg });
        if (rows.length) {
            sections.push({ title: '画师串', rows });
            hasArtist = true;
        }
    }

    const posCap = caption?.v4_prompt?.caption;
    const negCap = caption?.v4_negative_prompt?.caption;
    /** @type {PromptKvRow[]} */
    const sceneRows = [];
    const scenePos = posCap && typeof posCap.base_caption === 'string' ? posCap.base_caption : '';
    const sceneNeg = negCap && typeof negCap.base_caption === 'string' ? negCap.base_caption : '';
    if (hasDisplayText(scenePos)) sceneRows.push({ label: '正面', text: scenePos });
    if (hasDisplayText(sceneNeg)) sceneRows.push({ label: '负面', text: sceneNeg });
    if (sceneRows.length) {
        sections.push({ title: '场景', rows: sceneRows });
    }

    const posChars = Array.isArray(posCap?.char_captions) ? posCap.char_captions : [];
    const negChars = Array.isArray(negCap?.char_captions) ? negCap.char_captions : [];
    const count = Math.max(posChars.length, negChars.length);
    /** @type {PromptCharBlock[]} */
    const children = [];
    for (let i = 0; i < count; i += 1) {
        const pc = posChars[i];
        const nc = negChars[i];
        const charPos = pc && typeof pc.char_caption === 'string' ? pc.char_caption : '';
        const charNeg = nc && typeof nc.char_caption === 'string' ? nc.char_caption : '';
        /** @type {PromptKvRow[]} */
        const rows = [];
        if (hasDisplayText(charPos)) rows.push({ label: '正面', text: charPos });
        if (hasDisplayText(charNeg)) rows.push({ label: '负面', text: charNeg });
        if (rows.length) {
            children.push({ title: `角色${i + 1}`, rows });
        }
    }
    if (children.length) {
        sections.push({ title: '角色', children });
    }

    return { sections, hasArtist };
}

/**
 * 生成可粘进工作台的分类纯文本。
 * includeArtist 为真时前置「画师串」段；场景内容不拼画师串。
 *
 * @param {import('../../../domain/model/nai-params.js').NaiCaption|null|undefined} caption
 * @param {object} [opts]
 * @param {{ positive?: string, negative?: string }|null} [opts.artist]
 * @param {boolean} [opts.includeArtist]
 * @returns {string}
 */
export function buildCopyPromptText(caption, opts = {}) {
    return formatPromptText(caption, {
        artist: opts?.artist ?? null,
        includeArtist: opts?.includeArtist === true,
    });
}

/**
 * 解析本图应展示/复制的画师串 id：图片记录优先，否则当前激活。
 * @param {import('../../../domain/model/slot.js').SlotRecord|null|undefined} record
 * @param {string|null|undefined} activeArtistId
 * @returns {string|null}
 */
export function resolveArtistIdForRecord(record, activeArtistId) {
    const images = record && Array.isArray(record.images) ? record.images : [];
    if (images.length > 0) {
        const latest = images[images.length - 1];
        const fromImage = latest?.artistId == null ? '' : String(latest.artistId).trim();
        if (fromImage) return fromImage;
    }
    const active = activeArtistId == null ? '' : String(activeArtistId).trim();
    return active || null;
}
