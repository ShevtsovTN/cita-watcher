import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "./logger";

describe("logger", () => {
    let logSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
        errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
        logSpy.mockRestore();
        errorSpy.mockRestore();
    });

    it("logs an info message with no context", () => {
        logger.info("worker started");

        expect(logSpy).toHaveBeenCalledWith("[node-worker] worker started");
    });

    it("appends context as key=value pairs", () => {
        logger.info("published worker event", { command_id: "abc-123", watch_task_id: 42 });

        expect(logSpy).toHaveBeenCalledWith("[node-worker] published worker event command_id=abc-123 watch_task_id=42");
    });

    it("omits context keys whose value is undefined", () => {
        logger.info("event", { command_id: "abc-123", reason: undefined });

        expect(logSpy).toHaveBeenCalledWith("[node-worker] event command_id=abc-123");
    });

    it("logs errors on console.error, not console.log", () => {
        logger.error("check failed unexpectedly", { command_id: "abc-123" });

        expect(errorSpy).toHaveBeenCalledWith("[node-worker] check failed unexpectedly command_id=abc-123");
        expect(logSpy).not.toHaveBeenCalled();
    });

    it("withContext binds context onto every subsequent call", () => {
        const scoped = logger.withContext({ command_id: "abc-123", watch_task_id: 42 });

        scoped.info("handled command");
        scoped.error("failed", { reason: "timeout" });

        expect(logSpy).toHaveBeenCalledWith("[node-worker] handled command command_id=abc-123 watch_task_id=42");
        expect(errorSpy).toHaveBeenCalledWith("[node-worker] failed command_id=abc-123 watch_task_id=42 reason=timeout");
    });

    it("withContext does not mutate the parent logger's context", () => {
        const scoped = logger.withContext({ command_id: "abc-123" });
        void scoped;

        logger.info("unrelated message");

        expect(logSpy).toHaveBeenCalledWith("[node-worker] unrelated message");
    });

    it("a call-site context key overrides a bound context key of the same name", () => {
        const scoped = logger.withContext({ watch_task_id: 42 });

        scoped.info("rechecked", { watch_task_id: 99 });

        expect(logSpy).toHaveBeenCalledWith("[node-worker] rechecked watch_task_id=99");
    });
});
