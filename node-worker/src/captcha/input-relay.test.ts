import { describe, expect, it, vi } from "vitest";
import type { CDPSession } from "playwright";
import type { RawData, WebSocket } from "ws";

import { CdpInputRelay, parseRemoteInputMessage } from "./input-relay";

describe("parseRemoteInputMessage", () => {
    it("parses a full mouse message", () => {
        const message = parseRemoteInputMessage(
            JSON.stringify({ type: "mouse", kind: "mousePressed", x: 10, y: 20, button: "left", clickCount: 1 }),
        );

        expect(message).toEqual({ type: "mouse", kind: "mousePressed", x: 10, y: 20, button: "left", clickCount: 1 });
    });

    it("parses a minimal mouse message without optional fields", () => {
        const message = parseRemoteInputMessage(JSON.stringify({ type: "mouse", kind: "mouseMoved", x: 1, y: 2 }));

        expect(message).toEqual({ type: "mouse", kind: "mouseMoved", x: 1, y: 2 });
    });

    it("rejects a mouse message missing coordinates", () => {
        expect(parseRemoteInputMessage(JSON.stringify({ type: "mouse", kind: "mousePressed", x: 1 }))).toBeUndefined();
    });

    it("rejects a mouse message with an unknown kind", () => {
        expect(parseRemoteInputMessage(JSON.stringify({ type: "mouse", kind: "mouseTeleported", x: 1, y: 2 }))).toBeUndefined();
    });

    it("rejects a mouse message with an unknown button", () => {
        expect(
            parseRemoteInputMessage(JSON.stringify({ type: "mouse", kind: "mousePressed", x: 1, y: 2, button: "laser" })),
        ).toBeUndefined();
    });

    it("parses a full key message", () => {
        const message = parseRemoteInputMessage(
            JSON.stringify({ type: "key", kind: "keyDown", key: "a", code: "KeyA", text: "a" }),
        );

        expect(message).toEqual({ type: "key", kind: "keyDown", key: "a", code: "KeyA", text: "a" });
    });

    it("parses a minimal key message without optional fields", () => {
        const message = parseRemoteInputMessage(JSON.stringify({ type: "key", kind: "keyUp", key: "Enter" }));

        expect(message).toEqual({ type: "key", kind: "keyUp", key: "Enter" });
    });

    it("rejects a key message missing key", () => {
        expect(parseRemoteInputMessage(JSON.stringify({ type: "key", kind: "keyDown" }))).toBeUndefined();
    });

    it("parses a resolved signal", () => {
        expect(parseRemoteInputMessage(JSON.stringify({ type: "resolved" }))).toEqual({ type: "resolved" });
    });

    it("rejects an unknown type", () => {
        expect(parseRemoteInputMessage(JSON.stringify({ type: "teleport" }))).toBeUndefined();
    });

    it("rejects malformed JSON", () => {
        expect(parseRemoteInputMessage("{not json")).toBeUndefined();
    });

    it("rejects non-object JSON", () => {
        expect(parseRemoteInputMessage(JSON.stringify("hello"))).toBeUndefined();
        expect(parseRemoteInputMessage(JSON.stringify(42))).toBeUndefined();
        expect(parseRemoteInputMessage(JSON.stringify(null))).toBeUndefined();
    });
});

type MessageListener = (data: RawData) => void;

function fakeSocket(): { socket: WebSocket; emitMessage: (payload: unknown) => void } {
    let listener: MessageListener | undefined;

    const socket = {
        on: vi.fn((event: string, handler: MessageListener) => {
            if (event === "message") {
                listener = handler;
            }
        }),
        off: vi.fn((event: string, handler: MessageListener) => {
            if (event === "message" && listener === handler) {
                listener = undefined;
            }
        }),
    } as unknown as WebSocket;

    return {
        socket,
        emitMessage: (payload) => listener?.(Buffer.from(JSON.stringify(payload))),
    };
}

