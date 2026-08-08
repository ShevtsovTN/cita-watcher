import { describe, expect, it, vi } from "vitest";
import type { Page } from "playwright";
import type { AutomationSession, NavigationOutcome, SessionManager } from "../automation";
import { buildCitarUrl, resolveProvinceRoute } from "../automation";
import { InMemoryCaptchaSessionRegistry } from "../captcha";
import type { CaptchaSessionRegistry } from "../captcha";
import type { Logger, LogContext } from "../logger";
import type { SessionToken } from "../session-token";
import type { CaptchaRequiredEvent, CheckFailedEvent, WorkerCommand, WorkerEvent } from "../types";

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

/** `on: vi.fn()` matters here: `checkAvailability` now always wires up `attachRemoteResponseLogging` for the real `commandLogger` this handler passes it (see `../automation/remote-response-logger.ts`), which calls `page.on(...)` before `runCheck` ever touches the page. */
function fakeSession(page: Page = { on: vi.fn() } as unknown as Page): AutomationSession {
    return { id: "session-1", page, newCdpSession: vi.fn() };
}

/** Minimal `Page` fake covering what `classifyPostResolutionOutcome` reads (`locator("body").innerText()`, `url()`) plus `on()` for `attachRemoteResponseLogging` — this is the same page object `checkAvailability` wires logging onto. */
function fakePostResolutionPage(url: string, bodyText = ""): Page {
    return {
        locator: vi.fn(() => ({ innerText: vi.fn(() => Promise.resolve(bodyText)) })),
        url: vi.fn(() => url),
        on: vi.fn(),
    } as unknown as Page;
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

/** Never actually touched by the non-captcha-outcome tests below — just satisfies the required dep. */
function fakeCaptchaRegistry(): CaptchaSessionRegistry {
    return {
        register: vi.fn(),
        resolve: vi.fn(() => undefined),
        notifyResolved: vi.fn(),
        unregister: vi.fn(),
    };
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

/** Flushes every microtask queued so far (Node macrotasks always run after the whole pending microtask queue drains) — used to let a paused captcha-branch handler reach its `scheduleTimeout`/`registry.register` calls before the test inspects/drives it further. */
function flushMicrotasks(): Promise<void> {
    return new Promise((resolve) => {
        setImmediate(resolve);
    });
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
        const handler = createWorkerCommandHandler({
            sessionManager,
            eventPublisher: publisher,
            captchaRegistry: fakeCaptchaRegistry(),
            now: () => new Date("2026-08-05T00:00:00Z"),
            runCheck,
        });

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
        const handler = createWorkerCommandHandler({
            sessionManager,
            eventPublisher: publisher,
            captchaRegistry: fakeCaptchaRegistry(),
            now: () => new Date("2026-08-05T00:00:00Z"),
            runCheck,
        });

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
        const handler = createWorkerCommandHandler({
            sessionManager,
            eventPublisher: publisher,
            captchaRegistry: fakeCaptchaRegistry(),
            now: () => new Date(),
            runCheck,
        });

        await handler(COMMAND);

        expect(sessionManager.release).toHaveBeenCalledWith(session);
    });

    it("defaults now() to the real clock", async () => {
        const sessionManager = fakeSessionManager(fakeSession());
        const { publisher, published } = fakeEventPublisher();
        const runCheck = vi.fn(() => Promise.resolve<NavigationOutcome>({ type: "post_submit_unconfirmed" }));
        const handler = createWorkerCommandHandler({
            sessionManager,
            eventPublisher: publisher,
            captchaRegistry: fakeCaptchaRegistry(),
            runCheck,
        });

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
        const handler = createWorkerCommandHandler({
            sessionManager,
            eventPublisher: publisher,
            captchaRegistry: fakeCaptchaRegistry(),
            now: () => new Date("2026-08-05T00:00:00Z"),
            runCheck,
        });

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
        const handler = createWorkerCommandHandler({
            sessionManager,
            eventPublisher: publisher,
            captchaRegistry: fakeCaptchaRegistry(),
            now: () => new Date(),
            runCheck,
        });

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
        const handler = createWorkerCommandHandler({
            sessionManager,
            eventPublisher: publisher,
            captchaRegistry: fakeCaptchaRegistry(),
            now: () => new Date("2026-08-05T00:00:00Z"),
            runCheck,
        });

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
        const handler = createWorkerCommandHandler({
            sessionManager,
            eventPublisher: publisher,
            captchaRegistry: fakeCaptchaRegistry(),
            now: () => new Date(),
            runCheck,
            logger,
        });

        await handler(COMMAND);

        const errorCall = calls.find((call) => call.level === "error");
        expect(errorCall?.context).toMatchObject({ command_id: COMMAND.commandId, watch_task_id: 42 });
    });

    it("logs info with command/watch-task correlation after publishing", async () => {
        const sessionManager = fakeSessionManager(fakeSession());
        const { publisher } = fakeEventPublisher();
        const { logger, calls } = fakeLogger();
        const runCheck = vi.fn(() => Promise.resolve<NavigationOutcome>({ type: "waf_rejected", supportId: null }));
        const handler = createWorkerCommandHandler({
            sessionManager,
            eventPublisher: publisher,
            captchaRegistry: fakeCaptchaRegistry(),
            now: () => new Date(),
            runCheck,
            logger,
        });

        await handler(COMMAND);

        const infoCall = calls.find((call) => call.level === "info");
        expect(infoCall?.context).toMatchObject({
            command_id: COMMAND.commandId,
            watch_task_id: 42,
            type: "check_failed",
            retryable: true,
        });
    });

    describe("captcha_blocked_slots_offered", () => {
        function fakeScheduleTimeout(): { scheduleTimeout: (ms: number, cb: () => void) => () => void; fireTimeout: () => void; cancelCalls: number } {
            let capturedCallback: (() => void) | undefined;
            const state = { cancelCalls: 0 };
            const scheduleTimeout = vi.fn((_ms: number, cb: () => void) => {
                capturedCallback = cb;
                return () => {
                    state.cancelCalls += 1;
                };
            });
            return {
                scheduleTimeout,
                fireTimeout: () => {
                    capturedCallback?.();
                },
                get cancelCalls() {
                    return state.cancelCalls;
                },
            };
        }

        it("publishes CaptchaRequiredEvent with a generated sessionToken before the wait settles, without releasing the session yet", async () => {
            const session = fakeSession(fakePostResolutionPage("https://icp.administracionelectronica.gob.es/icpplus/acVerificarCita.html"));
            const sessionManager = fakeSessionManager(session);
            const { publisher, published } = fakeEventPublisher();
            const registry = new InMemoryCaptchaSessionRegistry();
            const { scheduleTimeout } = fakeScheduleTimeout();
            const generateToken = vi.fn((): SessionToken => "fake-token-123");
            const runCheck = vi.fn(() => Promise.resolve<NavigationOutcome>({ type: "captcha_blocked_slots_offered", slots: [] }));
            const handler = createWorkerCommandHandler({
                sessionManager,
                eventPublisher: publisher,
                captchaRegistry: registry,
                now: () => new Date("2026-08-05T00:00:00Z"),
                runCheck,
                generateToken,
                scheduleTimeout,
            });

            const handlerPromise = handler(COMMAND);
            await flushMicrotasks();

            expect(published).toEqual<CaptchaRequiredEvent[]>([
                { type: "captcha_required", watchTaskId: 42, occurredAt: "2026-08-05T00:00:00.000Z", sessionToken: "fake-token-123" },
            ]);
            expect(sessionManager.release).not.toHaveBeenCalled();
            expect(registry.resolve("fake-token-123")).toBe(session);

            registry.notifyResolved("fake-token-123");
            await handlerPromise;
        });

        it("releases the session and unregisters the token once notifyResolved fires, then classifies and publishes the post-resolution page state", async () => {
            const route = resolveProvinceRoute("Madrid");
            if (route === undefined) throw new Error("test fixture expects Madrid to have a confirmed route");
            const session = fakeSession(fakePostResolutionPage(buildCitarUrl(route)));
            const sessionManager = fakeSessionManager(session);
            const { publisher, published } = fakeEventPublisher();
            const registry = new InMemoryCaptchaSessionRegistry();
            const { scheduleTimeout } = fakeScheduleTimeout();
            const generateToken = vi.fn((): SessionToken => "fake-token-123");
            const runCheck = vi.fn(() => Promise.resolve<NavigationOutcome>({ type: "captcha_blocked_slots_offered", slots: [] }));
            const handler = createWorkerCommandHandler({
                sessionManager,
                eventPublisher: publisher,
                captchaRegistry: registry,
                now: () => new Date("2026-08-05T00:00:00Z"),
                runCheck,
                generateToken,
                scheduleTimeout,
            });

            const handlerPromise = handler(COMMAND);
            await flushMicrotasks();
            registry.notifyResolved("fake-token-123");
            await handlerPromise;

            expect(sessionManager.release).toHaveBeenCalledWith(session);
            expect(registry.resolve("fake-token-123")).toBeUndefined();
            expect(published).toEqual<(CaptchaRequiredEvent | CheckFailedEvent)[]>([
                { type: "captcha_required", watchTaskId: 42, occurredAt: "2026-08-05T00:00:00.000Z", sessionToken: "fake-token-123" },
                {
                    type: "check_failed",
                    watchTaskId: 42,
                    reason: "The site's 5-minute reservation window expired before the flow could be completed.",
                    retryable: true,
                    occurredAt: "2026-08-05T00:00:00.000Z",
                },
            ]);
        });

        it("publishes an honest post_submit_unconfirmed-based check_failed when the resolved page state can't be interpreted", async () => {
            const session = fakeSession(
                fakePostResolutionPage("https://icp.administracionelectronica.gob.es/icpplus/acVerificarCita.html"),
            );
            const sessionManager = fakeSessionManager(session);
            const { publisher, published } = fakeEventPublisher();
            const registry = new InMemoryCaptchaSessionRegistry();
            const { scheduleTimeout } = fakeScheduleTimeout();
            const generateToken = vi.fn((): SessionToken => "fake-token-123");
            const runCheck = vi.fn(() => Promise.resolve<NavigationOutcome>({ type: "captcha_blocked_slots_offered", slots: [] }));
            const handler = createWorkerCommandHandler({
                sessionManager,
                eventPublisher: publisher,
                captchaRegistry: registry,
                now: () => new Date("2026-08-05T00:00:00Z"),
                runCheck,
                generateToken,
                scheduleTimeout,
            });

            const handlerPromise = handler(COMMAND);
            await flushMicrotasks();
            registry.notifyResolved("fake-token-123");
            await handlerPromise;

            expect(published).toHaveLength(2);
            expect(published[1]).toMatchObject({ type: "check_failed", retryable: true });
        });

        it("releases the session and unregisters the token on timeout, publishing nothing further", async () => {
            const session = fakeSession();
            const sessionManager = fakeSessionManager(session);
            const { publisher, published } = fakeEventPublisher();
            const registry = new InMemoryCaptchaSessionRegistry();
            const { scheduleTimeout, fireTimeout } = fakeScheduleTimeout();
            const generateToken = vi.fn((): SessionToken => "fake-token-123");
            const runCheck = vi.fn(() => Promise.resolve<NavigationOutcome>({ type: "captcha_blocked_slots_offered", slots: [] }));
            const handler = createWorkerCommandHandler({
                sessionManager,
                eventPublisher: publisher,
                captchaRegistry: registry,
                now: () => new Date("2026-08-05T00:00:00Z"),
                runCheck,
                generateToken,
                scheduleTimeout,
            });

            const handlerPromise = handler(COMMAND);
            await flushMicrotasks();
            fireTimeout();
            await handlerPromise;

            expect(sessionManager.release).toHaveBeenCalledWith(session);
            expect(registry.resolve("fake-token-123")).toBeUndefined();
            expect(published).toHaveLength(1);
        });

        it("cancels the timeout once notifyResolved wins, so it can never also fire", async () => {
            const sessionManager = fakeSessionManager(
                fakeSession(fakePostResolutionPage("https://icp.administracionelectronica.gob.es/icpplus/acVerificarCita.html")),
            );
            const { publisher } = fakeEventPublisher();
            const registry = new InMemoryCaptchaSessionRegistry();
            const timeoutHelper = fakeScheduleTimeout();
            const generateToken = vi.fn((): SessionToken => "fake-token-123");
            const runCheck = vi.fn(() => Promise.resolve<NavigationOutcome>({ type: "captcha_blocked_slots_offered", slots: [] }));
            const handler = createWorkerCommandHandler({
                sessionManager,
                eventPublisher: publisher,
                captchaRegistry: registry,
                now: () => new Date("2026-08-05T00:00:00Z"),
                runCheck,
                generateToken,
                scheduleTimeout: timeoutHelper.scheduleTimeout,
            });

            const handlerPromise = handler(COMMAND);
            await flushMicrotasks();
            registry.notifyResolved("fake-token-123");
            await handlerPromise;

            expect(timeoutHelper.cancelCalls).toBe(1);
        });
    });
});
