import { describe, expect, it, vi } from "vitest";
import type { Browser, BrowserContext, CDPSession, Page } from "playwright";

import { PlaywrightSessionManager, SessionLimitExceededError } from "./session-manager";

function fakeContext(): BrowserContext {
    const page = {} as Page;
    const cdpSession = {} as CDPSession;

    return {
        newPage: vi.fn(() => Promise.resolve(page)),
        close: vi.fn(() => Promise.resolve(undefined)),
        newCDPSession: vi.fn(() => Promise.resolve(cdpSession)),
        addInitScript: vi.fn(() => Promise.resolve(undefined)),
    } as unknown as BrowserContext;
}

function fakeBrowser(): { browser: Browser; emitDisconnected: () => void; contexts: BrowserContext[] } {
    const contexts: BrowserContext[] = [];
    let disconnectedHandler: (() => void) | undefined;

    const browser = {
        newContext: vi.fn(() => {
            const context = fakeContext();
            contexts.push(context);
            return Promise.resolve(context);
        }),
        close: vi.fn(() => Promise.resolve(undefined)),
        on: vi.fn((event: string, handler: () => void) => {
            if (event === "disconnected") {
                disconnectedHandler = handler;
            }
        }),
    } as unknown as Browser;

    return {
        browser,
        contexts,
        emitDisconnected: () => disconnectedHandler?.(),
    };
}

describe("PlaywrightSessionManager", () => {
    it("launches the browser lazily, once, and reuses it across acquisitions", async () => {
        const { browser } = fakeBrowser();
        const launchBrowser = vi.fn(() => Promise.resolve(browser));
        const manager = new PlaywrightSessionManager(3, launchBrowser);

        expect(launchBrowser).not.toHaveBeenCalled();

        await manager.acquire();
        await manager.acquire();

        expect(launchBrowser).toHaveBeenCalledTimes(1);
        expect(manager.activeCount).toBe(2);
    });

    it("assigns each session a distinct id and its own context/page", async () => {
        const { browser } = fakeBrowser();
        const manager = new PlaywrightSessionManager(3, () => Promise.resolve(browser));

        const first = await manager.acquire();
        const second = await manager.acquire();

        expect(first.id).not.toBe(second.id);
        expect(first.page).not.toBe(second.page);
    });

    it("throws SessionLimitExceededError once maxConcurrentSessions is in use", async () => {
        const { browser } = fakeBrowser();
        const manager = new PlaywrightSessionManager(1, () => Promise.resolve(browser));

        await manager.acquire();

        await expect(manager.acquire()).rejects.toThrow(SessionLimitExceededError);
        expect(manager.activeCount).toBe(1);
    });

    it("allows acquiring again after releasing a session", async () => {
        const { browser } = fakeBrowser();
        const manager = new PlaywrightSessionManager(1, () => Promise.resolve(browser));

        const session = await manager.acquire();
        await manager.release(session);

        expect(manager.activeCount).toBe(0);
        await expect(manager.acquire()).resolves.toBeDefined();
    });

    it("closes the session's context on release", async () => {
        const { browser, contexts } = fakeBrowser();
        const manager = new PlaywrightSessionManager(3, () => Promise.resolve(browser));

        const session = await manager.acquire();
        await manager.release(session);

        expect(contexts[0]?.close).toHaveBeenCalledTimes(1);
    });

    it("release is a no-op for an unknown/already-released session", async () => {
        const { browser } = fakeBrowser();
        const manager = new PlaywrightSessionManager(3, () => Promise.resolve(browser));

        const session = await manager.acquire();
        await manager.release(session);

        await expect(manager.release(session)).resolves.toBeUndefined();
    });

    it("creates each context with a non-headless-Chromium User-Agent and patches navigator.webdriver", async () => {
        const { browser, contexts } = fakeBrowser();
        const manager = new PlaywrightSessionManager(3, () => Promise.resolve(browser));

        await manager.acquire();

        expect(browser.newContext).toHaveBeenCalledWith(
            expect.objectContaining({ userAgent: expect.not.stringContaining("HeadlessChrome") as string }),
        );
        expect(contexts[0]?.addInitScript).toHaveBeenCalledTimes(1);
    });

    it("exposes a CDP session for the page", async () => {
        const { browser, contexts } = fakeBrowser();
        const manager = new PlaywrightSessionManager(3, () => Promise.resolve(browser));

        const session = await manager.acquire();
        await session.newCdpSession();

        expect(contexts[0]?.newCDPSession).toHaveBeenCalledTimes(1);
    });

    it("closeAll closes every open context and the browser, resetting activeCount", async () => {
        const { browser, contexts } = fakeBrowser();
        const manager = new PlaywrightSessionManager(3, () => Promise.resolve(browser));

        await manager.acquire();
        await manager.acquire();
        await manager.closeAll();

        expect(contexts.every((context) => vi.mocked(context.close).mock.calls.length === 1)).toBe(true);
        expect(browser.close).toHaveBeenCalledTimes(1);
        expect(manager.activeCount).toBe(0);
    });

    it("clears all sessions when the browser disconnects unexpectedly", async () => {
        const { browser, emitDisconnected } = fakeBrowser();
        const manager = new PlaywrightSessionManager(3, () => Promise.resolve(browser));

        await manager.acquire();
        await manager.acquire();
        emitDisconnected();

        expect(manager.activeCount).toBe(0);
    });

    it("relaunches the browser after a disconnect", async () => {
        const first = fakeBrowser();
        const second = fakeBrowser();
        const launchBrowser = vi.fn().mockResolvedValueOnce(first.browser).mockResolvedValueOnce(second.browser);
        const manager = new PlaywrightSessionManager(3, launchBrowser);

        await manager.acquire();
        first.emitDisconnected();
        await manager.acquire();

        expect(launchBrowser).toHaveBeenCalledTimes(2);
    });
});
