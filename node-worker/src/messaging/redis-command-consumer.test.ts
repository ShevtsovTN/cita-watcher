import { describe, expect, it, vi } from "vitest";
import type { Redis } from "ioredis";

import type { Logger, LogContext } from "../logger";
import { RedisCommandConsumer } from "./redis-command-consumer";

const VALID_PAYLOAD = {
    commandId: "b4a1e0e0-0000-4000-8000-000000000000",
    type: "check_availability",
    watchTaskId: 42,
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

async function flushMicrotasks(times = 10): Promise<void> {
    for (let i = 0; i < times; i += 1) {
        await Promise.resolve();
    }
}

function fakeRedis(): { redis: Redis; brpop: ReturnType<typeof vi.fn> } {
    const brpop = vi.fn();
    const redis = { brpop } as unknown as Redis;

    return { redis, brpop };
}

function fakeLogger(): { logger: Logger; errors: { message: string; context: LogContext | undefined }[] } {
    const errors: { message: string; context: LogContext | undefined }[] = [];
    const logger: Logger = {
        info: vi.fn(),
        error: (message, context) => {
            errors.push({ message, context });
        },
        withContext: () => logger,
    };

    return { logger, errors };
}

describe("RedisCommandConsumer", () => {
    it("pops from the prefixed list with the expected timeout", () => {
        const { redis, brpop } = fakeRedis();
        brpop.mockImplementation(() => new Promise(() => undefined));
        const consumer = new RedisCommandConsumer(redis, "laravel-database-", 3, vi.fn());

        consumer.start();

        expect(brpop).toHaveBeenCalledWith("laravel-database-watcher-commands", 1);
    });

    it("parses and forwards a valid command to onCommand", async () => {
        const { redis, brpop } = fakeRedis();
        brpop
            .mockResolvedValueOnce(["key", JSON.stringify(VALID_PAYLOAD)])
            .mockImplementation(() => new Promise(() => undefined));
        const onCommand = vi.fn(() => Promise.resolve());
        const consumer = new RedisCommandConsumer(redis, "", 3, onCommand);

        consumer.start();
        await flushMicrotasks();

        expect(onCommand).toHaveBeenCalledWith(VALID_PAYLOAD);
    });

    it("drops a malformed payload and keeps polling", async () => {
        const { redis, brpop } = fakeRedis();
        brpop
            .mockResolvedValueOnce(["key", "{not json"])
            .mockResolvedValueOnce(["key", JSON.stringify(VALID_PAYLOAD)])
            .mockImplementation(() => new Promise(() => undefined));
        const onCommand = vi.fn(() => Promise.resolve());
        const consumer = new RedisCommandConsumer(redis, "", 3, onCommand);

        consumer.start();
        await flushMicrotasks();

        expect(onCommand).toHaveBeenCalledTimes(1);
        expect(onCommand).toHaveBeenCalledWith(VALID_PAYLOAD);
    });

    it("logs an error (without the raw payload) when dropping a malformed payload", async () => {
        const { redis, brpop } = fakeRedis();
        const malformed = "{not json";
        brpop.mockResolvedValueOnce(["key", malformed]).mockImplementation(() => new Promise(() => undefined));
        const { logger, errors } = fakeLogger();
        const consumer = new RedisCommandConsumer(redis, "", 3, vi.fn(() => Promise.resolve()), undefined, logger);

        consumer.start();
        await flushMicrotasks();

        expect(errors).toHaveLength(1);
        expect(errors[0]?.message).toContain("malformed");
        expect(JSON.stringify(errors[0]?.context)).not.toContain("not json");
        expect(errors[0]?.context).toEqual({ payload_bytes: Buffer.byteLength(malformed) });
    });

    it("ignores a brpop timeout (null) and keeps polling", async () => {
        const { redis, brpop } = fakeRedis();
        brpop
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce(["key", JSON.stringify(VALID_PAYLOAD)])
            .mockImplementation(() => new Promise(() => undefined));
        const onCommand = vi.fn(() => Promise.resolve());
        const consumer = new RedisCommandConsumer(redis, "", 3, onCommand);

        consumer.start();
        await flushMicrotasks();

        expect(onCommand).toHaveBeenCalledTimes(1);
    });

    it("does not start a second loop if start is called twice", () => {
        const { redis, brpop } = fakeRedis();
        brpop.mockImplementation(() => new Promise(() => undefined));
        const consumer = new RedisCommandConsumer(redis, "", 3, vi.fn());

        consumer.start();
        consumer.start();

        expect(brpop).toHaveBeenCalledTimes(1);
    });

    it("stop resolves and halts the loop", async () => {
        const { redis, brpop } = fakeRedis();
        brpop.mockResolvedValue(null);
        const consumer = new RedisCommandConsumer(redis, "", 3, vi.fn());

        consumer.start();
        await flushMicrotasks();

        await expect(consumer.stop()).resolves.toBeUndefined();
    });

    it("stop is a no-op if never started", async () => {
        const { redis } = fakeRedis();
        const consumer = new RedisCommandConsumer(redis, "", 3, vi.fn());

        await expect(consumer.stop()).resolves.toBeUndefined();
    });

    it("does not pull another command until a slot frees up (backpressure)", async () => {
        const { redis, brpop } = fakeRedis();
        let resolveHandler: (() => void) | undefined;
        const onCommand = vi.fn(
            () =>
                new Promise<void>((resolve) => {
                    resolveHandler = resolve;
                }),
        );
        const sleep = vi.fn(() => Promise.resolve());
        brpop
            .mockResolvedValueOnce(["key", JSON.stringify(VALID_PAYLOAD)])
            .mockImplementation(() => new Promise(() => undefined));
        const consumer = new RedisCommandConsumer(redis, "", 1, onCommand, sleep);

        consumer.start();
        await flushMicrotasks();

        expect(onCommand).toHaveBeenCalledTimes(1);
        expect(brpop).toHaveBeenCalledTimes(1);

        await flushMicrotasks();

        expect(sleep).toHaveBeenCalled();
        expect(brpop).toHaveBeenCalledTimes(1);

        resolveHandler?.();
        await flushMicrotasks();

        expect(brpop).toHaveBeenCalledTimes(2);
    });
});
