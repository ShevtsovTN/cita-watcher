/**
 * Парсит сырой JSON из `watcher-commands` Redis-списка в `WorkerCommand` (../types/commands.ts).
 * Список наполняет Laravel (`RedisWorkerGateway`), но раз содержимое пересекает границу процесса,
 * парсинг всё равно не доверяет ему вслепую — тот же принцип, что `../captcha/input-relay.ts`'s
 * `parseRemoteInputMessage`: никогда не бросает, что угодно нераспознанное молча становится
 * `undefined` и дальше просто отбрасывается consumer'ом (см. `redis-command-consumer.ts`).
 */

import type { ApplicantData, DocumentType, Procedure, WorkerCommand } from "../types";

const DOCUMENT_TYPES: readonly DocumentType[] = ["dni", "nie", "pasaporte"];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null;
}

function isDocumentType(value: unknown): value is DocumentType {
    return typeof value === "string" && (DOCUMENT_TYPES as readonly string[]).includes(value);
}

function parseProcedure(candidate: unknown): Procedure | undefined {
    if (!isRecord(candidate)) {
        return undefined;
    }

    const province = candidate["province"];
    const tramiteCode = candidate["tramiteCode"];

    if (typeof province !== "string" || typeof tramiteCode !== "string") {
        return undefined;
    }

    return { province, tramiteCode };
}

function parseApplicant(candidate: unknown): ApplicantData | undefined {
    if (!isRecord(candidate)) {
        return undefined;
    }

    const fullName = candidate["fullName"];
    const documentType = candidate["documentType"];
    const documentId = candidate["documentId"];
    const email = candidate["email"];
    const phone = candidate["phone"];
    const birthYear = candidate["birthYear"];
    const nationality = candidate["nationality"];

    if (typeof fullName !== "string" || typeof documentId !== "string" || typeof email !== "string") {
        return undefined;
    }

    if (!isDocumentType(documentType) || typeof birthYear !== "number" || typeof nationality !== "string") {
        return undefined;
    }

    if (phone !== null && typeof phone !== "string") {
        return undefined;
    }

    return { fullName, documentType, documentId, email, phone, birthYear, nationality };
}

export function parseWorkerCommand(raw: string): WorkerCommand | undefined {
    let parsed: unknown;

    try {
        parsed = JSON.parse(raw);
    } catch {
        return undefined;
    }

    if (!isRecord(parsed)) {
        return undefined;
    }

    const commandId = parsed["commandId"];
    const type = parsed["type"];
    const watchTaskId = parsed["watchTaskId"];

    if (typeof commandId !== "string" || type !== "check_availability" || typeof watchTaskId !== "number") {
        return undefined;
    }

    const procedure = parseProcedure(parsed["procedure"]);
    const applicant = parseApplicant(parsed["applicant"]);

    if (procedure === undefined || applicant === undefined) {
        return undefined;
    }

    return { commandId, type, watchTaskId, procedure, applicant };
}
