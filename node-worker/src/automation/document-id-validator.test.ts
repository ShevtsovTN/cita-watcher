import { describe, expect, it } from "vitest";

import { isValidDocumentId } from "./document-id-validator";

describe("isValidDocumentId", () => {
    describe("dni", () => {
        it("accepts a DNI with a correct mod-23 check letter", () => {
            expect(isValidDocumentId("dni", "12345678Z")).toBe(true);
        });

        it("is case-insensitive on the check letter", () => {
            expect(isValidDocumentId("dni", "12345678z")).toBe(true);
        });

        it("rejects a DNI with an incorrect check letter", () => {
            expect(isValidDocumentId("dni", "12345678A")).toBe(false);
        });

        it("rejects malformed input (wrong digit count)", () => {
            expect(isValidDocumentId("dni", "1234567Z")).toBe(false);
        });
    });

    describe("nie", () => {
        it("accepts an NIE with a correct mod-23 check letter", () => {
            expect(isValidDocumentId("nie", "X1234567L")).toBe(true);
        });

        it("is case-insensitive on the prefix and check letter", () => {
            expect(isValidDocumentId("nie", "x1234567l")).toBe(true);
        });

        it("rejects an NIE with an incorrect check letter (confirmed live: site showed 'Es incorrecto')", () => {
            expect(isValidDocumentId("nie", "X1234567A")).toBe(false);
        });

        it("rejects malformed input (missing prefix letter)", () => {
            expect(isValidDocumentId("nie", "11234567L")).toBe(false);
        });
    });

    describe("pasaporte", () => {
        it("always accepts — no confirmed client-side algorithm for passports", () => {
            expect(isValidDocumentId("pasaporte", "ANYTHING123")).toBe(true);
        });
    });
});
