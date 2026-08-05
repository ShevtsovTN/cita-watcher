/**
 * Типобезопасная загрузка конфигурации воркера из переменных окружения.
 *
 * Дизайн:
 *  - никакого чтения `process.env` за пределами этого модуля — весь остальной
 *    код зависит только от интерфейса `WorkerConfig` (Dependency Inversion);
 *  - конфигурация валидируется один раз при старте процесса и падает сразу
 *    (fail-fast), а не когда до сломанного значения дойдёт очередь в рантайме;
 *  - результат — иммутабельный объект (`Readonly` + `Object.freeze`).
 */

export interface WorkerConfig {
    readonly redis: {
        readonly host: string;
        readonly port: number;
        /**
         * Laravel's redis client prefixes every key/channel with `config('database.redis.options.prefix')`
         * (default `Str::slug(APP_NAME)-database-`) — `watcher-commands`/`watcher-events` are only the
         * *logical* names; the physical ones this repo's default `.env` produces are
         * `laravel-database-watcher-commands`/`laravel-database-watcher-events` (see
         * ../../docs/PHASE9_DRY_RUN.md). `messaging/` must prepend this to both, since ioredis's own
         * `keyPrefix` client option does NOT cover PUBLISH/SUBSCRIBE channel names (only "key" args),
         * unlike Laravel's phpredis client which prefixes both uniformly.
         */
        readonly keyPrefix: string;
    };
    readonly cdpRelay: {
        readonly port: number;
    };
    readonly maxConcurrentSessions: number;
}

export class EnvValidationError extends Error {
    public constructor(variableName: string, reason: string) {
        super(`Invalid environment variable "${variableName}": ${reason}`);
        this.name = "EnvValidationError";
    }
}

type EnvSource = Readonly<Record<string, string | undefined>>;

function requireString(env: EnvSource, name: string, fallback?: string): string {
    const raw = env[name] ?? fallback;

    if (raw === undefined || raw.trim().length === 0) {
        throw new EnvValidationError(name, "is required but was not provided");
    }

    return raw.trim();
}

function parsePort(env: EnvSource, name: string, fallback: number): number {
    const raw = env[name];

    if (raw === undefined || raw.trim().length === 0) {
        return fallback;
    }

    const parsed = Number(raw);

    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
        throw new EnvValidationError(name, `must be an integer between 1 and 65535, got "${raw}"`);
    }

    return parsed;
}

/** В отличие от `requireString`, пустая строка — валидное явное значение (см. `WorkerConfig.redis.keyPrefix`). */
function optionalString(env: EnvSource, name: string, fallback: string): string {
    const raw = env[name];

    return raw === undefined ? fallback : raw;
}

function parsePositiveInt(env: EnvSource, name: string, fallback: number): number {
    const raw = env[name];

    if (raw === undefined || raw.trim().length === 0) {
        return fallback;
    }

    const parsed = Number(raw);

    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new EnvValidationError(name, `must be a positive integer, got "${raw}"`);
    }

    return parsed;
}

/**
 * Собирает и валидирует конфигурацию. По умолчанию читает `process.env`,
 * но принимает произвольный источник — это делает функцию тестируемой
 * без монки-патчинга глобального `process.env` в тестах.
 */
export function loadConfig(env: EnvSource = process.env): Readonly<WorkerConfig> {
    const config: WorkerConfig = {
        redis: {
            host: requireString(env, "REDIS_HOST", "127.0.0.1"),
            port: parsePort(env, "REDIS_PORT", 6379),
            // Matches this repo's actual default (application/.env: APP_NAME=Laravel, no REDIS_PREFIX
            // override) — see the WorkerConfig field docblock.
            keyPrefix: optionalString(env, "REDIS_KEY_PREFIX", "laravel-database-"),
        },
        cdpRelay: {
            port: parsePort(env, "CDP_RELAY_PORT", 4001),
        },
        maxConcurrentSessions: parsePositiveInt(env, "MAX_CONCURRENT_SESSIONS", 3),
    };

    return Object.freeze(config);
}

/**
 * Готовый к использованию singleton, вычисляется один раз при первом импорте
 * модуля (то есть при старте процесса воркера — см. Dockerfile: CMD node dist/index.js).
 */
export const config: Readonly<WorkerConfig> = loadConfig();