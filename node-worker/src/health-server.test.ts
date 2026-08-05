import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { HttpHealthServer } from "./health-server";

type RequestListener = (req: IncomingMessage, res: ServerResponse) => void;

function fakeHttpServer(): Server {
    return {
        listen: vi.fn(),
        close: vi.fn((cb?: (error?: Error) => void) => {
            cb?.();
        }),
    } as unknown as Server;
}

function fakeResponse(): ServerResponse {
    return { writeHead: vi.fn(), end: vi.fn() } as unknown as ServerResponse;
}

describe("HttpHealthServer", () => {
    it("starts a server on the configured port via the injected factory", () => {
        const server = fakeHttpServer();
        const createHttpServer = vi.fn(() => server);
        const health = new HttpHealthServer(4002, () => true, createHttpServer);

        health.start();

        expect(createHttpServer).toHaveBeenCalledTimes(1);
        expect(server.listen).toHaveBeenCalledWith(4002);
    });

    it("does not create a second server if start is called twice", () => {
        const server = fakeHttpServer();
        const createHttpServer = vi.fn(() => server);
        const health = new HttpHealthServer(4002, () => true, createHttpServer);

        health.start();
        health.start();

        expect(createHttpServer).toHaveBeenCalledTimes(1);
    });

    it("responds 200 with an ok status when isHealthy returns true", () => {
        const server = fakeHttpServer();
        let requestListener: RequestListener | undefined;
        const createHttpServer = vi.fn((listener: RequestListener) => {
            requestListener = listener;
            return server;
        });
        const health = new HttpHealthServer(4002, () => true, createHttpServer);
        const res = fakeResponse();

        health.start();
        requestListener?.({} as IncomingMessage, res);

        expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "application/json" });
        expect(res.end).toHaveBeenCalledWith(JSON.stringify({ status: "ok" }));
    });

    it("responds 503 with an unhealthy status when isHealthy returns false", () => {
        const server = fakeHttpServer();
        let requestListener: RequestListener | undefined;
        const createHttpServer = vi.fn((listener: RequestListener) => {
            requestListener = listener;
            return server;
        });
        const health = new HttpHealthServer(4002, () => false, createHttpServer);
        const res = fakeResponse();

        health.start();
        requestListener?.({} as IncomingMessage, res);

        expect(res.writeHead).toHaveBeenCalledWith(503, { "Content-Type": "application/json" });
        expect(res.end).toHaveBeenCalledWith(JSON.stringify({ status: "unhealthy" }));
    });

    it("calls isHealthy fresh on every request", () => {
        const server = fakeHttpServer();
        let requestListener: RequestListener | undefined;
        const createHttpServer = vi.fn((listener: RequestListener) => {
            requestListener = listener;
            return server;
        });
        const isHealthy = vi.fn(() => true);
        const health = new HttpHealthServer(4002, isHealthy, createHttpServer);

        health.start();
        requestListener?.({} as IncomingMessage, fakeResponse());
        requestListener?.({} as IncomingMessage, fakeResponse());

        expect(isHealthy).toHaveBeenCalledTimes(2);
    });

    it("stop closes the underlying server", async () => {
        const server = fakeHttpServer();
        const health = new HttpHealthServer(4002, () => true, () => server);

        health.start();
        await health.stop();

        expect(server.close).toHaveBeenCalledTimes(1);
    });

    it("stop is a no-op if the server was never started", async () => {
        const health = new HttpHealthServer(4002, () => true);

        await expect(health.stop()).resolves.toBeUndefined();
    });

    it("stop lets start create a new server again", async () => {
        const first = fakeHttpServer();
        const second = fakeHttpServer();
        const createHttpServer = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
        const health = new HttpHealthServer(4002, () => true, createHttpServer);

        health.start();
        await health.stop();
        health.start();

        expect(createHttpServer).toHaveBeenCalledTimes(2);
    });
});
