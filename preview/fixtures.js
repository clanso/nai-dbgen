/**
 * 预览沙箱示例库数据与聊天楼层。
 * 仅供 preview/ 使用，不碰插件本体。
 */

import { defaultPluginSettings } from '../src/domain/model/plugin-settings.js';
import {
    SEED_LLM_DEFAULT_ID,
    SEED_NAI_DEFAULT_ID,
} from '../src/bootstrap/seed.js';
import { DEFAULT_NAI_BASE_URL } from '../src/domain/model/api-config.js';

/** @type {string} */
export const FIXTURE_CHAT_ID = 'preview-chat-1';

/** @type {string} */
export const IDS = Object.freeze({
    group: 'fixture-group-main',
    charAlice: 'fixture-char-alice',
    charBob: 'fixture-char-bob',
    tagLib: 'fixture-tag-lib',
    tagLibFeature: 'fixture-tag-lib-feature',
    tagGarden: 'fixture-tag-garden',
    tagSoftLight: 'fixture-tag-soft-light',
    tagFake: 'fixture-tag-fake',
    tagHair: 'fixture-tag-hair',
    artist: 'fixture-artist-1',
    artist2: 'fixture-artist-2',
    artist3: 'fixture-artist-3',
    /** 与种子默认 LLM 同 id；预览页填占位 Key/地址/模型以走网关 */
    llm: SEED_LLM_DEFAULT_ID,
    nai: SEED_NAI_DEFAULT_ID,
});

/**
 * 48×60 竖版渐变 PNG（data URL），过 D51 光栅白名单。
 * 写入 ArtistString.referenceImageRef / cardImageRef：悬浮球 resolveCover 先试 gateCoverUrl，
 * data URL 直接放行；不用 svg。
 */
const COVER_PNG = Object.freeze({
    rose: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAA8CAIAAACvoq6rAAABL0lEQVR42s3CDSsDAQDH4f9Hutvtdrvd1LyPjZmZ2WZmZma2mZklSZIkSZIkSRIlSZIkSfLNfI3f06O/ni6qfsMbqPoJd1D1HV5H1Ve4japPbw1VH14LVe/eKqrevCaqXr0Gql5CDVQ9h+qoegqtoOogVEPVg7uMqnu3iqo7dwlVt24FVTfuIqqug2VUXQXLqLoMLqDqIlhC1bkzj6ozp4iqU2cOVSdOAVXHziyqjgJ5VB0Gcqg6CORQtR/IomrPnkHVrp1B1Y49japtO42qLXsKVZv+FKq6/klUdfxJVLX9SVS1rAlUNa0EqurWOKpq1hiqqlYcVRVfDFVl3yiqSr4RVBV9UVQVzCiq8uYwqrLmEKoy5iCq0uYAqlJGP6qSRh+qEkYvquJGBFUxI4L6D20GODWFoCUWAAAAAElFTkSuQmCC',
    blue: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAA8CAIAAACvoq6rAAABNklEQVR42s3CiSoDAADH4f+TjNls7GD3ZSNXjlw5wtZszYxZbnNEEkkkkUQSSSSRRBJJ3sxr/L4+xVb+UBVd+kVVTfEHVTWL36iKLHyhKjL3iarw7AeqwjPvqApNv6EqNPWKqmDhBVXByWdUBfJPqApMPKLKn3tAlX/sHlW+7B2qfKO3qPJmblDlTV+jypO6QpV75BJV7uQFqlyJc1S54meoqh4+RVX10AmqqgaPUVU1cIQqZ/8hqpx9B6hy9O6jytGzhyp79y6q7F07qLJ1bqPK1rGFqsr2TVRVtm2gqqJ1HVXWljVUWZtXUWVpWkaVpbGIqvKGRVSV18+jylw3iypz7TSqTLEpVJmiBVSVRfKoKguPo8oYyqHKGMyiqjSQQVWpL42qEm8KVSWeJKoM7gSqDK446j9UjtkWUVdanQAAAABJRU5ErkJggg==',
    green: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAA8CAIAAACvoq6rAAABKElEQVR42s3Ciy5CAQDH4f/jJElO98vpXqdTnUoppZTSGGOMMcaYMcYYY4wx86he4/ftU+Nviqr67zqqaj8TVDnfY1Q5X2uoqn6OUFX5GKKq8j5EVfltFVX26wBV9ksfVaXnFVRZTz1UWY9dVBUfuqgq3C+jqnDXQVX+to2q3M0SqnLXLVRlr1qoylw2UZW5WERV+ryBqtRZHVWp0xqqkicOqsxjB1XmURVVicMKquIHZVTF9m1UxfZKqIrullAV2bFQFdkuoiq8VUBVaDOPqtBGDlXBaRZVgUkWVYFxBlX+URpVxjCFKmOQRNVC30SVr2eiytdNoGq+E0eVtx1DlbcVRdVcM4IqTyOMKk89jKpZJ4QqdzWIKnc5gKoZ248ql2WgylU0UP8BAG7sx3NHan0AAAAASUVORK5CYII=',
});

