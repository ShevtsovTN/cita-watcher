/**
 * Тесты `messaging/` против настоящего Redis (см. ../../docs/NODE_WORKER_ROADMAP.md Phase 3,
 * четвёртый пункт чек-листа: "Tests against a real or in-memory Redis"). Остальные тесты в
 * `messaging/` гоняются против hand-built fakes `Redis` (тот же идиом, что Playwright-фейки в
 * `automation/`) — этот файл единственный реально открывает TCP-соединение, поэтому требует
 * запущенного `redis`-сервиса (см. node-worker/CLAUDE.md "Common commands" — гонять `npm test`
 * внутри dev-контейнера, где `redis` всегда поднят по `depends_on`). Использует отдельную
 * логическую БД (15), чтобы не задеть то, чем реально пользуется Laravel-стек (БД 0 по умолчанию).
 */

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Redis } from "ioredis";

import { loadConfig } from "../config";
import type { WorkerCommand } from "../types";
import { RedisCommandConsumer } from "./redis-command-consumer";
import { RedisEventPublisher } from "./redis-event-publisher";

const TEST_DB = 15;
const TEST_KEY_PREFIX = "node-worker-test-";
const { redis: redisConfig } = loadConfig();

function createRedisClient(): Redis {
    return new Redis({ host: redisConfig.host, port: redisConfig.port, db: TEST_DB });
}

describe("messaging against a real Redis", () => {
    let setupClient: Redis;

    beforeAll(async () => {
        setupClient = createRedisClient();
        await setupClient.flushdb();
    });

    afterEach(async () => {
        await setupClient.flushdb();
    });

    afterAll(async () => {
        await setupClient.quit();
    });

    it("a published event is received on the prefixed channel by a real subscriber", async () => {
        const publisherClient = createRedisClient();
        const subscriberClient = createRedisClient();
        const publisher = new RedisEventPublisher(publisherClient, TEST_KEY_PREFIX);
        const received: string[] = [];

        subscriberClient.on("message", (_channel, message: string) => {
            received.push(message);
        });
        await subscriberClient.subscribe(`${TEST_KEY_PREFIX}watcher-events`);

        const event = { type: "captcha_required" as const, watchTaskId: 1, occurredAt: "2026-08-05T00:00:00Z" };
        await publisher.publish(event);

        await vi.waitFor(() => {
            expect(received).toEqual([JSON.stringify(event)]);
        });

        await subscriberClient.quit();
        await publisherClient.quit();
    });

    it("a command RPUSHed onto the prefixed list is popped and parsed by the consumer", async () => {
        const consumerClient = createRedisClient();
        const command: WorkerCommand = {
            commandId: "b4a1e0e0-0000-4000-8000-000000000000",
            type: "check_availability",
            watchTaskId: 7,
            procedure: { province: "Madrid", tramiteCode: "CITA_DNI" },
            applicant: {
                fullName: "Jane Doe",
                documentType: "dni",
                documentId: "00000000A",
                email: "jane@example.test",
                phone: null,
                birthYear: 1990,
                nationality: "ESPAÑA",
            },
        };
        const received: WorkerCommand[] = [];
        const consumer = new RedisCommandConsumer(consumerClient, TEST_KEY_PREFIX, 3, (received_) => {
            received.push(received_);
            return Promise.resolve();
        });

        consumer.start();
        await setupClient.rpush(`${TEST_KEY_PREFIX}watcher-commands`, JSON.stringify(command));

        await vi.waitFor(() => {
            expect(received).toEqual([command]);
        });

        await consumer.stop();
        await consumerClient.quit();
    });
});
