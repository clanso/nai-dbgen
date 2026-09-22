import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { t, zhCN } from '../../src/ui/i18n/zh-CN.js';

describe('ui/i18n/zh-CN', () => {
    it('returns dictionary value for known key', () => {
        assert.equal(t('app.name'), zhCN['app.name']);
        assert.equal(t('slot.generate'), '生图');
    });

    it('falls back to key when missing', () => {
        assert.equal(t('does.not.exist'), 'does.not.exist');
    });

    it('interpolates params', () => {
        assert.equal(t('import.summary', { count: 3 }), '识别 3 条');
        assert.equal(
            t('import.parseError', { message: 'bad' }),
            '无法解析 JSON：bad',
        );
    });

    it('keeps unknown placeholders', () => {
        assert.equal(t('import.summary', {}), '识别 {count} 条');
    });

    it('dictionary is frozen', () => {
        assert.throws(() => {
            /** @type {any} */ (zhCN)['app.name'] = 'x';
        });
    });
});
