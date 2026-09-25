/**
 * L2 适配器 · Preset 仓库。
 * 归属：W1-D 存储代理实现。W0 仅冻结签名。
 */

import { IDB_STORES } from '../idb.js';
import { createEntityRepo } from '../entity-repo.js';
import {
    PRESET_SCHEMA_VERSION,
    validatePreset,
} from '../../../domain/model/preset.js';

/**
 * @param {{ db: object, bus?: object }} deps
 * @returns {import('../../../ports/repository.port.js').Repository<any>}
 */
export function createPresetRepo(deps) {
    return createEntityRepo({
        db: deps?.db,
        storeName: IDB_STORES.PRESETS,
        kind: 'preset',
        schemaVersion: PRESET_SCHEMA_VERSION,
        validate: validatePreset,
        idPrefix: 'pr',
    });
}
