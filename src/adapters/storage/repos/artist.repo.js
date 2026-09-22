/**
 * L2 适配器 · ArtistString 仓库。
 * 归属：W1-D 存储代理实现。W0 仅冻结签名。
 */

import { IDB_STORES } from '../idb.js';
import { createEntityRepo } from '../entity-repo.js';
import {
    ARTIST_SCHEMA_VERSION,
    migrateArtist,
    validateArtist,
} from '../../../domain/model/artist.js';

/**
 * @param {{ db: object, bus?: object, messageExtra?: object }} deps
 * @returns {import('../../../ports/repository.port.js').Repository<any>|import('../../../ports/repository.port.js').SlotRepository}
 */
export function createArtistRepo(deps) {
    return createEntityRepo({
        db: deps?.db,
        storeName: IDB_STORES.ARTISTS,
        kind: 'artist',
        schemaVersion: ARTIST_SCHEMA_VERSION,
        validate: validateArtist,
        migrate: migrateArtist,
        idPrefix: 'ar',
    });
}
