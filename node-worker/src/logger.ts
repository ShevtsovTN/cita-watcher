/**
 * Structured-ish logging with persistent correlation context — the node-worker side of
 * ../../docs/NODE_WORKER_ROADMAP.md Phase 5's "structured logging (correlate logs by
 * session/command id)". Mirrors the Laravel side's `Log::withContext([...])` pattern (see
 * `../../application/app/Infrastructure/Watcher/Messaging/RedisWorkerGateway.php`'s own docblock:
 * "purely for correlation — grepping one WatchTask's or one command's journey across this log
 * and, eventually, node-worker's own logs") closely enough to actually serve that purpose:
 * `withContext()` binds `command_id`/`watch_task_id`/etc. once and every subsequent call carries
 * it, same idea as `Log::withContext()`.
 *
 * Field names deliberately match Laravel's log CONTEXT keys — snake_case `command_id`/
 * `watch_task_id` — even though the wire JSON (`WorkerCommand`/`WorkerEvent`) stays camelCase;
 * this module is log output only, never wire format. Plain `key=value` suffix, not JSON: Laravel's
 * own logging isn't configured for structured JSON either (stock Monolog line formatter, see the
 * Phase 5 roadmap write-up), so there's nothing on the other side to match by parsing JSON —
 * grep-by-field-name across both services' plain-text logs is the actual shared contract.
 */

export type LogContext = Readonly<Record<string, string | number | boolean | undefined>>;

export interface Logger {
    info(message: string, context?: LogContext): void;
    error(message: string, context?: LogContext): void;
    /** Returns a new `Logger` that merges `context` into every subsequent call's context. */
    withContext(context: LogContext): Logger;
}

function formatContext(context: LogContext): string {
    const parts = Object.entries(context)
        .filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
        .map(([key, value]) => `${key}=${String(value)}`);

    return parts.length === 0 ? "" : ` ${parts.join(" ")}`;
}

class ConsoleLogger implements Logger {
    public constructor(private readonly baseContext: LogContext = {}) {}

    public info(message: string, context: LogContext = {}): void {
        console.log(`[node-worker] ${message}${formatContext({ ...this.baseContext, ...context })}`);
    }

    public error(message: string, context: LogContext = {}): void {
        console.error(`[node-worker] ${message}${formatContext({ ...this.baseContext, ...context })}`);
    }

    public withContext(context: LogContext): Logger {
        return new ConsoleLogger({ ...this.baseContext, ...context });
    }
}

/** Ready-to-use singleton, same pattern as `./config`'s `config`. */
export const logger: Logger = new ConsoleLogger();
