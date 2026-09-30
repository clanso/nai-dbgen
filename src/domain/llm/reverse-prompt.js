/**
 * 反推：在现有写提示词消息上附一张参考图。
 * 自然语言仍由生图预设里的 {{用户描述}} 带上。这里不另写一套提示词，也不出图。
 */

/**
 * @param {import('../../ports/llm.port.js').ChatMessage[]|undefined} messages
 * @param {unknown} imageDataUrl
 * @returns {import('../../ports/llm.port.js').ChatMessage[]}
 */
export function attachReferenceImage(messages, imageDataUrl) {
    const url = String(imageDataUrl ?? '');
    const list = Array.isArray(messages) ? messages.map((message) => ({ ...message })) : [];
    if (!url.startsWith('data:image/')) {
        return list;
    }
    const note = '附图是参考图。请根据这张图和自然语言，按原来的格式写出一份生图提示词。';
    const imagePart = { type: 'image_url', image_url: { url } };
    let index = -1;
    for (let i = list.length - 1; i >= 0; i -= 1) {
        if (list[i]?.role === 'user') {
            index = i;
            break;
        }
    }
    if (index < 0) {
        list.push({
            role: 'user',
            content: [
                { type: 'text', text: note },
                imagePart,
            ],
        });
        return list;
    }
    const current = list[index].content;
    const text = typeof current === 'string'
        ? current
        : Array.isArray(current)
            ? current.filter((part) => part?.type === 'text').map((part) => String(part.text ?? '')).join('\n')
            : '';
    list[index] = {
        ...list[index],
        content: [
            { type: 'text', text: text ? `${text}\n\n${note}` : note },
            imagePart,
        ],
    };
    return list;
}
