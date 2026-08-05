import { describe, expect, it } from "vitest";
import type { NavigationOutcome } from "../automation";

import { mapNavigationOutcomeToCheckFailedEvent } from "./outcome-to-event";

const WATCH_TASK_ID = 42;
const OCCURRED_AT = "2026-08-05T00:00:00Z";

describe("mapNavigationOutcomeToCheckFailedEvent", () => {
    it("maps requires_clave to a non-retryable failure", () => {
        const outcome: NavigationOutcome = { type: "requires_clave" };

        const event = mapNavigationOutcomeToCheckFailedEvent(outcome, WATCH_TASK_ID, OCCURRED_AT);

        expect(event).toMatchObject({ type: "check_failed", watchTaskId: WATCH_TASK_ID, retryable: false, occurredAt: OCCURRED_AT });
    });

    it("maps waf_rejected to a retryable failure, including the support id in the reason", () => {
        const outcome: NavigationOutcome = { type: "waf_rejected", supportId: "abc123" };

        const event = mapNavigationOutcomeToCheckFailedEvent(outcome, WATCH_TASK_ID, OCCURRED_AT);

        expect(event.retryable).toBe(true);
        expect(event.reason).toContain("abc123");
    });

    it("maps waf_rejected without a support id to a retryable failure with a generic reason", () => {
        const outcome: NavigationOutcome = { type: "waf_rejected", supportId: null };

        const event = mapNavigationOutcomeToCheckFailedEvent(outcome, WATCH_TASK_ID, OCCURRED_AT);

        expect(event.retryable).toBe(true);
        expect(event.reason).not.toContain("null");
    });

    it("maps validation_rejected to a non-retryable failure using the site's own message", () => {
        const outcome: NavigationOutcome = { type: "validation_rejected", message: "Es incorrecto" };

        const event = mapNavigationOutcomeToCheckFailedEvent(outcome, WATCH_TASK_ID, OCCURRED_AT);

        expect(event.retryable).toBe(false);
        expect(event.reason).toBe("Es incorrecto");
    });

    it("maps post_submit_unconfirmed to a retryable failure", () => {
        const outcome: NavigationOutcome = { type: "post_submit_unconfirmed" };

        const event = mapNavigationOutcomeToCheckFailedEvent(outcome, WATCH_TASK_ID, OCCURRED_AT);

        expect(event.retryable).toBe(true);
    });

    it("always sets type to check_failed and passes through watchTaskId/occurredAt", () => {
        const outcome: NavigationOutcome = { type: "post_submit_unconfirmed" };

        const event = mapNavigationOutcomeToCheckFailedEvent(outcome, 7, "2026-01-01T00:00:00Z");

        expect(event.type).toBe("check_failed");
        expect(event.watchTaskId).toBe(7);
        expect(event.occurredAt).toBe("2026-01-01T00:00:00Z");
    });
});
