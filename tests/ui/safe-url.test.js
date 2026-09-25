import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { safeImageUrl, paintSafeCover } from '../../src/ui/common/safe-url.js';
import { installFakeDom } from './fake-dom.js';

describe('ui/common/safeImageUrl (D24)', () => {
    it('allows http / https / blob / raster data:image', () => {
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
        assert.ok(safeImageUrl('data:image/jpeg;base64,aaaa'));
        assert.ok(safeImageUrl('data:image/webp;base64,aaaa'));
        assert.ok(safeImageUrl('data:image/gif;base64,aaaa'));
    });

    it('rejects data:image/svg+xml (D51)', () => {
        assert.equal(safeImageUrl('data:image/svg+xml,<svg></svg>'), null);
        assert.equal(safeImageUrl('DATA:IMAGE/SVG+XML,<svg></svg>'), null);
        assert.equal(
            safeImageUrl('data:image/svg+xml;base64,PHN2Zy8+'),
            null,
        );
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

    it('allows same-origin /user/files/nai-dbgen_* (artist preview config)', () => {
        assert.equal(
            safeImageUrl('/user/files/nai-dbgen_artist-preview_a__deadbeef.png'),
            '/user/files/nai-dbgen_artist-preview_a__deadbeef.png',
        );
        assert.ok(safeImageUrl('/user/files/nai-dbgen_artists.json?t=1'));
        assert.equal(safeImageUrl('/user/files/other.png'), null);
        assert.equal(safeImageUrl('/user/files/nai-dbgen_a b.png'), null);
    });

    it('rejects vbscript / file / about', () => {
        assert.equal(safeImageUrl('vbscript:msgbox(1)'), null);
        assert.equal(safeImageUrl('file:///etc/passwd'), null);
        assert.equal(safeImageUrl('about:blank'), null);
    });

    it('allows DATA:IMAGE uppercase scheme/mime', () => {
        assert.ok(safeImageUrl('DATA:IMAGE/JPEG;BASE64,xx'));
    });

    it('paintSafeCover falls back to empty mark when rejected', () => {
        const fake = installFakeDom();
        try {
            const el = document.createElement('div');
            const ok = paintSafeCover(el, 'javascript:evil', 'Alice');
            assert.equal(ok, false);
            assert.ok(String(el.className).includes('nd-cover--empty'));
            assert.equal(el.childNodes.length, 1);
            assert.equal(el.childNodes[0].tagName, 'SPAN');
            assert.equal(el.childNodes[0].className, 'nd-cover-empty-mark');
            assert.equal(String(el.childNodes[0].textContent || '').trim(), '');

            const ok2 = paintSafeCover(el, 'https://cdn.example/x.png', 'Bob');
            assert.equal(ok2, true);
            assert.equal(String(el.className).includes('nd-cover--empty'), false);
            assert.equal(el.childNodes.length, 1);
            assert.equal(el.childNodes[0].tagName, 'IMG');
            assert.equal(el.childNodes[0].src, 'https://cdn.example/x.png');
        } finally {
            fake.restore();
        }
    });
});
