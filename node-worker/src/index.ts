/**
 * Composition root: constructs `automation/`/`captcha/`/`messaging/` instances behind their own
 * interfaces (per node-worker/CLAUDE.md's dependency-inversion convention) and starts the two
 * things that make this an actual running worker — the Redis command consumer and the WS
 * screencast relay server (see ../../docs/NODE_WORKER_ROADMAP.md Phase 4).
 *
 * `CaptchaSessionRegistry.register()` still has no caller anywhere (open since Phase 0/2 — no real
 * captcha has ever been observed, see `automation/site-navigator.ts`'s `PostSubmitUnconfirmed`),
 * so in practice no `/captcha-ws/` connection ever resolves to a registered session yet; `onBound`
 * below is wired and ready for whenever that trigger exists, not exercised end-to-end here. For the
 * same reason, `CdpInputRelay`'s `resolved` signal has no automation-side pause point to actually
 * resume yet — it's logged, not acted on.
 */

import { Redis } from "ioredis";
import type { WebSocket } from "ws";

import type { AutomationSession } from "./automation";
import { PlaywrightSessionManager } from "./automation";
import {
    CdpInputRelay,
    CdpScreencastFrameRelay,
    InMemoryCaptchaSessionRegistry,
    WsScreencastRelay,
    bindConnectionToRegisteredSession,
} from "./captcha";
import { config } from "./config";
import type { WorkerCommandHandler } from "./messaging";
import { RedisCommandConsumer, RedisEventPublisher, createWorkerCommandHandler } from "./messaging";

function logError(context: string, error: unknown): void {
    console.error(`[node-worker] ${context}:`, error);
}

/**
 * Top-level safety net (Phase 4 checklist: "one failed session doesn't crash the process"). Just
 * catches and logs — deciding whether an uncaught failure should still publish a fallback
 * `CheckFailedEvent`, and real structured logging, are Phase 5 ("Hardening & observability").
 */
function withErrorHandling(handler: WorkerCommandHandler): WorkerCommandHandler {
    return async (command) => {
        try {
            await handler(command);
        } catch (error) {
            logError(`command ${command.commandId} (watchTaskId ${String(command.watchTaskId)}) failed`, error);
        }
    };
}

/**
 * Pipes CDP screencast frames to the socket and remote input back to CDP for one bound captcha
 * session — the glue `screencast-frame-relay.ts`/`input-relay.ts`'s own docblocks deferred to
 * "Phase 4 wiring, ещё не существует". Resolves once the socket closes, so the caller can track
 * connection lifetime for graceful shutdown.
 */
async function relayCaptchaSession(session: AutomationSession, socket: WebSocket): Promise<void> {
    const cdpSession = await session.newCdpSession();
    const frameRelay = new CdpScreencastFrameRelay(cdpSession, socket);
    const inputRelay = new CdpInputRelay(cdpSession, socket, () => {
        console.log(
            `[node-worker] resolved signal for session ${session.id} — no automation pause point exists yet to resume (see roadmap Phase 2/4 notes)`,
        );
    });

    await frameRelay.start();
    inputRelay.start();

    await new Promise<void>((resolve) => {
        socket.once("close", () => {
            inputRelay.stop();
            void frameRelay.stop();
            resolve();
        });
    });
}

function main(): void {
    const sessionManager = new PlaywrightSessionManager(config.maxConcurrentSessions);

    /** `BRPOP` blocks its connection for up to a second at a time, so the consumer needs a
     * dedicated client — sharing one with `PUBLISH` would queue publishes behind every poll. */
    const commandRedis = new Redis({ host: config.redis.host, port: config.redis.port });
    const eventRedis = new Redis({ host: config.redis.host, port: config.redis.port });

    const eventPublisher = new RedisEventPublisher(eventRedis, config.redis.keyPrefix);
    const commandConsumer = new RedisCommandConsumer(
        commandRedis,
        config.redis.keyPrefix,
        config.maxConcurrentSessions,
        withErrorHandling(createWorkerCommandHandler(sessionManager, eventPublisher)),
    );

    const captchaRegistry = new InMemoryCaptchaSessionRegistry();
    const openSockets = new Set<WebSocket>();

    const onBound = (session: AutomationSession, socket: WebSocket): void => {
        openSockets.add(socket);
        void relayCaptchaSession(session, socket)
            .catch((error: unknown) => {
                logError(`captcha relay for session ${session.id} failed`, error);
            })
            .finally(() => {
                openSockets.delete(socket);
            });
    };

    const screencastRelay = new WsScreencastRelay(
        config.cdpRelay.port,
        bindConnectionToRegisteredSession(captchaRegistry, onBound),
    );

    commandConsumer.start();
    screencastRelay.start();
    console.log(
        `[node-worker] started: command consumer on "${config.redis.keyPrefix}watcher-commands", WS relay on :${String(config.cdpRelay.port)}`,
    );

    let shuttingDown = false;
    const shutdown = (signal: NodeJS.Signals): void => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;

        console.log(`[node-worker] received ${signal}, shutting down...`);
        void (async () => {
            try {
                await commandConsumer.stop();
                for (const socket of openSockets) {
                    socket.close();
                }
                await screencastRelay.stop();
                await sessionManager.closeAll();
                await Promise.all([commandRedis.quit(), eventRedis.quit()]);
            } catch (error) {
                logError("error during shutdown", error);
            } finally {
                process.exit(0);
            }
        })();
    };

    process.once("SIGTERM", () => {
        shutdown("SIGTERM");
    });
    process.once("SIGINT", () => {
        shutdown("SIGINT");
    });
}

process.on("unhandledRejection", (reason) => {
    logError("unhandled rejection", reason);
});
process.on("uncaughtException", (error) => {
    logError("uncaught exception", error);
});

try {
    main();
} catch (error) {
    logError("fatal startup error", error);
    process.exit(1);
}