const NOW = '2026-09-22T00:00:00.000Z';

/**
 * @returns {import('../src/domain/model/plugin-settings.js').PluginSettings}
 */
export function fixtureSettings(patch = {}) {
    return {
        ...defaultPluginSettings(),
        activeArtistId: IDS.artist,
        activeNaiConfigId: IDS.nai,
        recallLlmConfigId: IDS.llm,
        promptGenLlmConfigId: IDS.llm,
        activeImagegenPresetId: null,
        activeRecallPresetId: null,
        contextWindowSize: 5,
        autoWriteSlots: false,
        autoRenderSlots: false,
        ...patch,
    };
}

/**
 * 空配置起步（D58）：清空所有当前选择。
 * @returns {import('../src/domain/model/plugin-settings.js').PluginSettings}
 */
export function emptySettings() {
    return fixtureSettings({
        activeArtistId: null,
        activeNaiConfigId: null,
        recallLlmConfigId: null,
        promptGenLlmConfigId: null,
        activeImagegenPresetId: null,
        activeRecallPresetId: null,
    });
}

/**
 * 供 createMemoryIdb(seed) 的初始行。
 * @returns {Record<string, object[]>}
 */
export function fixtureIdbSeed() {
    return {
        character_groups: [
            {
                schemaVersion: 1,
                id: IDS.group,
                name: '示例角色组',
                active: true,
                order: 0,
                createdAt: NOW,
                updatedAt: NOW,
            },
        ],
        characters: [
            {
                schemaVersion: 1,
                id: IDS.charAlice,
                groupId: IDS.group,
                name: 'Alice',
                keywords: ['Alice', '爱丽丝'],
                fixedFeatures: '1girl, long silver hair, blue eyes, white dress',
                variableFeatures: [
                    { name: '日常服饰', prompt: 'white summer dress, lace ribbon' },
                ],
                matchOverrides: null,
                createdAt: NOW,
                updatedAt: NOW,
            },
            {
                schemaVersion: 1,
                id: IDS.charBob,
                groupId: IDS.group,
                name: 'Bob',
                keywords: ['Bob'],
                fixedFeatures: '1boy, short brown hair, green jacket',
                variableFeatures: [],
                matchOverrides: null,
                createdAt: NOW,
                updatedAt: NOW,
            },
        ],
        tag_libraries: [
            {
                schemaVersion: 1,
                id: IDS.tagLib,
                name: '场景构图',
                active: true,
                kind: 'composition',
                createdAt: NOW,
                updatedAt: NOW,
            },
            {
                schemaVersion: 1,
                id: IDS.tagLibFeature,
                name: '外貌特征',
                active: true,
                kind: 'feature',
                createdAt: NOW,
                updatedAt: NOW,
            },
        ],
        tag_entries: [
            {
                schemaVersion: 1,
                id: IDS.tagGarden,
                libraryId: IDS.tagLib,
                key: '背景：花园',
                value: 'flower garden, roses, greenery',
                createdAt: NOW,
                updatedAt: NOW,
            },
            {
                schemaVersion: 1,
                id: IDS.tagSoftLight,
                libraryId: IDS.tagLib,
                key: '镜头：柔光',
                value: 'soft lighting, afternoon glow',
                createdAt: NOW,
                updatedAt: NOW,
            },
            {
                schemaVersion: 1,
                id: IDS.tagFake,
                libraryId: IDS.tagLib,
                key: '背景：未使用场景',
                value: 'should not appear unless recalled',
                createdAt: NOW,
                updatedAt: NOW,
            },
            {
                schemaVersion: 1,
                id: IDS.tagHair,
                libraryId: IDS.tagLibFeature,
                key: 'Alice,银发',
                value: 'long silver hair, blue eyes',
                createdAt: NOW,
                updatedAt: NOW,
            },
        ],
        artists: [
            {
                schemaVersion: 1,
                id: IDS.artist,
                name: '示例画师串',
                sequence: 0,
                positivePrompt: 'artist:example_artist, year 2024',
                negativePrompt: 'lowres, blurry',
                // 预览沙箱：data:image/png（过 D51）；list 会 normalize
                referenceImageRef: COVER_PNG.rose,
                cardImageRef: COVER_PNG.rose,
                createdAt: NOW,
                updatedAt: NOW,
            },
            {
                schemaVersion: 1,
                id: IDS.artist2,
                name: '冷色线稿串',
                sequence: 1,
                positivePrompt: 'artist:cool_lineart, year 2023',
                negativePrompt: 'lowres, jpeg artifacts',
                referenceImageRef: COVER_PNG.blue,
                cardImageRef: COVER_PNG.blue,
                createdAt: NOW,
                updatedAt: NOW,
            },
            {
                schemaVersion: 1,
                id: IDS.artist3,
                name: '柔光水彩串',
                sequence: 2,
                positivePrompt: 'artist:soft_watercolor, year 2025',
                negativePrompt: 'lowres, harsh shadows',
                referenceImageRef: COVER_PNG.green,
                cardImageRef: COVER_PNG.green,
                createdAt: NOW,
                updatedAt: NOW,
            },
        ],
        llm_configs: [
            {
                schemaVersion: 1,
                id: IDS.llm,
                name: '默认 LLM',
                // 预览沙箱占位：真实种子为空，此处填满以便请求进入预览网关
                baseUrl: 'https://preview.local/llm/v1',
                secretId: 'preview-llm-secret',
                model: 'preview-model',
                createdAt: NOW,
                updatedAt: NOW,
            },
        ],
        nai_configs: [
            {
                schemaVersion: 1,
                id: IDS.nai,
                name: '默认 NAI',
                baseUrl: DEFAULT_NAI_BASE_URL,
                apiKey: 'preview-key-nai',
                transport: 'direct',
                decoder: 'auto',
                createdAt: NOW,
                updatedAt: NOW,
            },
        ],
    };
}

