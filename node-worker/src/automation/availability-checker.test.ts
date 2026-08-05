import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";

import type { AutomationSession, SessionManager } from "./session-manager";
import type { CheckAvailabilityRequest, NavigationOutcome } from "./site-navigator";
import { checkAvailability } from "./availability-checker";

function fakeSessionManager(session: AutomationSession): SessionManager {
    return {
        activeCount: 1,
        acquire: vi.fn(() => Promise.resolve(session)),
        release: vi.fn(() => Promise.resolve(undefined)),
        closeAll: vi.fn(() => Promise.resolve(undefined)),
    };
}

function fakeSession(): AutomationSession {
    return {
        id: "session-1",
        page: {} as Page,
        newCdpSession: vi.fn(),
    };
}

const request: CheckAvailabilityRequest = {
    province: "Cuenca",
    tramiteLabel: "POLICIA-ASIGNACIÓN DE NIE",
    applicant: {
        documentType: "nie",
        documentId: "X1234567L",
        fullName: "Test Testerson",
        birthYear: 1990,
        nationality: "VENEZUELA",
        email: "test@example.com",
        phone: "600111222",
    },
};

describe("checkAvailability", () => {
    it("releases the session once after a successful check", async () => {
        const session = fakeSession();
        const sessionManager = fakeSessionManager(session);
        const runCheck = vi.fn(() => Promise.resolve<NavigationOutcome>({ type: "post_submit_unconfirmed" }));

        await checkAvailability(request, sessionManager, runCheck);

        expect(sessionManager.release).toHaveBeenCalledTimes(1);
    });

    it("releases the session even when the check throws", async () => {
        const session = fakeSession();
        const sessionManager = fakeSessionManager(session);
        const runCheck = vi.fn(() => Promise.reject(new Error("navigation failed")));

        await expect(checkAvailability(request, sessionManager, runCheck)).rejects.toThrow("navigation failed");
        expect(sessionManager.release).toHaveBeenCalledTimes(1);
    });

    it("returns the resolved outcome unchanged, with no pendingCaptchaSession", async () => {
        const session = fakeSession();
        const sessionManager = fakeSessionManager(session);
        const outcome: NavigationOutcome = { type: "waf_rejected", supportId: "123" };
        const runCheck = vi.fn(() => Promise.resolve(outcome));

        await expect(checkAvailability(request, sessionManager, runCheck)).resolves.toEqual({ outcome });
    });

    it("releases the exact session that was acquired", async () => {
        const session = fakeSession();
        const sessionManager = fakeSessionManager(session);
        const runCheck = vi.fn(() => Promise.resolve<NavigationOutcome>({ type: "post_submit_unconfirmed" }));

        await checkAvailability(request, sessionManager, runCheck);

        expect(sessionManager.release).toHaveBeenCalledWith(session);
    });

    it("passes the acquired session's page and the request through to runCheck", async () => {
        const session = fakeSession();
        const sessionManager = fakeSessionManager(session);
        const runCheck = vi.fn(() => Promise.resolve<NavigationOutcome>({ type: "post_submit_unconfirmed" }));

        await checkAvailability(request, sessionManager, runCheck);

        expect(runCheck).toHaveBeenCalledWith(session.page, request);
    });

    it("does NOT release the session for a captcha_blocked_slots_offered outcome, and returns it as pendingCaptchaSession", async () => {
        const session = fakeSession();
        const sessionManager = fakeSessionManager(session);
        const outcome: NavigationOutcome = { type: "captcha_blocked_slots_offered", slots: [{ day: "10/09/2026", time: "09:30" }] };
        const runCheck = vi.fn(() => Promise.resolve(outcome));

        const result = await checkAvailability(request, sessionManager, runCheck);

        expect(result).toEqual({ outcome, pendingCaptchaSession: session });
        expect(sessionManager.release).not.toHaveBeenCalled();
    });
});
