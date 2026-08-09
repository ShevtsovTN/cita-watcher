import { describe, expect, it } from "vitest";

import { parseWorkerCommand } from "./worker-command-parser";

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        commandId: "b4a1e0e0-0000-4000-8000-000000000000",
        type: "check_availability",
        watchTaskId: 42,
        procedure: { province: "Madrid", tramiteCode: "CITA_DNI" },
        applicant: {
            fullName: "Jane Doe",
            documentType: "dni",
            documentId: "00000000A",
            email: "jane@example.test",
            phone: "600000000",
            birthYear: 1990,
            nationality: "ESPAÑA",
        },
        ...overrides,
    };
}

describe("parseWorkerCommand", () => {
    it("parses a fully valid command", () => {
        const payload = validPayload();

        expect(parseWorkerCommand(JSON.stringify(payload))).toEqual(payload);
    });

    it("accepts a null phone", () => {
        const payload = validPayload({ applicant: { ...validPayload()["applicant"] as object, phone: null } });

        const command = parseWorkerCommand(JSON.stringify(payload));

        expect(command?.applicant.phone).toBeNull();
    });

    it("rejects malformed JSON", () => {
        expect(parseWorkerCommand("{not json")).toBeUndefined();
    });

    it("rejects non-object JSON", () => {
        expect(parseWorkerCommand(JSON.stringify("hello"))).toBeUndefined();
        expect(parseWorkerCommand(JSON.stringify(null))).toBeUndefined();
    });

    it("rejects an unknown type", () => {
        expect(parseWorkerCommand(JSON.stringify(validPayload({ type: "something_else" })))).toBeUndefined();
    });

    it("rejects a missing commandId", () => {
        const payload = validPayload();
        delete payload["commandId"];

        expect(parseWorkerCommand(JSON.stringify(payload))).toBeUndefined();
    });

    it("rejects a non-numeric watchTaskId", () => {
        expect(parseWorkerCommand(JSON.stringify(validPayload({ watchTaskId: "42" })))).toBeUndefined();
    });

    it("rejects a procedure missing tramiteCode", () => {
        expect(parseWorkerCommand(JSON.stringify(validPayload({ procedure: { province: "Madrid" } })))).toBeUndefined();
    });

    it("accepts an optional sede on the procedure", () => {
        const procedure = { province: "Madrid", tramiteCode: "CITA_DNI", sede: "CNP Benidorm TIE" };

        const command = parseWorkerCommand(JSON.stringify(validPayload({ procedure })));

        expect(command?.procedure.sede).toBe("CNP Benidorm TIE");
    });

    it("rejects a procedure with a non-string sede", () => {
        const procedure = { province: "Madrid", tramiteCode: "CITA_DNI", sede: 42 };

        expect(parseWorkerCommand(JSON.stringify(validPayload({ procedure })))).toBeUndefined();
    });

    it("rejects an applicant missing email", () => {
        const applicant = { fullName: "Jane Doe", documentId: "00000000A", phone: null };

        expect(parseWorkerCommand(JSON.stringify(validPayload({ applicant })))).toBeUndefined();
    });

    it("rejects an applicant with a non-string, non-null phone", () => {
        const applicant = { ...(validPayload()["applicant"] as object), phone: 600000000 };

        expect(parseWorkerCommand(JSON.stringify(validPayload({ applicant })))).toBeUndefined();
    });

    it("rejects an applicant with an unknown documentType", () => {
        const applicant = { ...(validPayload()["applicant"] as object), documentType: "carnet-de-conducir" };

        expect(parseWorkerCommand(JSON.stringify(validPayload({ applicant })))).toBeUndefined();
    });

    it("rejects an applicant with a non-numeric birthYear", () => {
        const applicant = { ...(validPayload()["applicant"] as object), birthYear: "1990" };

        expect(parseWorkerCommand(JSON.stringify(validPayload({ applicant })))).toBeUndefined();
    });
});
