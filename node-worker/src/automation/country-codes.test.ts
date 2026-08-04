import { describe, expect, it } from "vitest";

import { resolveCountryCode } from "./country-codes";

describe("resolveCountryCode", () => {
    it("resolves a known country to its code", () => {
        expect(resolveCountryCode("ESPAÑA")).toBe(109);
    });

    it("resolves a country whose label contains punctuation", () => {
        expect(resolveCountryCode("BOSNIA-HERZEGOVINA")).toBe(156);
    });

    it("returns undefined for an unknown nationality label", () => {
        expect(resolveCountryCode("ATLANTIS")).toBeUndefined();
    });
});
