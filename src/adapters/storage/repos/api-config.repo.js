/**
 * L2 适配器 · LLM API 配置仓库与 NAI API 配置仓库（裁决 D7）。
 * 需求 4.9 / 4.10 是两类互不相干的配置，拆成两个工厂，禁止共用一个再按 kind 过滤。
 * 归属：W1-D 存储代理实现。W0 仅冻结签名。
 */

import { IDB_STORES } from '../idb.js';
import { createEntityRepo } from '../entity-repo.js';
import {
    API_CONFIG_SCHEMA_VERSION,
    migrateApiConfig,
    validateLlmApiConfig,
    validateNaiApiConfig,
} from '../../../domain/model/api-config.js';

/**
 * @param {{ db: object, bus?: object }} deps
 * @returns {import('../../../ports/repository.port.js').Repository<import('../../../domain/model/api-config.js').LlmApiConfig>}
 */
export function createLlmConfigRepo(deps) {
    return createEntityRepo({
        db: deps?.db,
        storeName: IDB_STORES.LLM_CONFIGS,
        kind: 'llm-config',
        schemaVersion: API_CONFIG_SCHEMA_VERSION,
        validate: validateLlmApiConfig,
        migrate: migrateApiConfig,
        idPrefix: 'llm',
    });
}

/**
 * @param {{ db: object, bus?: object }} deps
 * @returns {import('../../../ports/repository.port.js').Repository<import('../../../domain/model/api-config.js').NaiApiConfig>}
 */
export function createNaiConfigRepo(deps) {
    return createEntityRepo({
        db: deps?.db,
        storeName: IDB_STORES.NAI_CONFIGS,
        kind: 'nai-config',
        schemaVersion: API_CONFIG_SCHEMA_VERSION,
        validate: validateNaiApiConfig,
        migrate: migrateApiConfig,
        idPrefix: 'nai',
    });
}
