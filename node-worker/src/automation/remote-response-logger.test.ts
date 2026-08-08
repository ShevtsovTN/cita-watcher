import { describe, expect, it, vi } from "vitest";
import type { ConsoleMessage, Page, Response } from "playwright";

import type { Logger, LogContext } from "../logger";
import { attachRemoteResponseLogging } from "./remote-response-logger";

/** Minimal `Page`-shaped fake: just enough `.on()` to capture handlers and fire them by hand. */
function fakePage(): { page: Page; fire: (event: string, payload: unknown) => void } {
    const handlers = new Map<string, (payload: unknown) => void>();
    const page = {
        on: vi.fn((event: string, handler: (payload: unknown) => void) => {
            handlers.set(event, handler);
        }),
    } as unknown as Page;

    return {
        page,
        fire: (event, payload) => {
            const handler = handlers.get(event);
            if (handler === undefined) throw new Error(`no handler registered for "${event}"`);
            handler(payload);
        },
    };
}

function fakeLogger(): { logger: Logger; info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } {
    const info = vi.fn();
    const error = vi.fn();
    const logger: Logger = {
        info: (message: string, context?: LogContext) => {
            info(message, context);
        },
        error: (message: string, context?: LogContext) => {
            error(message, context);
        },
        withContext: () => logger,
    };
    return { logger, info, error };
}

function fakeResponse(url: string, status: number): Response {
    return { url: () => url, status: () => status } as unknown as Response;
}

function fakeConsoleMessage(type: string, text: string): ConsoleMessage {
    return { type: () => type, text: () => text } as unknown as ConsoleMessage;
}

describe("attachRemoteResponseLogging", () => {
    it("logs a target-hostname response under 400 at info level", () => {
        const { page, fire } = fakePage();
        const { logger, info } = fakeLogger();

        attachRemoteResponseLogging(page, logger);
        fire("response", fakeResponse("https://icp.administracionelectronica.gob.es/icpco/citar?p=3", 200));

        expect(info).toHaveBeenCalledWith("remote response 200", { url: "https://icp.administracionelectronica.gob.es/icpco/citar?p=3" });
    });

    it("logs a target-hostname response >= 400 at error level", () => {
        const { page, fire } = fakePage();
        const { logger, error } = fakeLogger();

        attachRemoteResponseLogging(page, logger);
        fire("response", fakeResponse("https://icp.administracionelectronica.gob.es/icpco/selectSede", 403));

        expect(error).toHaveBeenCalledWith("remote response 403", { url: "https://icp.administracionelectronica.gob.es/icpco/selectSede" });
    });

    it("ignores responses from hostnames other than the configured target(s)", () => {
        const { page, fire } = fakePage();
        const { logger, info, error } = fakeLogger();

        attachRemoteResponseLogging(page, logger);
        fire("response", fakeResponse("https://ssl.google-analytics.com/ga.js", 200));

        expect(info).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
    });

    it("respects a custom hostnames list", () => {
        const { page, fire } = fakePage();
        const { logger, info } = fakeLogger();

        attachRemoteResponseLogging(page, logger, { hostnames: ["example.test"] });
        fire("response", fakeResponse("https://example.test/foo", 200));
        fire("response", fakeResponse("https://icp.administracionelectronica.gob.es/icpco/citar", 200));

        expect(info).toHaveBeenCalledTimes(1);
        expect(info).toHaveBeenCalledWith("remote response 200", { url: "https://example.test/foo" });
    });

    it("logs an uncaught page JS error", () => {
        const { page, fire } = fakePage();
        const { logger, error } = fakeLogger();

        attachRemoteResponseLogging(page, logger);
        fire("pageerror", new Error("__name is not defined"));

        expect(error).toHaveBeenCalledWith("remote page uncaught JS error", { message: "__name is not defined" });
    });

    it("logs console errors and warnings but not other console levels", () => {
        const { page, fire } = fakePage();
        const { logger, error } = fakeLogger();

        attachRemoteResponseLogging(page, logger);
        fire("console", fakeConsoleMessage("error", "Failed to load resource"));
        fire("console", fakeConsoleMessage("warning", "Mixed Content"));
        fire("console", fakeConsoleMessage("log", "some debug line"));

        expect(error).toHaveBeenCalledTimes(2);
        expect(error).toHaveBeenCalledWith("remote page console error", { text: "Failed to load resource" });
        expect(error).toHaveBeenCalledWith("remote page console warning", { text: "Mixed Content" });
    });

    it("does not throw for a malformed URL", () => {
        const { page, fire } = fakePage();
        const { logger, info, error } = fakeLogger();

        attachRemoteResponseLogging(page, logger);
        expect(() => {
            fire("response", fakeResponse("not-a-url", 200));
        }).not.toThrow();
        expect(info).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
    });
});
