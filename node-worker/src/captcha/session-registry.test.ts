import { describe, expect, it } from "vitest";
import type { AutomationSession } from "../automation";

import { generateSessionToken } from "../session-token";
import { InMemoryCaptchaSessionRegistry } from "./session-registry";

function fakeSession(id: string): AutomationSession {
    return { id } as unknown as AutomationSession;
}

describe("InMemoryCaptchaSessionRegistry", () => {
    it("resolves a registered token to its session", () => {
        const registry = new InMemoryCaptchaSessionRegistry();
        const token = generateSessionToken();
        const session = fakeSession("a");

        registry.register(token, session);

        expect(registry.resolve(token)).toBe(session);
    });

    it("returns undefined for a token that was never registered", () => {
        const registry = new InMemoryCaptchaSessionRegistry();

        expect(registry.resolve(generateSessionToken())).toBeUndefined();
    });

    it("returns undefined for a token after it is unregistered", () => {
        const registry = new InMemoryCaptchaSessionRegistry();
        const token = generateSessionToken();

        registry.register(token, fakeSession("a"));
        registry.unregister(token);

        expect(registry.resolve(token)).toBeUndefined();
    });

    it("unregister is a no-op for an unknown token", () => {
        const registry = new InMemoryCaptchaSessionRegistry();

        expect(() => {
            registry.unregister(generateSessionToken());
        }).not.toThrow();
    });

    it("keeps distinct tokens independent", () => {
        const registry = new InMemoryCaptchaSessionRegistry();
        const [tokenA, tokenB] = [generateSessionToken(), generateSessionToken()];
        const [sessionA, sessionB] = [fakeSession("a"), fakeSession("b")];

        registry.register(tokenA, sessionA);
        registry.register(tokenB, sessionB);

        expect(registry.resolve(tokenA)).toBe(sessionA);
        expect(registry.resolve(tokenB)).toBe(sessionB);
    });

    it("re-registering a token overwrites its previous session", () => {
        const registry = new InMemoryCaptchaSessionRegistry();
        const token = generateSessionToken();

        registry.register(token, fakeSession("a"));
        registry.register(token, fakeSession("b"));

        expect(registry.resolve(token)).toEqual(fakeSession("b"));
    });
});
