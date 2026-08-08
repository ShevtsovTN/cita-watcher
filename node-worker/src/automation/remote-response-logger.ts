/**
 * Logs what the real target site actually returns during a check — HTTP status per navigation,
 * uncaught page-JS errors, and browser console errors/warnings. Grew out of a real, ad hoc live
 * debugging session (2026-08-08) against `icp.administracionelectronica.gob.es`: the site's bot
 * defense (F5/TSPD) started serving a JS challenge page that failed to resolve in our environment
 * (`PAGEERROR: __name is not defined`), and without response/console/pageerror visibility, that
 * showed up as nothing more than "the applicant form never appeared" — no way to tell a broken
 * challenge apart from a WAF block, a Cl@ve redirect, or a genuinely slow page from the log alone.
 *
 * Filtered to the target site's own hostname(s), not every request the page makes — CDN assets,
 * Google Analytics, and Dynatrace RUM beacons the real page loads are noise for this purpose; what
 * matters is what the target origin itself is handing back.
 */
import type { ConsoleMessage, Page } from "playwright";

import type { Logger } from "../logger";

export interface RemoteResponseLoggerOptions {
    /** Defaults to the one real target hostname every `ProvinceRoute` in `./province-routes.ts` resolves to. */
    readonly hostnames?: readonly string[];
}

const DEFAULT_TARGET_HOSTNAMES: readonly string[] = ["icp.administracionelectronica.gob.es"];

function isTargetUrl(url: string, hostnames: readonly string[]): boolean {
    try {
        return hostnames.includes(new URL(url).hostname);
    } catch {
        return false;
    }
}

/**
 * Attaches `response`/`pageerror`/`console` listeners for the lifetime of `page` — there's no
 * matching `detach`, same as `input-relay.ts`'s CDP listeners: it lives and dies with the page/
 * session, not something a caller tears down mid-check.
 */
export function attachRemoteResponseLogging(page: Page, logger: Logger, options: RemoteResponseLoggerOptions = {}): void {
    const hostnames = options.hostnames ?? DEFAULT_TARGET_HOSTNAMES;

    page.on("response", (response) => {
        const url = response.url();
        if (!isTargetUrl(url, hostnames)) return;

        const status = response.status();
        const message = `remote response ${String(status)}`;
        if (status >= 400) {
            logger.error(message, { url });
        } else {
            logger.info(message, { url });
        }
    });

    page.on("pageerror", (error) => {
        logger.error("remote page uncaught JS error", { message: error.message });
    });

    page.on("console", (consoleMessage: ConsoleMessage) => {
        const type = consoleMessage.type();
        if (type !== "error" && type !== "warning") return;
        logger.error(`remote page console ${type}`, { text: consoleMessage.text() });
    });
}
