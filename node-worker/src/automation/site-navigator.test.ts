import { describe, expect, it, vi } from "vitest";
import type { Locator, Page } from "playwright";

import {
    type CheckAvailabilityRequest,
    TramiteNotFoundError,
    UnknownNationalityError,
    UnknownProvinceError,
    runAvailabilityCheck,
} from "./site-navigator";

const TRAMITE_SELECT_PLACEHOLDER = "Despliega para ver trámites disponibles en esta provincia";

function fakeLocator(overrides: Partial<Record<string, unknown>> = {}): Locator {
    return {
        innerText: vi.fn(() => Promise.resolve("")),
        isVisible: vi.fn(() => Promise.resolve(false)),
        all: vi.fn(() => Promise.resolve([])),
        allTextContents: vi.fn(() => Promise.resolve([])),
        selectOption: vi.fn(() => Promise.resolve([])),
        click: vi.fn(() => Promise.resolve(undefined)),
        check: vi.fn(() => Promise.resolve(undefined)),
        fill: vi.fn(() => Promise.resolve(undefined)),
        locator: vi.fn(() => fakeLocator()),
        ...overrides,
    } as unknown as Locator;
}

function fakeTramiteSelect(optionLabels: readonly string[], onSelect: (label: string) => void): Locator {
    return fakeLocator({
        locator: vi.fn(() => fakeLocator({ allTextContents: vi.fn(() => Promise.resolve(optionLabels)) })),
        selectOption: vi.fn((opts: { label: string }) => {
            onSelect(opts.label);
            return Promise.resolve([opts.label]);
        }),
    });
}

interface PageScenario {
    readonly bodyText?: string;
    readonly clavePanelVisible?: boolean;
    readonly validationVisible?: boolean;
    readonly tramiteOptionLists?: readonly (readonly string[])[];
    readonly urlAfterEntrar?: string;
}

interface FakePageState {
    readonly page: Page;
    readonly clicks: string[];
    readonly checkedRadios: string[];
    readonly filledTextboxes: Record<string, string>;
    readonly filledLabels: Record<string, string>;
    selectedTramite: string | undefined;
}

function fakePage(scenario: PageScenario = {}): FakePageState {
    const clicks: string[] = [];
    const checkedRadios: string[] = [];
    const filledTextboxes: Record<string, string> = {};
    const filledLabels: Record<string, string> = {};
    const state: FakePageState = {
        page: {} as unknown as Page,
        clicks,
        checkedRadios,
        filledTextboxes,
        filledLabels,
        selectedTramite: undefined,
    };
    let currentUrl = "https://icp.administracionelectronica.gob.es/icpplus/index.html";

    const tramiteSelects = (scenario.tramiteOptionLists ?? []).map((labels) =>
        fakeTramiteSelect(labels, (label) => {
            state.selectedTramite = label;
        }),
    );
    const tramiteGroupLocator = fakeLocator({ all: vi.fn(() => Promise.resolve(tramiteSelects)) });
    const bodyLocator = fakeLocator({ innerText: vi.fn(() => Promise.resolve(scenario.bodyText ?? "")) });
    const clavePanelLocator = fakeLocator({ isVisible: vi.fn(() => Promise.resolve(scenario.clavePanelVisible ?? false)) });
    const validationLocator = fakeLocator({ isVisible: vi.fn(() => Promise.resolve(scenario.validationVisible ?? false)) });

    const page = {
        goto: vi.fn(() => Promise.resolve(null)),
        url: vi.fn(() => currentUrl),
        locator: vi.fn((selector: string) => (selector === "body" ? bodyLocator : fakeLocator())),
        getByText: vi.fn((text: string) => {
            if (text === "Presentación con Cl@ve") return clavePanelLocator;
            if (text === "Es incorrecto") return validationLocator;
            return fakeLocator();
        }),
        getByRole: vi.fn((role: string, opts?: { name?: string }) => {
            const name = opts?.name ?? "";
            if (role === "combobox" && name === TRAMITE_SELECT_PLACEHOLDER) return tramiteGroupLocator;
            if (role === "button") {
                return fakeLocator({
                    click: vi.fn(() => {
                        clicks.push(name);
                        if (name === "Entrar" && scenario.urlAfterEntrar !== undefined) {
                            currentUrl = scenario.urlAfterEntrar;
                        }
                        return Promise.resolve(undefined);
                    }),
                });
            }
            if (role === "radio") {
                return fakeLocator({
                    check: vi.fn(() => {
                        checkedRadios.push(name);
                        return Promise.resolve(undefined);
                    }),
                });
            }
            if (role === "textbox") {
                return fakeLocator({
                    fill: vi.fn((value: string) => {
                        filledTextboxes[name] = value;
                        return Promise.resolve(undefined);
                    }),
                });
            }
            return fakeLocator();
        }),
        getByLabel: vi.fn((name: string) => {
            return fakeLocator({
                fill: vi.fn((value: string) => {
                    filledLabels[name] = value;
                    return Promise.resolve(undefined);
                }),
                selectOption: vi.fn((opts: { value: string }) => {
                    filledLabels[name] = opts.value;
                    return Promise.resolve([opts.value]);
                }),
            });
        }),
    } as unknown as Page;

    // Mutate in place (not a spread copy) so `state.selectedTramite` reflects later calls made by
    // `runAvailabilityCheck` after this function has already returned.
    Object.assign(state, { page });
    return state;
}

