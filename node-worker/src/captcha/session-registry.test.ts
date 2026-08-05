import { describe, expect, it, vi } from "vitest";
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

        registry.register(token, session, vi.fn());

        expect(registry.resolve(token)).toBe(session);
    });

    it("returns undefined for a token that was never registered", () => {
        const registry = new InMemoryCaptchaSessionRegistry();

        expect(registry.resolve(generateSessionToken())).toBeUndefined();
    });

    it("returns undefined for a token after it is unregistered", () => {
        const registry = new InMemoryCaptchaSessionRegistry();
        const token = generateSessionToken();

        registry.register(token, fakeSession("a"), vi.fn());
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

        registry.register(tokenA, sessionA, vi.fn());
        registry.register(tokenB, sessionB, vi.fn());

        expect(registry.resolve(tokenA)).toBe(sessionA);
        expect(registry.resolve(tokenB)).toBe(sessionB);
    });

    it("re-registering a token overwrites its previous session", () => {
        const registry = new InMemoryCaptchaSessionRegistry();
        const token = generateSessionToken();

        registry.register(token, fakeSession("a"), vi.fn());
        registry.register(token, fakeSession("b"), vi.fn());

        expect(registry.resolve(token)).toEqual(fakeSession("b"));
    });

    it("notifyResolved calls the registered onResolved callback", () => {
        const registry = new InMemoryCaptchaSessionRegistry();
        const token = generateSessionToken();
        const onResolved = vi.fn();

        registry.register(token, fakeSession("a"), onResolved);
        registry.notifyResolved(token);

        expect(onResolved).toHaveBeenCalledTimes(1);
    });

    it("notifyResolved is a no-op for an unknown token", () => {
        const registry = new InMemoryCaptchaSessionRegistry();

        expect(() => {
            registry.notifyResolved(generateSessionToken());
        }).not.toThrow();
    });

    it("notifyResolved is a no-op after the token has been unregistered", () => {
        const registry = new InMemoryCaptchaSessionRegistry();
        const token = generateSessionToken();
        const onResolved = vi.fn();

        registry.register(token, fakeSession("a"), onResolved);
        registry.unregister(token);
        registry.notifyResolved(token);

        expect(onResolved).not.toHaveBeenCalled();
    });

    it("notifyResolved only calls the callback for the matching token", () => {
        const registry = new InMemoryCaptchaSessionRegistry();
        const [tokenA, tokenB] = [generateSessionToken(), generateSessionToken()];
        const [onResolvedA, onResolvedB] = [vi.fn(), vi.fn()];

        registry.register(tokenA, fakeSession("a"), onResolvedA);
        registry.register(tokenB, fakeSession("b"), onResolvedB);
        registry.notifyResolved(tokenA);

        expect(onResolvedA).toHaveBeenCalledTimes(1);
        expect(onResolvedB).not.toHaveBeenCalled();
    });
});
