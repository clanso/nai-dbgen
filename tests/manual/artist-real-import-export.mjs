/**
 * 一次性：用内存服务器文件跑真实 216MB 画师串.json 导入→导出往返。
 * 不进 npm test。用法：
 *   node tests/manual/artist-real-import-export.mjs
 */
import { performance } from 'node:perf_hooks';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMemoryIdb } from '../../src/adapters/storage/memory-idb.js';
import { createMemoryServerFiles } from '../../src/adapters/storage/memory-server-files.js';
import { createArtistRepo } from '../../src/adapters/storage/repos/artist.repo.js';
import { IDB_STORES } from '../../src/adapters/storage/idb.js';
import { ARTIST_EXPORT_FIELD_ORDER } from '../../src/adapters/storage/artist-io.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REAL = join(
    __dirname,
    '../../../ref/画师串、标签库等/画师串.json',
);

function peakRssMb() {
    return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

function fiveFields(row) {
    return {
        name: row.name,
        sequence: row.sequence,
        positivePrompt: row.positivePrompt,
        negativePrompt: row.negativePrompt,
        referenceImage: row.referenceImage ?? null,
    };
}

async function main() {
    const t0 = performance.now();
    console.log('loading', REAL);
    const rawText = readFileSync(REAL, 'utf8');
    const tLoad = performance.now();
    console.log(`read file ${(tLoad - t0).toFixed(0)}ms rss=${peakRssMb()}MB`);

    const source = JSON.parse(rawText);
    const tParse = performance.now();
    console.log(`parse JSON ${(tParse - tLoad).toFixed(0)}ms count=${source.length} rss=${peakRssMb()}MB`);

    const serverFiles = createMemoryServerFiles();
    const db = createMemoryIdb({ [IDB_STORES.ARTISTS]: [] });
    let n = 0;
    const repo = createArtistRepo({
        db,
        serverFiles,
        nowIso: () => new Date().toISOString(),
        newId: () => `ar-real-${n++}`,
        makeCardImage: async () => new Blob([Uint8Array.from([1])], { type: 'image/webp' }),
    });

    const tImp0 = performance.now();
    const imp = await repo.importJson(source, {
        strategy: 'skip',
        onProgress: (p) => {
            if (p.index === 1 || p.index === p.total || p.index % 10 === 0) {
                console.log(`  import ${p.index}/${p.total} ${p.name}`);
            }
        },
    });
    const tImp1 = performance.now();
    if (!imp.ok) {
        console.error('import failed', imp.error);
        process.exit(1);
    }
    console.log(
        `import done ${(tImp1 - tImp0).toFixed(0)}ms imported=${imp.value.imported} `
        + `skipped=${imp.value.skipped} errors=${imp.value.errors.length} rss=${peakRssMb()}MB`,
    );
    if (imp.value.errors.length) {
        console.error('errors sample', imp.value.errors.slice(0, 5));
    }

    const list = await repo.list();
    console.log(`list count=${list.value.length}`);

    const tExp0 = performance.now();
    const exp = await repo.exportJson({
        onProgress: (p) => {
            if (p.index === 1 || p.index === p.total || p.index % 10 === 0) {
                console.log(`  export ${p.index}/${p.total} ${p.name}`);
            }
        },
    });
    const tExp1 = performance.now();
    if (!exp.ok) {
        console.error('export failed', exp.error);
        process.exit(1);
    }
    console.log(`export done ${(tExp1 - tExp0).toFixed(0)}ms rows=${exp.value.length} rss=${peakRssMb()}MB`);

    if (exp.value.length !== source.length) {
        console.error(`count mismatch: source=${source.length} export=${exp.value.length}`);
        process.exit(1);
    }

    const srcByName = new Map(source.map((r) => [r.name, fiveFields(r)]));
    let mismatch = 0;
    for (const row of exp.value) {
        const keys = Object.keys(row);
        if (JSON.stringify(keys) !== JSON.stringify([...ARTIST_EXPORT_FIELD_ORDER])) {
            console.error('bad key order', row.name, keys);
            mismatch += 1;
            continue;
        }
        const src = srcByName.get(row.name);
        if (!src) {
            console.error('missing source', row.name);
            mismatch += 1;
            continue;
        }
        for (const k of ARTIST_EXPORT_FIELD_ORDER) {
            if (row[k] !== src[k]) {
                console.error(`field mismatch ${row.name}.${k}`);
                mismatch += 1;
                break;
            }
        }
        // 多余字段不得出现
        for (const k of Object.keys(row)) {
            if (!ARTIST_EXPORT_FIELD_ORDER.includes(k)) {
                console.error(`extra field ${row.name}.${k}`);
                mismatch += 1;
            }
        }
    }

    const totalMs = performance.now() - t0;
    console.log(
        JSON.stringify({
            ok: mismatch === 0 && imp.value.imported === source.length,
            sourceCount: source.length,
            imported: imp.value.imported,
            exported: exp.value.length,
            fieldMismatches: mismatch,
            importErrors: imp.value.errors.length,
            totalMs: Math.round(totalMs),
            importMs: Math.round(tImp1 - tImp0),
            exportMs: Math.round(tExp1 - tExp0),
            peakRssMb: peakRssMb(),
        }, null, 2),
    );
    process.exit(mismatch === 0 && imp.value.imported === source.length ? 0 : 1);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
