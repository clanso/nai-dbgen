import { abortErrIfNeeded } from './_helpers.js';

/** One in-flight request per credential, shared by every image-generation entry. */
export function createNaiRequestPool() {
    const queue = [];
    const active = new Map();
    let serialActive = false;
    let disposed = false;

    function aborted() {
        return abortErrIfNeeded({ aborted: true });
    }

    function pump() {
        if (disposed || serialActive) return;
        for (let i = 0; i < queue.length;) {
            const job = queue[i];
            if (!job.parallel && active.size) break;
            const config = job.configs.find((item) => !active.has(credential(item)));
            if (!config) {
                i += 1;
                continue;
            }
            queue.splice(i, 1);
            const key = credential(config);
            active.set(key, job.controller);
            serialActive = !job.parallel;
            Promise.resolve()
                .then(() => job.controller.signal.aborted
                    ? aborted()
                    : job.execute(config, job.controller.signal))
                .then(job.resolve, job.reject)
                .finally(() => {
                    job.signal?.removeEventListener('abort', job.cancel);
                    active.delete(key);
                    if (!job.parallel) serialActive = false;
                    pump();
                });
            if (serialActive) break;
        }
    }

    return {
        run(configs, execute, { signal, parallel = false } = {}) {
            if (disposed || signal?.aborted) return Promise.resolve(aborted());
            if (!Array.isArray(configs) || configs.length === 0) {
                return Promise.reject(new Error('NAI request pool requires at least one configuration'));
            }
            return new Promise((resolve, reject) => {
                const job = {
                    configs: configs.map((config) => ({ ...config })),
                    execute, signal, parallel, resolve, reject,
                    controller: new AbortController(),
                };
                job.cancel = () => {
                    job.controller.abort();
                    const index = queue.indexOf(job);
                    if (index < 0) return;
                    queue.splice(index, 1);
                    signal?.removeEventListener('abort', job.cancel);
                    resolve(aborted());
                    pump();
                };
                signal?.addEventListener('abort', job.cancel, { once: true });
                queue.push(job);
                pump();
            });
        },
        dispose() {
            disposed = true;
            for (const job of [...queue]) job.cancel();
            for (const controller of active.values()) controller.abort();
        },
    };
}

function credential(config) {
    return String(config.apiKey || '').trim() || `config:${config.id}`;
}

export function selectNaiPoolConfigs(active, configs, parallel) {
    const endpoint = (config) => String(config?.baseUrl || '').trim().replace(/\/+$/, '');
    const selected = [active];
    if (!parallel || !String(active?.apiKey || '').trim()) return selected;
    const keys = new Set([credential(active)]);
    for (const config of configs || []) {
        const key = String(config?.apiKey || '').trim();
        if (!key || keys.has(key) || endpoint(config) !== endpoint(active)) continue;
        keys.add(key);
        selected.push(config);
    }
    return selected;
}
