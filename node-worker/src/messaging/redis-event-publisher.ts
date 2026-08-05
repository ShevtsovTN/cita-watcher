/**
 * Публикует `WorkerEvent` (../types/events.ts) на `watcher-events` pub/sub-канал (см.
 * ../../docs/NODE_WORKER_ROADMAP.md Phase 3, второй пункт чек-листа). Префикс канала
 * (`config.redis.keyPrefix`) добавляется вручную, а не через ioredis's client-level `keyPrefix` —
 * та опция не покрывает PUBLISH/SUBSCRIBE (см. ../config.ts докблок `redis.keyPrefix`), в отличие
 * от Laravel-стороны, чей phpredis-клиент префиксует и каналы тоже.
 */

import type { Redis } from "ioredis";

import type { WorkerEvent } from "../types";

const EVENTS_CHANNEL_NAME = "watcher-events";

export interface EventPublisher {
    publish(event: WorkerEvent): Promise<void>;
}

export class RedisEventPublisher implements EventPublisher {
    private readonly channel: string;

    public constructor(
        private readonly redis: Redis,
        keyPrefix: string,
    ) {
        this.channel = `${keyPrefix}${EVENTS_CHANNEL_NAME}`;
    }

    public async publish(event: WorkerEvent): Promise<void> {
        await this.redis.publish(this.channel, JSON.stringify(event));
    }
}
