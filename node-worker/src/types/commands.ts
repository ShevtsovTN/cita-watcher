/**
 * Wire-контракт входящих команд из `watcher-commands` Redis-списка (Laravel → node-worker). См.
 * ../../../application/app/Infrastructure/Watcher/Messaging/WorkerCommand.php и
 * ../../../docs/NODE_WORKER_ROADMAP.md Phase 3 — форма предварительная, задана Laravel-стороной
 * первой и ещё не подтверждена реальным node-worker'ом; менять только вместе с
 * `RedisWorkerGateway` на той стороне.
 *
 * `documentType`/`birthYear`/`nationality` (Phase 3) закрывают открытый с Phase 1 разрыв:
 * `../automation/site-navigator.ts`'s форма заявителя на реальном сайте требует все три поля,
 * которых раньше в `ApplicantData` не было — `site-navigator.ts` держал свой собственный
 * `DocumentIdentity` вместо того чтобы гадать про этот wire-контракт; теперь, когда поля
 * совпадают, `CheckAvailabilityRequest.applicant` — это `ApplicantData` напрямую, без дублирования
 * типа. Соответствующее изменение на Laravel-стороне (`ApplicantData.php`, `WorkerCommand.php`,
 * миграция `applicant_data` шифрованной колонки и всё, что её строит) — отдельный шаг того же
 * increment'а, см. `../../../application/app/Domain/Watcher/ValueObjects/ApplicantData.php`.
 */

/** Провинция + код трамита — то, что реально проверяется на сайте. */
export interface Procedure {
    readonly province: string;
    readonly tramiteCode: string;
    /**
     * Видимый текст опции `select#sede` — опционально, тот же контракт, что и
     * `../automation/site-navigator.ts`'s `CheckAvailabilityRequest.sede` (Phase 10): некоторые
     * trámite (например, recogida de TIE) появляются в списке только после выбора конкретной
     * sede. Опущено — сайт использует свой дефолт "Cualquier oficina".
     */
    readonly sede?: string;
}

/**
 * N.I.E./D.N.I./PASAPORTE — какой из трёх радио-баттонов на `/icpplus/acEntrada` выбрать. Живёт
 * здесь (не в `../automation/document-id-validator.ts`, где раньше был единственным владельцем),
 * поскольку теперь это часть wire-контракта, а `automation/` зависит от `types/`, а не наоборот.
 */
export type DocumentType = "dni" | "nie" | "pasaporte";

/** Данные заявителя, нужные для заполнения формы на сайте. */
export interface ApplicantData {
    readonly fullName: string;
    readonly documentType: DocumentType;
    readonly documentId: string;
    readonly email: string;
    readonly phone: string | null;
    /** Год рождения ("Año de nacimiento" на форме). */
    readonly birthYear: number;
    /** Метка страны как в `<select>` "País de nacionalidad" — см. `../automation/country-codes.ts`. */
    readonly nationality: string;
}

export interface WorkerCommand {
    readonly commandId: string;
    readonly type: "check_availability";
    readonly watchTaskId: number;
    readonly procedure: Procedure;
    readonly applicant: ApplicantData;
}
