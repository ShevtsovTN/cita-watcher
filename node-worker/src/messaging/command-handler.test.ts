import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import type { AutomationSession, NavigationOutcome, SessionManager } from "../automation";
import type { Logger, LogContext } from "../logger";
import type { CheckFailedEvent, WorkerCommand, WorkerEvent } from "../types";

import { createWorkerCommandHandler } from "./command-handler";
import type { EventPublisher } from "./redis-event-publisher";

function fakeSessionManager(session: AutomationSession): SessionManager {
    return {
        activeCount: 1,
        acquire: vi.fn(() => Promise.resolve(session)),
        release: vi.fn(() => Promise.resolve(undefined)),
        closeAll: vi.fn(() => Promise.resolve(undefined)),
    };
}

function fakeSession(): AutomationSession {
    return { id: "session-1", page: {} as Page, newCdpSession: vi.fn() };
}

function fakeEventPublisher(): { publisher: EventPublisher; published: WorkerEvent[] } {
    const published: WorkerEvent[] = [];
    const publisher: EventPublisher = {
        publish: vi.fn((event: WorkerEvent) => {
            published.push(event);
            return Promise.resolve();
        }),
    };

    return { publisher, published };
}

interface LoggedCall {
    readonly level: "info" | "error";
    readonly message: string;
    readonly context: LogContext | undefined;
}

function fakeLogger(): { logger: Logger; calls: LoggedCall[] } {
    const calls: LoggedCall[] = [];

    const build = (base: LogContext): Logger => ({
        info: (message, context) => {
            calls.push({ level: "info", message, context: { ...base, ...context } });
        },
        error: (message, context) => {
            calls.push({ level: "error", message, context: { ...base, ...context } });
        },
        withContext: (context) => build({ ...base, ...context }),
    });

    return { logger: build({}), calls };
}

const COMMAND: WorkerCommand = {
    commandId: "b4a1e0e0-0000-4000-8000-000000000000",
    type: "check_availability",
    watchTaskId: 42,
    procedure: { province: "Madrid", tramiteCode: "POLICIA-ASIGNACIÓN DE NIE" },
    applicant: {
        fullName: "Jane Doe",
        documentType: "nie",
        documentId: "X1234567L",
        email: "jane@example.test",
        phone: null,
        birthYear: 1990,
        nationality: "VENEZUELA",
    },
};