/**
 * 预览用像样的 NAI V4 结构化 caption（构图/镜头/光照/场景 + 角色分镜）。
 * @param {{ aliceCenters?: {x:number,y:number}, bobCenters?: {x:number,y:number}|null, includeBob?: boolean }} [opts]
 * @returns {object}
 */
export function makeRichGardenCaption(opts = {}) {
    const aliceCenters = opts.aliceCenters ?? [{ x: 0.42, y: 0.58 }];
    const includeBob = opts.includeBob !== false;
    const bobCenters = opts.bobCenters === null
        ? null
        : (opts.bobCenters ?? [{ x: 0.78, y: 0.52 }]);

    /** @type {object[]} */
    const charCaptions = [
        {
            char_caption: [
                '1girl',
                'alice',
                'long silver hair',
                'straight bangs',
                'blue eyes',
                'fair skin',
                'white summer dress',
                'lace ribbon',
                'standing beside fountain',
                'fingertips touching water surface',
                'gentle smile',
                'looking down at water',
                'relaxed posture',
            ].join(', '),
            centers: aliceCenters,
        },
    ];
    if (includeBob && bobCenters) {
        charCaptions.push({
            char_caption: [
                '1boy',
                'bob',
                'short brown hair',
                'green eyes',
                'green jacket',
                'standing in background',
                'waving hand',
                'calling out',
                'soft smile',
            ].join(', '),
            centers: bobCenters,
        });
    }

    /** @type {object[]} */
    const negChars = charCaptions.map((c) => ({
        char_caption: 'bad anatomy, bad hands, extra fingers, deformed face',
        centers: c.centers,
    }));

    return {
        v4_prompt: {
            caption: {
                base_caption: [
                    'wide shot',
                    'eye-level view',
                    'soft afternoon sunlight',
                    'dappled light through leaves',
                    'warm color grading',
                    'shallow depth of field',
                    'flower garden',
                    'rose bushes',
                    'stone path',
                    'ornate fountain',
                    'rippling water',
                    'greenery',
                    'detailed background',
                ].join(', '),
                char_captions: charCaptions,
            },
        },
        v4_negative_prompt: {
            caption: {
                // 不含 lowres/blurry：预览默认画师串负向已带这两项，避免装配后重复
                base_caption: [
                    'worst quality',
                    'jpeg artifacts',
                    'text',
                    'watermark',
                    'logo',
                    'cropped',
                    'out of frame',
                    'ugly',
                    'deformed',
                ].join(', '),
                char_captions: negChars,
            },
        },
    };
}

