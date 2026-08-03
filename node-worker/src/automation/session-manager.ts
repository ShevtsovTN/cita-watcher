/**
 * Менеджер жизненного цикла Playwright-браузера/сессий (см. ../../docs/NODE_WORKER_ROADMAP.md
 * Phase 1, первый пункт чек-листа). Отвечает только за выдачу/учёт изолированных браузерных
 * сессий с гвардом по `config.maxConcurrentSessions` и за CDP-доступ к каждой из них — именно
 * этот CDP-доступ (`AutomationSession.newCdpSession()`) понадобится `captcha/` (Phase 2) для
 * screencast/input relay. Навигация по реальному сайту и обнаружение капчи (Phase 1, пункты 2-3)
 * сюда не входят: это требует эмпирического изучения реального DOM
 * `sede.administracionespublicas.gob.es`, а не типов/интерфейсов, поэтому вынесено в отдельный
 * шаг (см. роадмап).
 */

import { randomUUID } from "node:crypto";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright";

/** Одна выданная браузерная сессия: изолированный `BrowserContext` + его единственная `Page`. */
export interface AutomationSession {
    readonly id: string;
    readonly page: Page;
    /** Живая CDP-сессия для этой страницы — то, чем `captcha/` (Phase 2) будет пользоваться для screencast/input relay. */
    newCdpSession(): Promise<CDPSession>;
}

export interface SessionManager {
    readonly activeCount: number;
    acquire(): Promise<AutomationSession>;
    release(session: AutomationSession): Promise<void>;
    /** Закрывает браузер и все текущие сессии — для graceful shutdown (Phase 4). */
    closeAll(): Promise<void>;
}

export class SessionLimitExceededError extends Error {
    public constructor(limit: number) {
        super(`Cannot acquire a new session: the concurrency limit of ${String(limit)} is already in use`);
        this.name = "SessionLimitExceededError";
    }
}

type BrowserLauncher = () => Promise<Browser>;

const defaultLauncher: BrowserLauncher = () => chromium.launch({ headless: true });

export class PlaywrightSessionManager implements SessionManager {
    /**
     * Id резервируется синхронно, до первого `await` в `acquire()` — единственный способ сделать
     * гвард по `maxConcurrentSessions` атомарным при параллельных вызовах `acquire()` (иначе два
     * конкурентных вызова оба проходят проверку `size >= max`, пока ни один ещё не увеличил счётчик,
     * и лимит не удержит их).
     */
    private readonly reservedIds = new Set<string>();
    private readonly contexts = new Map<string, BrowserContext>();
    private browser: Browser | undefined;
    private browserPromise: Promise<Browser> | undefined;

    public constructor(
        private readonly maxConcurrentSessions: number,
        private readonly launchBrowser: BrowserLauncher = defaultLauncher,
    ) {}

    public get activeCount(): number {
        return this.reservedIds.size;
    }

    public async acquire(): Promise<AutomationSession> {
        if (this.reservedIds.size >= this.maxConcurrentSessions) {
            throw new SessionLimitExceededError(this.maxConcurrentSessions);
        }

        const id = randomUUID();
        this.reservedIds.add(id);

        try {
            const browser = await this.ensureBrowser();
            const context = await browser.newContext();
            const page = await context.newPage();

            this.contexts.set(id, context);

            return {
                id,
                page,
                newCdpSession: () => context.newCDPSession(page),
            };
        } catch (error) {
            this.reservedIds.delete(id);
            throw error;
        }
    }

    public async release(session: AutomationSession): Promise<void> {
        const context = this.contexts.get(session.id);

        this.reservedIds.delete(session.id);
        this.contexts.delete(session.id);

        if (context !== undefined) {
            await context.close();
        }
    }

    public async closeAll(): Promise<void> {
        const contexts = [...this.contexts.values()];
        this.reservedIds.clear();
        this.contexts.clear();

        await Promise.all(contexts.map((context) => context.close()));

        if (this.browser !== undefined) {
            const browser = this.browser;
            this.browser = undefined;
            this.browserPromise = undefined;
            await browser.close();
        }
    }

    private async ensureBrowser(): Promise<Browser> {
        if (this.browser !== undefined) {
            return this.browser;
        }

        this.browserPromise ??= this.launchBrowser();
        const browser = await this.browserPromise;

        this.browser = browser;
        browser.on("disconnected", () => {
            this.handleBrowserDisconnected();
        });

        return browser;
    }

    /** Браузер упал/был убит вне нашего контроля — все выданные сессии всё равно мертвы. */
    private handleBrowserDisconnected(): void {
        this.reservedIds.clear();
        this.contexts.clear();
        this.browser = undefined;
        this.browserPromise = undefined;
    }
}
