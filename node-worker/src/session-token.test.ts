import { describe, expect, it } from "vitest";

import { generateSessionToken, isSessionToken } from "./session-token";

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

describe("isSessionToken", () => {
    it("accepts a real generated token", () => {
        expect(isSessionToken(generateSessionToken())).toBe(true);
    });

    it("rejects the empty string", () => {
        expect(isSessionToken("")).toBe(false);
    });

    it("rejects a token that is too short", () => {
        expect(isSessionToken(generateSessionToken().slice(0, 42))).toBe(false);
    });

    it("rejects a token that is too long", () => {
        expect(isSessionToken(`${generateSessionToken()}a`)).toBe(false);
    });

    it("rejects a correctly-sized string containing base64 padding", () => {
        expect(isSessionToken(`${generateSessionToken().slice(0, 42)}=`)).toBe(false);
    });

    it("rejects a correctly-sized string containing standard-base64-only characters", () => {
        expect(isSessionToken(`${generateSessionToken().slice(0, 42)}+`)).toBe(false);
        expect(isSessionToken(`${generateSessionToken().slice(0, 42)}/`)).toBe(false);
    });
});