/**
 * 假聊天楼层（messageId = 数组下标语义，由 fake-host 维护）。
 * 楼 2 已含 slot token，可直接点「生图」看四态。
 * @returns {import('../src/ports/host.port.js').HostMessage[]}
 */
export function fixtureMessages() {
    // 成年原创角色。动作对准构图库：趴在床上从后面插入、手抓着腰、回头看。
    return [
        {
            messageId: 0,
            name: 'User',
            text: '写一段二十八岁的林澄和三十岁的周岚在旅馆房间里的场面。她趴在床上，他从后面抓着她的腰插入，她回头看他。两个人都是成年人，从头到脚都在画面里。',
            isUser: true,
            isSystem: false,
            extra: {},
        },
        {
            messageId: 1,
            name: 'Narrator',
            text: [
                '旅馆走廊的灯是黄的。林澄二十八岁，黑色齐肩发，灰眼睛，推开最里面那间房的时候，周岚已经站在床尾。周岚三十岁，短棕发，衬衫袖子卷到肘上，鞋踢在地毯边。',
                '房间不大。双人床的被子被掀到一边，白床单皱着。床头灯只开了一盏，光落在枕头和林澄解开的外套上。窗外是夜，窗帘拉了一半，城市的灯只剩一条缝。',
                '两个人都是成年人。林澄把房门反锁，锁舌响了一下。她看着床，又看周岚，没有再往门口退。',
            ].join('\n\n'),
            isUser: false,
            isSystem: false,
            extra: {},
        },
        {
            messageId: 2,
            name: 'Narrator',
            text: [
                '林澄把连衣裙的肩带褪到臂弯，布料堆在腰上，然后膝行上床。她没有躺平。她趴下去，胸口贴着枕头，肚子贴着床单，膝盖分开，把腰塌下去，屁股抬起来对着床尾的周岚。黑发从肩上滑到枕面上，灰眼睛先看着枕头，没有回头。',
                '周岚跪上床，膝头陷进她两条小腿之间。他的双手扣住她的腰，拇指压在腰窝两边，把她固定在这个姿势上。衬衫下摆扫过她的后腰。他没有先吻她。他从后面抵住她，阴茎顶开她，插进去。',
                '<IMG>',
                '1',
                '</IMG>',
                '林澄的手指揪紧枕套。她吸了一口气，肩膀耸起来，又慢慢放下。周岚的手没有离开她的腰。',
            ].join('\n\n'),
            isUser: false,
            isSystem: false,
            extra: {},
        },
        {
            messageId: 3,
            name: 'Narrator',
            text: [
                '林澄趴在旅馆的双人床上。胸口和脸侧压着枕头，黑发铺在白色枕套上，灰眼睛睁着。连衣裙的布料卷到腰以上，后背露到肩胛，膝盖分开跪在床单上，腰往下塌，屁股抬高，对着跪在她身后的周岚。',
                '周岚跪在她两条小腿之间。他的双手抓着她的腰，十指扣紧腰侧，把她按在这个姿势上，不让她往前爬。他从后面插入她，阴茎整根顶进去，小腹一下一下撞在她抬起的屁股上。衬衫还穿在身上，下摆被汗贴在他小腹。',
                '林澄被顶得往前蹭了一寸，手指揪住枕套。她没有把脸埋死。她侧过脖子，回头看他。灰眼睛从肩膀上方看过来，嘴唇张开，耳尖红着，视线落在周岚抓着她腰的那双手上，也落在他的脸上。',
                '周岚看见她回头，手上更紧，拇指几乎陷进她腰窝。他没有把她翻过来，仍然从后面插入，每一下都抓着同一处腰。床头灯的光打在她的后背、他的手指、和两个人交合的地方。窗帘外面的夜色停在窗缝里，房间里没有第三个人。',
                '「看着我。」周岚说。林澄的回答断在下一次顶入里，可她的脸一直转着，灰眼睛没有再转回枕头。',
            ].join('\n\n'),
            isUser: false,
            isSystem: false,
            extra: {},
        },
    ];
}

/**
 * 默认世界书文本。
 * @returns {string}
 */
export function fixtureWorldInfo() {
    return '旅馆房间，夜里，床头灯。在场的是两个成年人：二十八岁的林澄，黑色齐肩发、灰眼睛；三十岁的周岚，短棕发。林澄趴在双人床上，腰塌下、屁股抬起。周岚跪在她身后，双手抓着她的腰，从后面插入。她回头看他。没有第三个人。';
}

/**
 * 从正文取一句作假 LLM「生成点」。
 * @param {string} text
 * @returns {string}
 */
