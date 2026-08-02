/**
 * Wire-контракт входящих команд из `watcher-commands` Redis-списка (Laravel → node-worker). См.
 * ../../../application/app/Infrastructure/Watcher/Messaging/WorkerCommand.php и
 * ../../../docs/NODE_WORKER_ROADMAP.md Phase 3 — форма предварительная, задана Laravel-стороной
 * первой и ещё не подтверждена реальным node-worker'ом; менять только вместе с
 * `RedisWorkerGateway` на той стороне.
 */

/** Провинция + код трамита — то, что реально проверяется на сайте. */
export interface Procedure {
    readonly province: string;
    readonly tramiteCode: string;
}

/** Данные заявителя, нужные для заполнения формы на сайте. */
export interface ApplicantData {
    readonly fullName: string;
    readonly documentId: string;
    readonly email: string;
    readonly phone: string | null;
}

export interface WorkerCommand {
    readonly commandId: string;
    readonly type: "check_availability";
    readonly watchTaskId: number;
    readonly procedure: Procedure;
    readonly applicant: ApplicantData;
}
