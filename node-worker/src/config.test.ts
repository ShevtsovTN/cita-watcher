import { describe, expect, it } from "vitest";

import { EnvValidationError, loadConfig } from "./config";

describe("loadConfig", () => {
    it("applies defaults when no env vars are provided", () => {
        const config = loadConfig({});

        expect(config).toEqual({
            redis: { host: "127.0.0.1", port: 6379, keyPrefix: "laravel-database-" },
            cdpRelay: { port: 4001 },
            maxConcurrentSessions: 3,
        });
    });

    it("reads and trims provided values", () => {
        const config = loadConfig({
            REDIS_HOST: " redis ",
            REDIS_PORT: "6400",
            REDIS_KEY_PREFIX: "custom-prefix-",
            CDP_RELAY_PORT: "5000",
            MAX_CONCURRENT_SESSIONS: "5",
        });

        expect(config).toEqual({
            redis: { host: "redis", port: 6400, keyPrefix: "custom-prefix-" },
            cdpRelay: { port: 5000 },
            maxConcurrentSessions: 5,
        });
    });

    it("allows REDIS_KEY_PREFIX to be explicitly empty", () => {
        const config = loadConfig({ REDIS_KEY_PREFIX: "" });

        expect(config.redis.keyPrefix).toBe("");
    });

    it("is frozen", () => {
        const config = loadConfig({});

        expect(Object.isFrozen(config)).toBe(true);
    });

    it("throws EnvValidationError when REDIS_HOST is blank", () => {
        expect(() => loadConfig({ REDIS_HOST: "   " })).toThrow(EnvValidationError);
    });

    it.each([
        ["REDIS_PORT", "not-a-number"],
        ["REDIS_PORT", "0"],
        ["REDIS_PORT", "65536"],
        ["REDIS_PORT", "1.5"],
    ])("throws EnvValidationError when %s is invalid (%s)", (name, value) => {
        expect(() => loadConfig({ [name]: value })).toThrow(EnvValidationError);
    });

    it.each([
        ["MAX_CONCURRENT_SESSIONS", "0"],
        ["MAX_CONCURRENT_SESSIONS", "-1"],
        ["MAX_CONCURRENT_SESSIONS", "not-a-number"],
    ])("throws EnvValidationError when %s is invalid (%s)", (name, value) => {
        expect(() => loadConfig({ [name]: value })).toThrow(EnvValidationError);
    });
});
