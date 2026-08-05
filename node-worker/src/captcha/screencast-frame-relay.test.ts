import { describe, expect, it, vi } from "vitest";
import type { CDPSession } from "playwright";
import type { WebSocket } from "ws";

import { CdpScreencastFrameRelay } from "./screencast-frame-relay";

type FrameListener = (payload: { data: string; sessionId: number }) => void;

function fakeCdpSession(): { session: CDPSession; emitFrame: FrameListener; sendCalls: [string, unknown][] } {
    let listener: FrameListener | undefined;
    const sendCalls: [string, unknown][] = [];

    const session = {
        on: vi.fn((event: string, handler: FrameListener) => {
            if (event === "Page.screencastFrame") {
                listener = handler;
            }
        }),
        off: vi.fn((event: string, handler: FrameListener) => {
            if (event === "Page.screencastFrame" && listener === handler) {
                listener = undefined;
            }
        }),
        send: vi.fn((method: string, params?: unknown) => {
            sendCalls.push([method, params]);
            return Promise.resolve({});
        }),
    } as unknown as CDPSession;

    return {
        session,
        sendCalls,
        emitFrame: (payload) => listener?.(payload),
    };
}

function fakeSocket(): WebSocket {
    return { send: vi.fn() } as unknown as WebSocket;
}

describe("CdpScreencastFrameRelay", () => {
    it("starts the CDP screencast on start()", async () => {
        const { session, sendCalls } = fakeCdpSession();
        const relay = new CdpScreencastFrameRelay(session, fakeSocket());

        await relay.start();

        expect(sendCalls).toContainEqual(["Page.startScreencast", { format: "jpeg", quality: 80, everyNthFrame: 1 }]);
    });

    it("does not start a second time if already started", async () => {
        const { session } = fakeCdpSession();
        const relay = new CdpScreencastFrameRelay(session, fakeSocket());

        await relay.start();
        await relay.start();

        expect(session.send).toHaveBeenCalledTimes(1);
    });

    it("forwards a frame's base64 data to the socket as a screencast_frame message", async () => {
        const { session, emitFrame } = fakeCdpSession();
        const socket = fakeSocket();
        const relay = new CdpScreencastFrameRelay(session, socket);

        await relay.start();
        emitFrame({ data: "base64data", sessionId: 7 });

        expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "screencast_frame", data: "base64data" }));
    });

    it("acks each frame by its sessionId", async () => {
        const { session, emitFrame, sendCalls } = fakeCdpSession();
        const relay = new CdpScreencastFrameRelay(session, fakeSocket());

        await relay.start();
        emitFrame({ data: "base64data", sessionId: 7 });

        expect(sendCalls).toContainEqual(["Page.screencastFrameAck", { sessionId: 7 }]);
    });

    it("stop removes the listener and sends stopScreencast", async () => {
        const { session, emitFrame, sendCalls } = fakeCdpSession();
        const socket = fakeSocket();
        const relay = new CdpScreencastFrameRelay(session, socket);

        await relay.start();
        await relay.stop();
        emitFrame({ data: "ignored-after-stop", sessionId: 1 });

        expect(sendCalls).toContainEqual(["Page.stopScreencast", undefined]);
        expect(socket.send).not.toHaveBeenCalled();
    });

    it("stop is a no-op if never started", async () => {
        const { session } = fakeCdpSession();
        const relay = new CdpScreencastFrameRelay(session, fakeSocket());

        await relay.stop();

        expect(session.send).not.toHaveBeenCalled();
    });
});
