/**
 * Plain HTTP health endpoint for `config.health.port` (see ../../docs/NODE_WORKER_ROADMAP.md
 * Phase 5, "Health signal for the container"). docker-compose's own `healthcheck:` (see
 * `db`/`redis` services for the existing pattern this mirrors) polls it the same way `pg_isready`/
 * `redis-cli ping` are polled for those services — a plain HTTP GET, any path, answered from
 * `isHealthy()` with `200`/`503`. Same DI-factory idiom as `../captcha/relay-server.ts`'s
 * `WebSocketServerFactory`: the real `http.Server` is constructed via an injectable factory, so
 * tests exercise the request-handling logic against a hand-built fake instead of binding a real
 * socket.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export type HealthCheck = () => boolean;

export interface HealthServer {
    start(): void;
    stop(): Promise<void>;
}

const HEALTHY_STATUS_CODE = 200;
const UNHEALTHY_STATUS_CODE = 503;

type HttpServerFactory = (requestListener: (req: IncomingMessage, res: ServerResponse) => void) => Server;

const defaultServerFactory: HttpServerFactory = (requestListener) => createServer(requestListener);

export class HttpHealthServer implements HealthServer {
    private server: Server | undefined;

    public constructor(
        private readonly port: number,
        /** Cheap and synchronous by design — see the module docblock for what it's meant to check. */
        private readonly isHealthy: HealthCheck,
        private readonly createHttpServer: HttpServerFactory = defaultServerFactory,
    ) {}

    public start(): void {
        if (this.server !== undefined) {
            return;
        }

        const server = this.createHttpServer((_req, res) => {
            this.handleRequest(res);
        });

        server.listen(this.port);
        this.server = server;
    }

    public async stop(): Promise<void> {
        const server = this.server;
        this.server = undefined;

        if (server === undefined) {
            return;
        }

        await new Promise<void>((resolve, reject) => {
            server.close((error) => {
                if (error !== undefined) {
                    reject(error);
                    return;
                }

                resolve();
            });
        });
    }

    private handleRequest(res: ServerResponse): void {
        const healthy = this.isHealthy();

        res.writeHead(healthy ? HEALTHY_STATUS_CODE : UNHEALTHY_STATUS_CODE, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: healthy ? "ok" : "unhealthy" }));
    }
}
