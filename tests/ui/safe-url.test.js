import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { safeImageUrl, paintSafeCover, coverInitial } from '../../src/ui/common/safe-url.js';
import { installFakeDom } from './fake-dom.js';

describe('ui/common/safeImageUrl (D24)', () => {
    it('allows http / https / blob / data:image', () => {
        assert.equal(
            safeImageUrl('https://example.com/a.png'),
            'https://example.com/a.png',
        );
        assert.equal(
            safeImageUrl('http://example.com/a.png'),
            'http://example.com/a.png',
        );
        assert.equal(
            safeImageUrl('blob:https://example.com/uuid-1'),
            'blob:https://example.com/uuid-1',
        );
        assert.ok(safeImageUrl('data:image/png;base64,aaaa'));
        assert.ok(safeImageUrl('data:image/svg+xml,<svg></svg>'));
    });

    it('rejects javascript: (incl. case / whitespace bypass)', () => {
        assert.equal(safeImageUrl('javascript:alert(1)'), null);
        assert.equal(safeImageUrl('JAVASCRIPT:alert(1)'), null);
        assert.equal(safeImageUrl('  javascript:alert(1)'), null);
        assert.equal(safeImageUrl('\tJavaScript:alert(1)'), null);
    });

    it('rejects data:text/html and other non-image data', () => {
        assert.equal(safeImageUrl('data:text/html,<script>alert(1)</script>'), null);
        assert.equal(safeImageUrl('data:application/json,{}'), null);
        assert.equal(safeImageUrl('DATA:TEXT/HTML,x'), null);
    });

    it('rejects empty / whitespace-only', () => {
        assert.equal(safeImageUrl(''), null);
        assert.equal(safeImageUrl('   '), null);
        assert.equal(safeImageUrl(null), null);
        assert.equal(safeImageUrl(undefined), null);
    });

    it('rejects relative paths and protocol-relative URLs', () => {
        assert.equal(safeImageUrl('/uploads/a.png'), null);
        assert.equal(safeImageUrl('uploads/a.png'), null);
        assert.equal(safeImageUrl('//evil.test/x.png'), null);
    });

    it('rejects vbscript / file / about', () => {
        assert.equal(safeImageUrl('vbscript:msgbox(1)'), null);
        assert.equal(safeImageUrl('file:///etc/passwd'), null);
        assert.equal(safeImageUrl('about:blank'), null);
    });

    it('allows DATA:IMAGE uppercase scheme/mime', () => {
        assert.ok(safeImageUrl('DATA:IMAGE/JPEG;BASE64,xx'));
    });

    it('paintSafeCover falls back to initial when rejected', () => {
        const fake = installFakeDom();
        try {
            const el = document.createElement('div');
            const ok = paintSafeCover(el, 'javascript:evil', 'Alice');
            assert.equal(ok, false);
            assert.equal(el.textContent, 'A');
            assert.equal(el.childNodes.length, 0);

            const ok2 = paintSafeCover(el, 'https://cdn.example/x.png', 'Bob');
            assert.equal(ok2, true);
            assert.equal(el.childNodes.length, 1);
            assert.equal(el.childNodes[0].tagName, 'IMG');
            assert.equal(el.childNodes[0].src, 'https://cdn.example/x.png');
        } finally {
            fake.restore();
        }
    });

    it('coverInitial handles empty', () => {
        assert.equal(coverInitial(''), '?');
        assert.equal(coverInitial('  zed'), 'Z');
    });
});
