/**
 * L2 适配器 · LLM API 配置仓库与 NAI API 配置仓库（裁决 D7）。
 * 需求 4.9 / 4.10 是两类互不相干的配置，拆成两个工厂，禁止共用一个再按 kind 过滤。
 * 归属：W1-D 存储代理实现。W0 仅冻结签名。
 */

import { IDB_STORES } from '../idb.js';
import { createEntityRepo } from '../entity-repo.js';
import {
    API_CONFIG_SCHEMA_VERSION,
    llmConfigForExport,
    validateLlmApiConfig,
    validateNaiApiConfig,
} from '../../../domain/model/api-config.js';
import { buildExportEnvelope } from '../import-export.js';
import { Ok, Err } from '../../../infra/result.js';
import { configError } from '../../../infra/errors.js';

/**
 * @param {{ db: object, bus?: object, yaml?: import('../../../domain/model/api-config.js').YamlApi }} deps
 * @returns {import('../../../ports/repository.port.js').Repository<import('../../../domain/model/api-config.js').LlmApiConfig>}
 */
export function createLlmConfigRepo(deps) {
    const yaml = deps?.yaml;
    const validate = (obj) => validateLlmApiConfig(obj, { yaml });
    const base = createEntityRepo({
        db: deps?.db,
        storeName: IDB_STORES.LLM_CONFIGS,
        kind: 'llm-config',
        schemaVersion: API_CONFIG_SCHEMA_VERSION,
        validate,
        idPrefix: 'llm',
    });
    return {
        ...base,
        async exportJson() {
            const listed = await base.list();
            if (!listed.ok) {
                return listed;
            }
            try {
                return Ok(buildExportEnvelope({
                    kind: 'llm-config',
                    schemaVersion: API_CONFIG_SCHEMA_VERSION,
                    payload: {
                        items: listed.value.map((item) => llmConfigForExport(item)),
                    },
                }));
            } catch (cause) {
                return Err(configError({
                    code: 'LLM_EXPORT_FAILED',
                    message: '导出 LLM 配置失败',
                    cause,
                }));
            }
        },
    };
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
        idPrefix: 'nai',
    });
}