describe("createWorkerCommandHandler", () => {
    it("runs checkAvailability with province/tramiteLabel(=tramiteCode)/applicant mapped from the command", async () => {
        const session = fakeSession();
        const sessionManager = fakeSessionManager(session);
        const { publisher } = fakeEventPublisher();
        const runCheck = vi.fn(() => Promise.resolve<NavigationOutcome>({ type: "post_submit_unconfirmed" }));
        const handler = createWorkerCommandHandler(sessionManager, publisher, () => new Date("2026-08-05T00:00:00Z"), runCheck);

        await handler(COMMAND);

        expect(runCheck).toHaveBeenCalledWith(session.page, {
            province: "Madrid",
            tramiteLabel: "POLICIA-ASIGNACIÓN DE NIE",
            applicant: COMMAND.applicant,
        });
    });

    it("publishes the mapped CheckFailedEvent for the resolved outcome", async () => {
        const sessionManager = fakeSessionManager(fakeSession());
        const { publisher, published } = fakeEventPublisher();
        const runCheck = vi.fn(() => Promise.resolve<NavigationOutcome>({ type: "requires_clave" }));
        const handler = createWorkerCommandHandler(sessionManager, publisher, () => new Date("2026-08-05T00:00:00Z"), runCheck);

        await handler(COMMAND);

        expect(published).toEqual<CheckFailedEvent[]>([
            {
                type: "check_failed",
                watchTaskId: 42,
                reason: "This trámite requires Cl@ve authentication, which the automated flow cannot complete.",
                retryable: false,
                occurredAt: "2026-08-05T00:00:00.000Z",
            },
        ]);
    });

    it("releases the session after the check completes", async () => {
        const session = fakeSession();
        const sessionManager = fakeSessionManager(session);
        const { publisher } = fakeEventPublisher();
        const runCheck = vi.fn(() => Promise.resolve<NavigationOutcome>({ type: "post_submit_unconfirmed" }));
        const handler = createWorkerCommandHandler(sessionManager, publisher, () => new Date(), runCheck);

        await handler(COMMAND);

        expect(sessionManager.release).toHaveBeenCalledWith(session);
    });

    it("defaults now() to the real clock", async () => {
        const sessionManager = fakeSessionManager(fakeSession());
        const { publisher, published } = fakeEventPublisher();
        const runCheck = vi.fn(() => Promise.resolve<NavigationOutcome>({ type: "post_submit_unconfirmed" }));
        const handler = createWorkerCommandHandler(sessionManager, publisher, undefined, runCheck);

        const before = Date.now();
        await handler(COMMAND);
        const after = Date.now();

        const [event] = published;
        if (event?.type !== "check_failed") {
            throw new Error("expected a check_failed event");
        }
        const occurredAtMs = new Date(event.occurredAt).getTime();
        expect(occurredAtMs).toBeGreaterThanOrEqual(before);
        expect(occurredAtMs).toBeLessThanOrEqual(after);
    });

    it("publishes a retryable check_failed event when checkAvailability throws", async () => {
        const session = fakeSession();
        const sessionManager = fakeSessionManager(session);
        const { publisher, published } = fakeEventPublisher();
        const runCheck = vi.fn(() => Promise.reject(new Error("net::ERR_CONNECTION_RESET")));
        const handler = createWorkerCommandHandler(sessionManager, publisher, () => new Date("2026-08-05T00:00:00Z"), runCheck);

        await handler(COMMAND);

        expect(published).toEqual<CheckFailedEvent[]>([
            {
                type: "check_failed",
                watchTaskId: 42,
                reason: "Unexpected error: net::ERR_CONNECTION_RESET",
                retryable: true,
                occurredAt: "2026-08-05T00:00:00.000Z",
            },
        ]);
    });

    it("still releases the session when checkAvailability throws", async () => {
        const session = fakeSession();
        const sessionManager = fakeSessionManager(session);
        const { publisher } = fakeEventPublisher();
        const runCheck = vi.fn(() => Promise.reject(new Error("crash")));
        const handler = createWorkerCommandHandler(sessionManager, publisher, () => new Date(), runCheck);

        await handler(COMMAND);

        expect(sessionManager.release).toHaveBeenCalledWith(session);
    });

    it("does not reject when checkAvailability throws a non-Error value", async () => {
        const sessionManager = fakeSessionManager(fakeSession());
        const { publisher, published } = fakeEventPublisher();
        const runCheck = vi.fn((): Promise<NavigationOutcome> => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately exercising the non-Error branch of toUnexpectedFailureEvent
            throw "boom";
        });
        const handler = createWorkerCommandHandler(sessionManager, publisher, () => new Date("2026-08-05T00:00:00Z"), runCheck);

        await expect(handler(COMMAND)).resolves.toBeUndefined();

        expect(published).toEqual<CheckFailedEvent[]>([
            {
                type: "check_failed",
                watchTaskId: 42,
                reason: "Unexpected error: boom",
                retryable: true,
                occurredAt: "2026-08-05T00:00:00.000Z",
            },
        ]);
    });

    it("logs an error with command/watch-task correlation when checkAvailability throws", async () => {
        const sessionManager = fakeSessionManager(fakeSession());
        const { publisher } = fakeEventPublisher();
        const { logger, calls } = fakeLogger();
        const runCheck = vi.fn(() => Promise.reject(new Error("net::ERR_CONNECTION_RESET")));
        const handler = createWorkerCommandHandler(sessionManager, publisher, () => new Date(), runCheck, logger);

        await handler(COMMAND);

        const errorCall = calls.find((call) => call.level === "error");
        expect(errorCall?.context).toMatchObject({ command_id: COMMAND.commandId, watch_task_id: 42 });
    });

    it("logs info with command/watch-task correlation after publishing", async () => {
        const sessionManager = fakeSessionManager(fakeSession());
        const { publisher } = fakeEventPublisher();
        const { logger, calls } = fakeLogger();
        const runCheck = vi.fn(() => Promise.resolve<NavigationOutcome>({ type: "waf_rejected", supportId: null }));
        const handler = createWorkerCommandHandler(sessionManager, publisher, () => new Date(), runCheck, logger);

        await handler(COMMAND);

        const infoCall = calls.find((call) => call.level === "info");
        expect(infoCall?.context).toMatchObject({
            command_id: COMMAND.commandId,
            watch_task_id: 42,
            type: "check_failed",
            retryable: true,
        });
    });
});
