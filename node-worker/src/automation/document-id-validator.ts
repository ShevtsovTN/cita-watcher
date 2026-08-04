/**
 * Повторяет клиентскую проверку DNI/NIE ("Es incorrecto" под полем на `/icpplus/acEntrada`, см.
 * ../../../docs/NODE_WORKER_ROADMAP.md Phase 1) — стандартный алгоритм mod-23: для NIE буква-префикс
 * X/Y/Z заменяется на цифру 0/1/2 и приписывается к 7 цифрам, дальше как обычный DNI. Цель — не
 * тратить реальный запрос (и не давать WAF лишний повод сработать) на данные, которые сайт и так
 * отклонит. Для PASAPORTE подтверждённого алгоритма нет — не выдумываем, всегда true.
 */

export type DocumentType = "dni" | "nie" | "pasaporte";

const CHECK_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const NIE_PREFIX_DIGITS: Readonly<Record<string, string>> = Object.freeze({ X: "0", Y: "1", Z: "2" });

const DNI_PATTERN = /^(?<digits>\d{8})(?<letter>[A-Za-z])$/;
const NIE_PATTERN = /^(?<prefix>[XYZxyz])(?<digits>\d{7})(?<letter>[A-Za-z])$/;

function expectedCheckLetter(digits: string): string {
    return CHECK_LETTERS.charAt(Number(digits) % 23);
}

function isValidDni(documentId: string): boolean {
    const match = DNI_PATTERN.exec(documentId.trim());
    const digits = match?.groups?.["digits"];
    const letter = match?.groups?.["letter"];
    if (digits === undefined || letter === undefined) return false;

    return letter.toUpperCase() === expectedCheckLetter(digits);
}

function isValidNie(documentId: string): boolean {
    const match = NIE_PATTERN.exec(documentId.trim());
    const prefix = match?.groups?.["prefix"];
    const digits = match?.groups?.["digits"];
    const letter = match?.groups?.["letter"];
    if (prefix === undefined || digits === undefined || letter === undefined) return false;

    const prefixDigit = NIE_PREFIX_DIGITS[prefix.toUpperCase()];
    if (prefixDigit === undefined) return false;

    return letter.toUpperCase() === expectedCheckLetter(prefixDigit + digits);
}

export function isValidDocumentId(documentType: DocumentType, documentId: string): boolean {
    switch (documentType) {
        case "dni":
            return isValidDni(documentId);
        case "nie":
            return isValidNie(documentId);
        case "pasaporte":
            return true;
    }
}
