import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage } from "node:http";
import type { WebSocket, WebSocketServer } from "ws";

import { generateSessionToken } from "../session-token";
import {
    extractSessionToken,
    INVALID_SESSION_TOKEN_CLOSE_CODE,
    INVALID_SESSION_TOKEN_CLOSE_REASON,
    WsScreencastRelay,
} from "./relay-server";

describe("extractSessionToken", () => {
    it("extracts a valid token from the expected path", () => {
        const token = generateSessionToken();

        expect(extractSessionToken(`/captcha-ws/${token}`)).toBe(token);
    });

    it("ignores a trailing query string", () => {
        const token = generateSessionToken();

        expect(extractSessionToken(`/captcha-ws/${token}?foo=bar`)).toBe(token);
    });

    it("returns undefined for a missing url", () => {
        expect(extractSessionToken(undefined)).toBeUndefined();
    });

    it("returns undefined for a path with the wrong prefix", () => {
        expect(extractSessionToken(`/not-captcha-ws/${generateSessionToken()}`)).toBeUndefined();
    });

    it("returns undefined for a malformed token", () => {
        expect(extractSessionToken("/captcha-ws/not-a-real-token")).toBeUndefined();
    });

    it("returns undefined for an empty token segment", () => {
        expect(extractSessionToken("/captcha-ws/")).toBeUndefined();
    });
});

function fakeSocket(): WebSocket {
    return { close: vi.fn() } as unknown as WebSocket;
}

function fakeRequest(url: string | undefined): IncomingMessage {
    return { url } as unknown as IncomingMessage;
}

type ConnectionHandler = (socket: WebSocket, request: IncomingMessage) => void;

function fakeWebSocketServer(): {
    server: WebSocketServer;
    emitConnection: ConnectionHandler;
} {
    let connectionHandler: ConnectionHandler | undefined;

    const server = {
        on: vi.fn((event: string, handler: ConnectionHandler) => {
            if (event === "connection") {
                connectionHandler = handler;
            }
        }),
        close: vi.fn((cb?: (error?: Error) => void) => {
            cb?.();
        }),
    } as unknown as WebSocketServer;

    return {
        server,
        emitConnection: (socket, request) => connectionHandler?.(socket, request),
    };
}

describe("WsScreencastRelay", () => {
    it("starts a server on the configured port via the injected factory", () => {
        const { server } = fakeWebSocketServer();
        const createServer = vi.fn(() => server);
        const relay = new WsScreencastRelay(4001, vi.fn(), createServer);

        relay.start();

        expect(createServer).toHaveBeenCalledWith({ port: 4001 });
    });

    it("does not create a second server if start is called twice", () => {
        const { server } = fakeWebSocketServer();
        const createServer = vi.fn(() => server);
        const relay = new WsScreencastRelay(4001, vi.fn(), createServer);

        relay.start();
        relay.start();

        expect(createServer).toHaveBeenCalledTimes(1);
    });

    it("hands a connection with a valid token to onValidConnection", () => {
        const { server, emitConnection } = fakeWebSocketServer();
        const onValidConnection = vi.fn();
        const relay = new WsScreencastRelay(4001, onValidConnection, () => server);
        const token = generateSessionToken();
        const socket = fakeSocket();

        relay.start();
        emitConnection(socket, fakeRequest(`/captcha-ws/${token}`));

        expect(onValidConnection).toHaveBeenCalledWith(token, socket);
        expect(socket.close).not.toHaveBeenCalled();
    });

    it("closes a connection with an invalid token instead of calling onValidConnection", () => {
        const { server, emitConnection } = fakeWebSocketServer();
        const onValidConnection = vi.fn();
        const relay = new WsScreencastRelay(4001, onValidConnection, () => server);
        const socket = fakeSocket();

        relay.start();
        emitConnection(socket, fakeRequest("/captcha-ws/not-a-real-token"));

        expect(onValidConnection).not.toHaveBeenCalled();
        expect(socket.close).toHaveBeenCalledWith(INVALID_SESSION_TOKEN_CLOSE_CODE, INVALID_SESSION_TOKEN_CLOSE_REASON);
    });

    it("closes a connection with a missing token", () => {
        const { server, emitConnection } = fakeWebSocketServer();
        const onValidConnection = vi.fn();
        const relay = new WsScreencastRelay(4001, onValidConnection, () => server);
        const socket = fakeSocket();

        relay.start();
        emitConnection(socket, fakeRequest(undefined));

        expect(onValidConnection).not.toHaveBeenCalled();
        expect(socket.close).toHaveBeenCalledWith(INVALID_SESSION_TOKEN_CLOSE_CODE, INVALID_SESSION_TOKEN_CLOSE_REASON);
    });

    it("stop closes the underlying server", async () => {
        const { server } = fakeWebSocketServer();
        const relay = new WsScreencastRelay(4001, vi.fn(), () => server);

        relay.start();
        await relay.stop();

        expect(server.close).toHaveBeenCalledTimes(1);
    });

    it("stop is a no-op if the relay was never started", async () => {
        const relay = new WsScreencastRelay(4001, vi.fn());

        await expect(relay.stop()).resolves.toBeUndefined();
    });

    it("stop lets start create a new server again", async () => {
        const first = fakeWebSocketServer();
        const second = fakeWebSocketServer();
        const createServer = vi.fn().mockReturnValueOnce(first.server).mockReturnValueOnce(second.server);
        const relay = new WsScreencastRelay(4001, vi.fn(), createServer);

        relay.start();
        await relay.stop();
        relay.start();

        expect(createServer).toHaveBeenCalledTimes(2);
    });
});
