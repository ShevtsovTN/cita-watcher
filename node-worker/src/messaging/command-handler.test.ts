import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import type { AutomationSession, NavigationOutcome, SessionManager } from "../automation";
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
});
