import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import type { AutomationSession } from "../automation";

import { generateSessionToken } from "../session-token";
import { InMemoryCaptchaSessionRegistry } from "./session-registry";
import {
    bindConnectionToRegisteredSession,
    UNKNOWN_SESSION_TOKEN_CLOSE_CODE,
    UNKNOWN_SESSION_TOKEN_CLOSE_REASON,
} from "./session-binder";

function fakeSocket(): WebSocket {
    return { close: vi.fn() } as unknown as WebSocket;
}

function fakeSession(): AutomationSession {
    return { id: "a" } as unknown as AutomationSession;
}

describe("bindConnectionToRegisteredSession", () => {
    it("calls onBound with the resolved session for a registered token", () => {
        const registry = new InMemoryCaptchaSessionRegistry();
        const token = generateSessionToken();
        const session = fakeSession();
        registry.register(token, session);

        const onBound = vi.fn();
        const socket = fakeSocket();
        const handleConnection = bindConnectionToRegisteredSession(registry, onBound);

        handleConnection(token, socket);

        expect(onBound).toHaveBeenCalledWith(session, socket);
        expect(socket.close).not.toHaveBeenCalled();
    });

    it("closes the connection with the unknown-token code for an unregistered token", () => {
        const registry = new InMemoryCaptchaSessionRegistry();
        const onBound = vi.fn();
        const socket = fakeSocket();
        const handleConnection = bindConnectionToRegisteredSession(registry, onBound);

        handleConnection(generateSessionToken(), socket);

        expect(onBound).not.toHaveBeenCalled();
        expect(socket.close).toHaveBeenCalledWith(UNKNOWN_SESSION_TOKEN_CLOSE_CODE, UNKNOWN_SESSION_TOKEN_CLOSE_REASON);
    });

    it("closes the connection for a token that was registered then unregistered", () => {
        const registry = new InMemoryCaptchaSessionRegistry();
        const token = generateSessionToken();
        registry.register(token, fakeSession());
        registry.unregister(token);

        const onBound = vi.fn();
        const socket = fakeSocket();
        const handleConnection = bindConnectionToRegisteredSession(registry, onBound);

        handleConnection(token, socket);

        expect(onBound).not.toHaveBeenCalled();
        expect(socket.close).toHaveBeenCalledWith(UNKNOWN_SESSION_TOKEN_CLOSE_CODE, UNKNOWN_SESSION_TOKEN_CLOSE_REASON);
    });
});