function buildRequest(overrides: Partial<CheckAvailabilityRequest> = {}): CheckAvailabilityRequest {
    return {
        province: "Cuenca",
        tramiteLabel: "POLICIA-ASIGNACIÓN DE NIE",
        applicant: {
            documentType: "nie",
            documentId: "X1234567L",
            fullName: "Test Testerson",
            birthYear: 1990,
            nationality: "VENEZUELA",
        },
        ...overrides,
    };
}

describe("runAvailabilityCheck", () => {
    it("returns validation_rejected before touching the page for a checksum-invalid NIE", async () => {
        const { page } = fakePage();
        const request = buildRequest({ applicant: { ...buildRequest().applicant, documentId: "X1234567A" } });

        const outcome = await runAvailabilityCheck(page, request);

        expect(outcome).toEqual({ type: "validation_rejected", message: "Es incorrecto" });
        expect(page.goto).not.toHaveBeenCalled();
    });

    it("throws UnknownProvinceError for a province with no confirmed route", async () => {
        const { page } = fakePage();
        const request = buildRequest({ province: "Narnia" });

        await expect(runAvailabilityCheck(page, request)).rejects.toThrow(UnknownProvinceError);
    });

    it("returns waf_rejected with the parsed support id when the province page is WAF-blocked", async () => {
        const { page } = fakePage({
            bodyText: "The requested URL was rejected. Please consult with your administrador. Your support ID is: <6677429507613539311>",
        });

        const outcome = await runAvailabilityCheck(page, buildRequest());

        expect(outcome).toEqual({ type: "waf_rejected", supportId: "6677429507613539311" });
    });

    it("throws TramiteNotFoundError when the label isn't in either trámite select", async () => {
        const { page } = fakePage({ tramiteOptionLists: [["OTHER A"], ["OTHER B"]] });

        await expect(runAvailabilityCheck(page, buildRequest())).rejects.toThrow(TramiteNotFoundError);
    });

    it("finds the trámite in the second select when the first doesn't have it", async () => {
        // `state` (not destructured) so `.selectedTramite` reflects the mutation made during the
        // call below, not its value at fakePage() construction time.
        const state = fakePage({
            tramiteOptionLists: [["OTHER A"], ["POLICIA-ASIGNACIÓN DE NIE", "OTHER B"]],
            clavePanelVisible: true, // short-circuit before needing "Entrar"/form fakes
        });

        await runAvailabilityCheck(state.page, buildRequest());

        expect(state.selectedTramite).toBe("POLICIA-ASIGNACIÓN DE NIE");
    });

    it("returns requires_clave immediately when the Cl@ve panel appears, without clicking Entrar", async () => {
        const { page, clicks } = fakePage({
            tramiteOptionLists: [["POLICIA-ASIGNACIÓN DE NIE"]],
            clavePanelVisible: true,
        });

        const outcome = await runAvailabilityCheck(page, buildRequest());

        expect(outcome).toEqual({ type: "requires_clave" });
        expect(clicks).not.toContain("Entrar");
    });

    it("returns requires_clave via the hostname fallback if Entrar navigates to the Cl@ve host", async () => {
        const { page } = fakePage({
            tramiteOptionLists: [["POLICIA-ASIGNACIÓN DE NIE"]],
            urlAfterEntrar: "https://pasarela.clave.gob.es/Proxy2/ServiceProvider",
        });

        const outcome = await runAvailabilityCheck(page, buildRequest());

        expect(outcome).toEqual({ type: "requires_clave" });
    });

    it("throws UnknownNationalityError for a nationality with no confirmed country code", async () => {
        const { page } = fakePage({ tramiteOptionLists: [["POLICIA-ASIGNACIÓN DE NIE"]] });
        const request = buildRequest({ applicant: { ...buildRequest().applicant, nationality: "ATLANTIS" } });

        await expect(runAvailabilityCheck(page, request)).rejects.toThrow(UnknownNationalityError);
    });

    it("returns validation_rejected when the post-submit page shows 'Es incorrecto'", async () => {
        const { page } = fakePage({
            tramiteOptionLists: [["POLICIA-ASIGNACIÓN DE NIE"]],
            validationVisible: true,
        });

        const outcome = await runAvailabilityCheck(page, buildRequest());

        expect(outcome).toEqual({ type: "validation_rejected", message: "Es incorrecto" });
    });

    it("returns post_submit_unconfirmed for a clean submit with none of the known outcomes", async () => {
        const { page, checkedRadios, filledTextboxes, filledLabels } = fakePage({
            tramiteOptionLists: [["POLICIA-ASIGNACIÓN DE NIE"]],
        });

        const outcome = await runAvailabilityCheck(page, buildRequest());

        expect(outcome).toEqual({ type: "post_submit_unconfirmed" });
        expect(checkedRadios).toContain("N.I.E.");
        expect(filledTextboxes["N.I.E."]).toBe("X1234567L");
        expect(filledTextboxes["Nombre y apellidos"]).toBe("Test Testerson");
        expect(filledLabels["Año de nacimiento"]).toBe("1990");
        expect(filledLabels["País de nacionalidad"]).toBe("248");
    });
});
