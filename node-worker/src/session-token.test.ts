import { describe, expect, it } from "vitest";

import { generateSessionToken } from "./session-token";

describe("generateSessionToken", () => {
    it("produces a base64url string with no padding/unsafe characters", () => {
        const token = generateSessionToken();

        expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it("produces 256 bits of entropy (32 raw bytes)", () => {
        const token = generateSessionToken();

        // base64url of 32 bytes is 43 chars (no padding).
        expect(token).toHaveLength(43);
    });

    it("never repeats across calls", () => {
        const tokens = new Set(Array.from({ length: 1000 }, () => generateSessionToken()));

        expect(tokens.size).toBe(1000);
    });
});
