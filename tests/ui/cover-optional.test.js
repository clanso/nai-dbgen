import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom } from './fake-dom.js';
import { mountCurrentPicker } from '../../src/ui/common/current-picker.js';
import { createStyleCard } from '../../src/ui/common/library-chrome.js';

/**
 * @param {object} root
 * @param {string} className
 * @returns {object|null}
 */
function findByClass(root, className) {
    if (!root) return null;
    if (String(root.className || '').split(/\s+/).includes(className)) return root;
    for (const child of root.childNodes || []) {
        const hit = findByClass(child, className);
        if (hit) return hit;
    }
    return null;
}

/**
 * @param {object} root
 * @param {string} tagName
 * @returns {object|null}
 */
function findByTag(root, tagName) {
    if (!root) return null;
    if (String(root.tagName || '').toUpperCase() === tagName.toUpperCase()) return root;
    for (const child of root.childNodes || []) {
        const hit = findByTag(child, tagName);
        if (hit) return hit;
    }
    return null;
}

describe('optional cover for picker / library cards', () => {
    /** @type {ReturnType<typeof installFakeDom>|null} */
    let fake = null;

    beforeEach(() => {
        fake = installFakeDom();
    });

    afterEach(() => {
        fake?.restore();
        fake = null;
    });

    it('cover:false picker does not create cover or mini-cover nodes', async () => {
        const root = document.createElement('div');
        document.body.appendChild(root);

        const api = mountCurrentPicker(root, {
            cover: false,
            list: async () => [
                { id: 'n1', name: 'NAI Config' },
                { id: 'n2', name: 'Other' },
            ],
            getActiveId: () => 'n1',
            setActiveId: () => {},
        });
        await api.refresh();

        assert.equal(findByClass(root, 'nd-picker__cover'), null);
        assert.equal(findByClass(root, 'nd-mini-cover'), null);
        assert.ok(findByClass(root, 'nd-picker__control--no-cover'));

        const input = findByTag(root, 'INPUT');
        assert.ok(input);
        // fake-dom 无 dispatchEvent；直接调 focus 监听打开结果面板
        for (const l of input._listeners || []) {
            if (l.type === 'focus') l.fn();
        }
        assert.equal(findByClass(root, 'nd-mini-cover'), null);
        assert.ok(findByClass(root, 'nd-picker-option--no-cover'));

        api.destroy();
    });

    it('cover:true with empty image keeps placeholder monogram', async () => {
        const root = document.createElement('div');
        document.body.appendChild(root);

        const api = mountCurrentPicker(root, {
            cover: true,
            list: async () => [{ id: 'a1', name: 'Artist Alpha' }],
            getActiveId: () => 'a1',
            setActiveId: () => {},
        });
        await api.refresh();

        const cover = findByClass(root, 'nd-picker__cover');
        assert.ok(cover);
        assert.ok(String(cover.className).includes('nd-cover--empty'));
        const mark = findByClass(cover, 'nd-cover-empty-mark');
        assert.ok(mark);
        assert.equal(String(mark.textContent || '').trim(), '');
        assert.equal(findByTag(cover, 'IMG'), null);

        api.destroy();
    });

    it('cover:true + resolveCover paints real image on control cover', async () => {
        const root = document.createElement('div');
        document.body.appendChild(root);

        /** @type {string[]} */
        const resolved = [];
        const api = mountCurrentPicker(root, {
            cover: true,
            list: async () => [
                { id: 'a1', name: 'Artist With Art', cardImageRef: 'img-card-9' },
            ],
            getActiveId: () => 'a1',
            setActiveId: () => {},
            resolveCover: async (item) => {
                resolved.push(String(item?.cardImageRef ?? ''));
                return 'https://cdn.example/artist.png';
            },
        });
        // boot refresh 已跑；等 resolveCover 微任务落盘
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        assert.ok(resolved.includes('img-card-9'));
        const cover = findByClass(root, 'nd-picker__cover');
        assert.ok(cover);
        const img = findByTag(cover, 'IMG');
        assert.ok(img);
        assert.equal(img.src, 'https://cdn.example/artist.png');
        assert.equal(findByClass(cover, 'nd-cover-empty-mark'), null);
        assert.equal(findByClass(cover, 'nd-cover-monogram'), null);

        api.destroy();
    });

    it('library card cover:false omits cover; cover:true without url keeps empty placeholder', () => {
        const noCover = createStyleCard({
            title: 'LLM cfg',
            subtitle: 'gpt',
            cover: false,
        });
        assert.equal(findByClass(noCover.el, 'nd-style-card__cover'), null);
        assert.ok(String(noCover.el.className).includes('nd-style-card--no-cover'));
        noCover.destroy();

        const withCoverWanted = createStyleCard({
            title: '画师串',
            cover: true,
        });
        const emptyCover = findByClass(withCoverWanted.el, 'nd-style-card__cover');
        assert.ok(emptyCover);
        assert.ok(String(emptyCover.className).includes('nd-style-card__cover--empty'));
        assert.equal(findByClass(emptyCover, 'nd-style-card__cover-empty')?.textContent, '无示例图');
        assert.ok(!String(withCoverWanted.el.className).includes('nd-style-card--no-cover'));
        withCoverWanted.destroy();

        const withUrl = createStyleCard({
            title: '画师串',
            cover: true,
            coverUrl: 'https://cdn.example/card.webp',
        });
        assert.ok(findByClass(withUrl.el, 'nd-style-card__cover'));
        assert.ok(findByTag(withUrl.el, 'IMG'));
        withUrl.destroy();
    });
});
