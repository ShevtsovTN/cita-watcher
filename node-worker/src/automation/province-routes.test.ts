import { describe, expect, it } from "vitest";

import { buildCitarUrl, resolveProvinceRoute } from "./province-routes";

describe("resolveProvinceRoute", () => {
    it("resolves a known province to its route", () => {
        expect(resolveProvinceRoute("Cuenca")).toEqual({ basePath: "icpplus", id: 16 });
    });

    it("resolves a province with a non-default base path", () => {
        expect(resolveProvinceRoute("Madrid")).toEqual({ basePath: "icpplustiem", id: 28 });
    });

    it("returns undefined for an unknown province", () => {
        expect(resolveProvinceRoute("Narnia")).toBeUndefined();
    });
});

describe("buildCitarUrl", () => {
    it("builds the exact confirmed URL for a province route", () => {
        const route = resolveProvinceRoute("Cuenca");
        if (route === undefined) throw new Error("expected Cuenca to resolve");

        expect(buildCitarUrl(route)).toBe("https://icp.administracionelectronica.gob.es/icpplus/citar?p=16&locale=es");
    });

    it("uses the route's own base path, not a hardcoded one", () => {
        const route = resolveProvinceRoute("Barcelona");
        if (route === undefined) throw new Error("expected Barcelona to resolve");

        expect(buildCitarUrl(route)).toBe("https://icp.administracionelectronica.gob.es/icpplustieb/citar?p=8&locale=es");
    });
});