export function pickAnchorFromText(text) {
    const clean = String(text || '')
        .replace(/<IMG>\s*\d+\s*<\/IMG>/gi, '')
        .trim();
    const lines = clean.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    return lines[0] || '场景开始。';
}

/**
 * 从渲染后的生图预设消息里解析「构图标签」段的 slotid 列表（跟随召回分配，不得写死）。
 * @param {string} messagesText
 * @returns {number[]}
 */
export function parseSlotIdsFromPromptMessages(messagesText) {
    const text = String(messagesText || '');
    const sectionMatch = text.match(/【构图标签】\s*([\s\S]*?)(?=\n【|$)/);
    const haystack = sectionMatch ? sectionMatch[1] : text;
    /** @type {number[]} */
    const ids = [];
    const re = /(?:^|\n)\s*slotid\s*[:：]\s*(\d+)/gi;
    let m;
    while ((m = re.exec(haystack)) !== null) {
        const n = Number(m[1]);
        if (Number.isInteger(n) && n >= 1 && !ids.includes(n)) {
            ids.push(n);
        }
    }
    return ids;
}

/**
 * 从召回预设消息里解析「候选 key」列表。
 * @param {string} messagesText
 * @returns {string[]}
 */
export function parseCandidateKeysFromMessages(messagesText) {
    const text = String(messagesText || '');
    const sectionMatch = text.match(/【候选 key】\s*([\s\S]*?)(?=\n【|$)/);
    if (!sectionMatch) {
        return [];
    }
    return sectionMatch[1]
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
}

/** 假写提示词按 slot 轮换的尺寸（竖 / 方 / 横） */
export const PREVIEW_SLOT_SIZES = Object.freeze(['832x1216', '1024x1024', '1216x832']);

/**
 * 假 LLM「解析」①~⑦ 文案（演示用，够像样即可）。
 * @param {string} anchorSentence
 * @param {number} slotid
 * @param {string} size
 * @returns {string}
 */
export function makeFakeAnalysisText(anchorSentence, slotid, size) {
    const anchor = String(anchorSentence || '场景开始。').slice(0, 80);
    return [
        `①画面主题：围绕「${anchor}」锁定可视觉化关键要素，slotid=${slotid}。`,
        '②锚点：L0·爱丽丝＝外貌＋着装；L1·花园＝环境[花径/石椅]＋光影[柔光]。',
        '③分级：Safe 级。',
        '④分层构图：中景=角色，背景=花园纵深。',
        `⑤镜头：第三人称→中景→正侧 3/4；尺寸选 ${size}。`,
        '⑥可见性清理：脚出框则移除鞋/脚相关标签。',
        '⑦自检：计数/景别/UC 与画面互斥项已对齐。',
    ].join('\n');
}

/**
 * 构造假提示词 LLM 的 slot 计划 JSON。
 * slotid 必须与召回写入构图标签的编号一致（会话内递增，不得写死 1）。
 * 每项含契约字段：slotid、生图内容、尺寸、解析。
 * @param {string} anchorSentence
 * @param {number[]} slotIds
 * @returns {object[]}
 */
export function makeSlotPlanJson(anchorSentence, slotIds) {
    const ids = Array.isArray(slotIds)
        ? slotIds.filter((n) => Number.isInteger(n) && n >= 1)
        : [];
    return ids.map((slotid, i) => {
        const size = PREVIEW_SLOT_SIZES[i % PREVIEW_SLOT_SIZES.length];
        return {
            slotid,
            size,
            analysis: makeFakeAnalysisText(anchorSentence, slotid, size),
            caption: makeRichGardenCaption({
                aliceCenters: [{ x: 0.48 + i * 0.02, y: 0.6 }],
                bobCenters: [{ x: 0.82, y: 0.48 }],
                includeBob: i === 0,
            }),
        };
    });
}

/**
 * 构造假召回 LLM 的位置数组（需求 4.11）。
 * @param {string} anchorSentence
 * @param {string[]} [keys]
 * @returns {object[]}
 */
export function makeRecallPositionsJson(anchorSentence, keys = []) {
    const keyList = Array.isArray(keys) ? keys.filter((k) => typeof k === 'string' && k) : [];
    return [
        {
            anchor: anchorSentence,
            key: keyList,
        },
    ];
}

/**
 * 工作台写提示词返回的 caption。
 * @returns {object}
 */
export function makeWorkbenchCaptionJson() {
    return makeRichGardenCaption({
        includeBob: false,
        aliceCenters: [{ x: 0.5, y: 0.55 }],
    });
}
