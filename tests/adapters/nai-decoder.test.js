/**
 * W1-C · zip / json-base64 解码自测（不联网）
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeZip } from '../../src/adapters/nai/decoder/zip.js';
import { decodeJsonBase64 } from '../../src/adapters/nai/decoder/json-base64.js';
import { isOk, isErr } from '../../src/infra/result.js';
import { ERROR_CATEGORY } from '../../src/infra/errors.js';

describe('decodeZip', () => {
    it('reads stored (method 0) zip entry', async () => {
        const png = makePngBytes();
        const zip = makeStoredZip([{ name: 'image_0.png', data: png }]);
        const result = await decodeZip({ status: 201, headers: {}, body: zip });
        assert.equal(isOk(result), true);
        assert.equal(result.value.length, 1);
        assert.equal(result.value[0].mimeType, 'image/png');
        assert.ok(result.value[0].blob instanceof Blob);
    });

    it('accepts raw PNG without zip wrapper', async () => {
        const png = makePngBytes();
        const result = await decodeZip({ status: 201, headers: {}, body: png });
        assert.equal(isOk(result), true);
        assert.equal(result.value[0].mimeType, 'image/png');
    });

    it('returns ContractError for unsupported compression method', async () => {
        const png = makePngBytes();
        // method 99 in central + local
        const zip = makeZipWithMethod([{ name: 'x.png', data: png }], 99);
        const result = await decodeZip({ status: 201, headers: {}, body: zip });
        assert.equal(isErr(result), true);
        assert.equal(result.error.category, ERROR_CATEGORY.CONTRACT);
        assert.equal(result.error.code, 'NAI_ZIP_METHOD_UNSUPPORTED');
    });

    it('inflates deflate (method 8) via DecompressionStream when available', async () => {
        if (typeof DecompressionStream !== 'function') {
            return; // Node 旧版本跳过
        }
        const png = makePngBytes();
        const compressed = await deflateRaw(png);
        const zip = makeZipWithMethod([{ name: 'image_0.png', data: compressed }], 8, png.length);
        const result = await decodeZip({ status: 201, headers: {}, body: zip });
        assert.equal(isOk(result), true);
        assert.equal(result.value[0].mimeType, 'image/png');
    });
});

describe('decodeJsonBase64', () => {
    it('decodes official { images:[{ image, seed }] }', async () => {
        const png = makePngBytes();
        const b64 = Buffer.from(png).toString('base64');
        const body = JSON.stringify({
            images: [{ image: b64, index: 0, seed: 42 }],
        });
        const result = await decodeJsonBase64({
            status: 201,
            headers: { 'content-type': 'application/json' },
            body,
        });
        assert.equal(isOk(result), true);
        assert.equal(result.value.length, 1);
        assert.equal(result.value[0].seed, 42);
        assert.equal(result.value[0].mimeType, 'image/png');
    });

    it('decodes bare base64 string array', async () => {
        const png = makePngBytes();
        const b64 = Buffer.from(png).toString('base64');
        const result = await decodeJsonBase64({
            status: 200,
            headers: {},
            body: JSON.stringify([b64]),
        });
        assert.equal(isOk(result), true);
        assert.equal(result.value.length, 1);
    });

    it('ContractError on invalid json', async () => {
        const result = await decodeJsonBase64({
            status: 200,
            headers: {},
            body: 'not-json{{{',
        });
        assert.equal(isErr(result), true);
        assert.equal(result.error.category, ERROR_CATEGORY.CONTRACT);
    });
});

/** 最小合法 PNG（1×1） */
function makePngBytes() {
    return Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
    );
}

function crc32(bytes) {
    let crc = -1;
    for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
    }
    return (crc ^ -1) >>> 0;
}

function u16(value) {
    const b = Buffer.alloc(2);
    b.writeUInt16LE(value, 0);
    return b;
}

function u32(value) {
    const b = Buffer.alloc(4);
    b.writeUInt32LE(value, 0);
    return b;
}

function makeStoredZip(files) {
    return makeZipWithMethod(files, 0);
}

/**
 * @param {Array<{name:string,data:Buffer|Uint8Array}>} files
 * @param {number} method
 * @param {number} [uncompressedSize]
 */
function makeZipWithMethod(files, method, uncompressedSize) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const file of files) {
        const name = Buffer.from(file.name, 'utf8');
        const data = Buffer.from(file.data);
        const crc = crc32(data);
        const usize = uncompressedSize != null ? uncompressedSize : data.length;
        const local = Buffer.concat([
            u32(0x04034b50), u16(20), u16(0), u16(method), u16(0), u16(0),
            u32(crc), u32(data.length), u32(usize), u16(name.length), u16(0),
            name, data,
        ]);
        locals.push(local);
        centrals.push(Buffer.concat([
            u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0), u16(0),
            u32(crc), u32(data.length), u32(usize), u16(name.length), u16(0), u16(0),
            u16(0), u16(0), u32(0), u32(offset), name,
        ]));
        offset += local.length;
    }
    const central = Buffer.concat(centrals);
    const end = Buffer.concat([
        u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
        u32(central.length), u32(offset), u16(0),
    ]);
    return Buffer.concat([...locals, central, end]);
}

async function deflateRaw(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return Buffer.from(await new Response(stream).arrayBuffer());
}