function fakeCdpSession(): { session: CDPSession; sendCalls: [string, unknown][] } {
    const sendCalls: [string, unknown][] = [];
    const session = {
        send: vi.fn((method: string, params?: unknown) => {
            sendCalls.push([method, params]);
            return Promise.resolve({});
        }),
    } as unknown as CDPSession;

    return { session, sendCalls };
}

async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe("CdpInputRelay", () => {
    it("subscribes to socket messages on start()", () => {
        const { socket } = fakeSocket();
        const relay = new CdpInputRelay(fakeCdpSession().session, socket, vi.fn());

        relay.start();

        expect(socket.on).toHaveBeenCalledWith("message", expect.any(Function));
    });

    it("does not subscribe twice if start is called twice", () => {
        const { socket } = fakeSocket();
        const relay = new CdpInputRelay(fakeCdpSession().session, socket, vi.fn());

        relay.start();
        relay.start();

        expect(socket.on).toHaveBeenCalledTimes(1);
    });

    it("dispatches a mouse event to the CDP session", async () => {
        const { socket, emitMessage } = fakeSocket();
        const { session, sendCalls } = fakeCdpSession();
        const relay = new CdpInputRelay(session, socket, vi.fn());

        relay.start();
        emitMessage({ type: "mouse", kind: "mousePressed", x: 5, y: 6, button: "left", clickCount: 1 });
        await flushMicrotasks();

        expect(sendCalls).toContainEqual([
            "Input.dispatchMouseEvent",
            { type: "mousePressed", x: 5, y: 6, button: "left", clickCount: 1 },
        ]);
    });

    it("dispatches a mouse event without optional fields when they are absent", async () => {
        const { socket, emitMessage } = fakeSocket();
        const { session, sendCalls } = fakeCdpSession();
        const relay = new CdpInputRelay(session, socket, vi.fn());

        relay.start();
        emitMessage({ type: "mouse", kind: "mouseMoved", x: 5, y: 6 });
        await flushMicrotasks();

        expect(sendCalls).toContainEqual(["Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 6 }]);
    });

    it("dispatches a key event to the CDP session", async () => {
        const { socket, emitMessage } = fakeSocket();
        const { session, sendCalls } = fakeCdpSession();
        const relay = new CdpInputRelay(session, socket, vi.fn());

        relay.start();
        emitMessage({ type: "key", kind: "keyDown", key: "a", code: "KeyA" });
        await flushMicrotasks();

        expect(sendCalls).toContainEqual(["Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA" }]);
    });

    it("calls onResolved for a resolved signal instead of touching the CDP session", async () => {
        const { socket, emitMessage } = fakeSocket();
        const { session } = fakeCdpSession();
        const onResolved = vi.fn();
        const relay = new CdpInputRelay(session, socket, onResolved);

        relay.start();
        emitMessage({ type: "resolved" });
        await flushMicrotasks();

        expect(onResolved).toHaveBeenCalledTimes(1);
        expect(session.send).not.toHaveBeenCalled();
    });

    it("silently ignores a malformed message", async () => {
        const { socket, emitMessage } = fakeSocket();
        const { session } = fakeCdpSession();
        const onResolved = vi.fn();
        const relay = new CdpInputRelay(session, socket, onResolved);

        relay.start();
        emitMessage({ type: "not-a-real-type" });
        await flushMicrotasks();

        expect(onResolved).not.toHaveBeenCalled();
        expect(session.send).not.toHaveBeenCalled();
    });

    it("stop unsubscribes so further messages are ignored", async () => {
        const { socket, emitMessage } = fakeSocket();
        const { session } = fakeCdpSession();
        const relay = new CdpInputRelay(session, socket, vi.fn());

        relay.start();
        relay.stop();
        emitMessage({ type: "resolved" });
        await flushMicrotasks();

        expect(socket.off).toHaveBeenCalledWith("message", expect.any(Function));
        expect(session.send).not.toHaveBeenCalled();
    });

    it("stop is a no-op if never started", () => {
        const { socket } = fakeSocket();
        const relay = new CdpInputRelay(fakeCdpSession().session, socket, vi.fn());

        expect(() => {
            relay.stop();
        }).not.toThrow();
        expect(socket.off).not.toHaveBeenCalled();
    });
});
