import { describe, expect, it, vi } from "vitest";
import type { Redis } from "ioredis";

import type { CheckCompletedEvent } from "../types";
import { RedisEventPublisher } from "./redis-event-publisher";

function fakeRedis(): { redis: Redis; publishCalls: [string, string][] } {
    const publishCalls: [string, string][] = [];
    const redis = {
        publish: vi.fn((channel: string, message: string) => {
            publishCalls.push([channel, message]);
            return Promise.resolve(1);
        }),
    } as unknown as Redis;

    return { redis, publishCalls };
}

describe("RedisEventPublisher", () => {
    it("publishes the event as JSON on the prefixed channel", async () => {
        const { redis, publishCalls } = fakeRedis();
        const publisher = new RedisEventPublisher(redis, "laravel-database-");
        const event: CheckCompletedEvent = { type: "check_completed", watchTaskId: 42, slots: [], checkedAt: "2026-08-05T00:00:00Z" };

        await publisher.publish(event);

        expect(publishCalls).toEqual([["laravel-database-watcher-events", JSON.stringify(event)]]);
    });

    it("publishes on the bare channel name when the prefix is empty", async () => {
        const { redis, publishCalls } = fakeRedis();
        const publisher = new RedisEventPublisher(redis, "");

        await publisher.publish({ type: "captcha_required", watchTaskId: 1, occurredAt: "2026-08-05T00:00:00Z" });

        expect(publishCalls[0]?.[0]).toBe("watcher-events");
    });
});
