/**
 * `BRPOP`-цикл над `watcher-commands` Redis-списком (см. ../../docs/NODE_WORKER_ROADMAP.md
 * Phase 3, первый и третий пункты чек-листа: consumer + backpressure). Не решает, что делать с
 * распарсенной командой — `onCommand` инжектируется, тот же DI-шов, что `onValidConnection` в
 * ../captcha/relay-server.ts; запускать реальную проверку через `automation/` — дело вызывающей
 * стороны (Phase 4 wiring, ещё не существует).
 *
 * Backpressure: не более `maxConcurrent` вызовов `onCommand` одновременно — цикл не берёт
 * следующую команду из Redis, пока не освободится слот, вместо того чтобы полагаться на то, что
 * `SessionManager`'s собственный `SessionLimitExceededError` (см. ../automation/session-manager.ts)
 * поймает и обработает превышение постфактum: не тянуть лишнее из очереди в принципе лучше, чем
 * тянуть и сразу же отбрасывать/переставлять обратно.
 */

import type { Redis } from "ioredis";

import type { WorkerCommand } from "../types";
import { parseWorkerCommand } from "./worker-command-parser";

const COMMANDS_LIST_NAME = "watcher-commands";
/**
 * Периодичность `BRPOP`'а без данных — тем самым цикл переодически перепроверяет
 * `running`/backpressure. Также верхняя граница задержки `stop()`: уже начавшийся блокирующий
 * `BRPOP` нельзя прервать, `stop()` в худшем случае ждёт именно столько, прежде чем цикл заметит
 * `running === false` — короткое значение специально, не 5-10с по умолчанию у других BRPOP-примеров.
 */
const BRPOP_TIMEOUT_SECONDS = 1;
const BACKPRESSURE_POLL_INTERVAL_MS = 50;

export type WorkerCommandHandler = (command: WorkerCommand) => Promise<void>;

type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface CommandConsumer {
    start(): void;
    stop(): Promise<void>;
}

export class RedisCommandConsumer implements CommandConsumer {
    private readonly listKey: string;
    private running = false;
    private loopPromise: Promise<void> | undefined;
    private inFlight = 0;

    public constructor(
        private readonly redis: Redis,
        keyPrefix: string,
        private readonly maxConcurrent: number,
        private readonly onCommand: WorkerCommandHandler,
        private readonly sleep: Sleep = defaultSleep,
    ) {
        this.listKey = `${keyPrefix}${COMMANDS_LIST_NAME}`;
    }

    public start(): void {
        if (this.running) {
            return;
        }

        this.running = true;
        this.loopPromise = this.loop();
    }

    public async stop(): Promise<void> {
        this.running = false;
        await this.loopPromise;
    }

    /**
     * Метод, а не прямое чтение поля: `this.running` — мутируемое состояние, которое `stop()`
     * меняет асинхронно, пока `loop()` ждёт на `await` — TS-у это не видно через прямое поле (его
     * control-flow analysis считает поле неизменным между двумя чтениями в одном "синхронном" на
     * вид блоке), из-за чего `@typescript-eslint/no-unnecessary-condition` ложно посчитал бы
     * повторную проверку после `await` избыточной.
     */
    private isRunning(): boolean {
        return this.running;
    }

    private async loop(): Promise<void> {
        while (this.isRunning()) {
            if (this.inFlight >= this.maxConcurrent) {
                await this.sleep(BACKPRESSURE_POLL_INTERVAL_MS);
                continue;
            }

            const popped = await this.redis.brpop(this.listKey, BRPOP_TIMEOUT_SECONDS).catch(() => null);

            if (!this.isRunning() || popped === null) {
                continue;
            }

            const [, raw] = popped;
            const command = parseWorkerCommand(raw);

            if (command === undefined) {
                continue;
            }

            this.inFlight += 1;
            void this.onCommand(command).finally(() => {
                this.inFlight -= 1;
            });
        }
    }
}
