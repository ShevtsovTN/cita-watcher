/**
 * Composition root: constructs `automation/`/`captcha/`/`messaging/` instances behind their own
 * interfaces (per node-worker/CLAUDE.md's dependency-inversion convention) and starts the things
 * that make this an actual running worker — the Redis command consumer, the WS screencast relay
 * server, and (Phase 5) the health-check HTTP server (see ../../docs/NODE_WORKER_ROADMAP.md
 * Phase 4/5).
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
import { HttpHealthServer } from "./health-server";
import { logger } from "./logger";
import type { WorkerCommandHandler } from "./messaging";
import { RedisCommandConsumer, RedisEventPublisher, createWorkerCommandHandler } from "./messaging";

/**
 * Top-level safety net (Phase 4 checklist: "one failed session doesn't crash the process"). By
 * Phase 5, `createWorkerCommandHandler` already catches and reports most failures itself (see its
 * own docblock) — this is now only a net for what even that can't catch, e.g.
 * `eventPublisher.publish()` itself throwing because Redis is unreachable.
 */
function withErrorHandling(handler: WorkerCommandHandler): WorkerCommandHandler {
    return async (command) => {
        try {
            await handler(command);
        } catch (error) {
            logger.error("command handler threw past its own error handling", {
                command_id: command.commandId,
                watch_task_id: command.watchTaskId,
                reason: error instanceof Error ? error.message : String(error),
            });
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
    const sessionLogger = logger.withContext({ session_id: session.id });
    const cdpSession = await session.newCdpSession();
    const frameRelay = new CdpScreencastFrameRelay(cdpSession, socket);
    const inputRelay = new CdpInputRelay(cdpSession, socket, () => {
        sessionLogger.info("resolved signal received — no automation pause point exists yet to resume (see roadmap Phase 2/4 notes)");
    });

    await frameRelay.start();
    inputRelay.start();
    sessionLogger.info("captcha relay bound to WS connection");

    await new Promise<void>((resolve) => {
        socket.once("close", () => {
            inputRelay.stop();
            void frameRelay.stop();
            sessionLogger.info("captcha relay connection closed");
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
                logger.error("captcha relay failed", {
                    session_id: session.id,
                    reason: error instanceof Error ? error.message : String(error),
                });
            })
            .finally(() => {
                openSockets.delete(socket);
            });
    };

    const screencastRelay = new WsScreencastRelay(
        config.cdpRelay.port,
        bindConnectionToRegisteredSession(captchaRegistry, onBound),
    );

    /**
     * Phase 5 health signal: cheap and synchronous on purpose (see health-server.ts's docblock) —
     * just "are both Redis connections up", not a deep check of browser/session state (nothing in
     * `SessionManager`'s interface exposes that today, and inventing new API surface on an
     * already-tested Phase 1 module just for this wasn't this phase's job).
     */
    const healthServer = new HttpHealthServer(
        config.health.port,
        () => commandRedis.status === "ready" && eventRedis.status === "ready",
    );

    commandConsumer.start();
    screencastRelay.start();
    healthServer.start();
    logger.info("started", {
        commands_list: `${config.redis.keyPrefix}watcher-commands`,
        ws_relay_port: config.cdpRelay.port,
        health_port: config.health.port,
    });

    let shuttingDown = false;
    const shutdown = (signal: NodeJS.Signals): void => {
        if (shuttingDown) {
            return;
        }
        shuttingDown = true;

        logger.info("received shutdown signal", { signal });
        void (async () => {
            try {
                await commandConsumer.stop();
                for (const socket of openSockets) {
                    socket.close();
                }
                await Promise.all([screencastRelay.stop(), healthServer.stop()]);
                await sessionManager.closeAll();
                await Promise.all([commandRedis.quit(), eventRedis.quit()]);
            } catch (error) {
                logger.error("error during shutdown", { reason: error instanceof Error ? error.message : String(error) });
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
    logger.error("unhandled rejection", { reason: reason instanceof Error ? reason.message : String(reason) });
});
process.on("uncaughtException", (error) => {
    logger.error("uncaught exception", { reason: error.message });
});

try {
    main();
} catch (error) {
    logger.error("fatal startup error", { reason: error instanceof Error ? error.message : String(error) });
    process.exit(1);
}
