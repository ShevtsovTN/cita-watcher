import { describe, expect, it, vi } from "vitest";
import type { Locator, Page } from "playwright";

import {
    type CheckAvailabilityRequest,
    DocumentTypeNotOfferedError,
    PhoneRequiredError,
    TramiteNotFoundError,
    UnknownNationalityError,
    UnknownProvinceError,
    runAvailabilityCheck,
} from "./site-navigator";

const TRAMITE_SELECT_PLACEHOLDER = "Despliega para ver trámites disponibles en esta provincia";
const SOLICITAR_CITA_BUTTON_NAME = "Solicitar Cita";
const CAPTCHA_INPUT_PLACEHOLDER = "Introduce el texto aquí";

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

interface OfferedSlotScenario {
    readonly day: string;
    readonly time: string;
}

interface PageScenario {
    readonly bodyText?: string;
    readonly clavePanelVisible?: boolean;
    readonly validationVisible?: boolean;
    readonly tramiteOptionLists?: readonly (readonly string[])[];
    readonly urlAfterEntrar?: string;
    /** Defaults to `true` — matches every pre-wizard test's implicit assumption the radio exists. */
    readonly documentTypeRadioVisible?: boolean;
    /** Defaults to `true` — matches every pre-wizard test's implicit assumption the field exists. */
    readonly birthYearFieldVisible?: boolean;
    /** Defaults to `true` — matches every pre-wizard test's implicit assumption the field exists. */
    readonly nationalityFieldVisible?: boolean;
    /** Defaults to `false` — matches every pre-wizard test's `post_submit_unconfirmed` end state. */
    readonly solicitarCitaVisible?: boolean;
    /** Defaults to `false` — matches every pre-wizard test's `post_submit_unconfirmed` end state. */
    readonly captchaVisible?: boolean;
    readonly offeredSlots?: readonly OfferedSlotScenario[];
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
        locator: vi.fn((selector: string) => {
            if (selector === "body") return bodyLocator;
            const citaMatch = /^#cita_(\d+)$/.exec(selector);
            if (citaMatch !== null) {
                const citaNumber = citaMatch[1] ?? "";
                const slot = scenario.offeredSlots?.[Number(citaNumber) - 1];
                return fakeLocator({
                    innerText: vi.fn(() =>
                        Promise.resolve(slot === undefined ? "" : `CITA ${citaNumber}\nDía: ${slot.day}\nHora: ${slot.time}`),
                    ),
                });
            }
            return fakeLocator();
        }),
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
                    isVisible: vi.fn(() =>
                        Promise.resolve(name === SOLICITAR_CITA_BUTTON_NAME ? (scenario.solicitarCitaVisible ?? false) : true),
                    ),
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
                    isVisible: vi.fn(() => Promise.resolve(scenario.documentTypeRadioVisible ?? true)),
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
            const isVisible =
                name === "Año de nacimiento"
                    ? (scenario.birthYearFieldVisible ?? true)
                    : name === "País de nacionalidad"
                      ? (scenario.nationalityFieldVisible ?? true)
                      : true;
            return fakeLocator({
                isVisible: vi.fn(() => Promise.resolve(isVisible)),
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
        getByPlaceholder: vi.fn((placeholder: string) => {
            return fakeLocator({
                isVisible: vi.fn(() =>
                    Promise.resolve(placeholder === CAPTCHA_INPUT_PLACEHOLDER ? (scenario.captchaVisible ?? false) : false),
                ),
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
            phone: "600111222",
            email: "test@example.com",
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

    it("returns captcha_blocked_slots_offered when the full wizard reaches acOfertarCita", async () => {
        const { page, clicks, filledTextboxes } = fakePage({
            tramiteOptionLists: [["POLICIA-ASIGNACIÓN DE NIE"]],
            solicitarCitaVisible: true,
            captchaVisible: true,
            offeredSlots: [
                { day: "10/09/2026", time: "09:30" },
                { day: "11/09/2026", time: "10:15" },
            ],
        });

        const outcome = await runAvailabilityCheck(page, buildRequest());

        expect(outcome).toEqual({
            type: "captcha_blocked_slots_offered",
            slots: [
                { day: "10/09/2026", time: "09:30" },
                { day: "11/09/2026", time: "10:15" },
            ],
        });
        expect(clicks).toContain("Solicitar Cita");
        expect(clicks).toContain("Siguiente");
        expect(filledTextboxes["Teléfono"]).toBe("600111222");
        expect(filledTextboxes["Correo electrónico"]).toBe("test@example.com");
        expect(filledTextboxes["Repite Correo electrónico"]).toBe("test@example.com");
    });

    it("returns post_submit_unconfirmed without clicking further when the options menu isn't recognized", async () => {
        const { page, clicks } = fakePage({
            tramiteOptionLists: [["POLICIA-ASIGNACIÓN DE NIE"]],
            // solicitarCitaVisible defaults to false.
        });

        const outcome = await runAvailabilityCheck(page, buildRequest());

        expect(outcome).toEqual({ type: "post_submit_unconfirmed" });
        expect(clicks).not.toContain("Siguiente");
    });

    it("returns post_submit_unconfirmed when acOfertarCita's captcha isn't recognized, after getting further than the menu fallback", async () => {
        const { page, clicks } = fakePage({
            tramiteOptionLists: [["POLICIA-ASIGNACIÓN DE NIE"]],
            solicitarCitaVisible: true,
            // captchaVisible defaults to false.
        });

        const outcome = await runAvailabilityCheck(page, buildRequest());

        expect(outcome).toEqual({ type: "post_submit_unconfirmed" });
        expect(clicks).toContain("Solicitar Cita");
        expect(clicks).toContain("Siguiente");
    });

    it("fills the applicant form successfully when birth-year/nationality fields are absent, even with an unresolvable nationality", async () => {
        const { page, checkedRadios, filledTextboxes, filledLabels } = fakePage({
            tramiteOptionLists: [["POLICIA-ASIGNACIÓN DE NIE"]],
            birthYearFieldVisible: false,
            nationalityFieldVisible: false,
        });
        const request = buildRequest({ applicant: { ...buildRequest().applicant, nationality: "ATLANTIS" } });

        const outcome = await runAvailabilityCheck(page, request);

        expect(outcome).toEqual({ type: "post_submit_unconfirmed" });
        expect(checkedRadios).toContain("N.I.E.");
        expect(filledTextboxes["N.I.E."]).toBe("X1234567L");
        expect(filledLabels["Año de nacimiento"]).toBeUndefined();
        expect(filledLabels["País de nacionalidad"]).toBeUndefined();
    });

    it("throws DocumentTypeNotOfferedError when the requested document type's radio isn't offered", async () => {
        const { page } = fakePage({
            tramiteOptionLists: [["POLICIA-ASIGNACIÓN DE NIE"]],
            documentTypeRadioVisible: false,
        });

        await expect(runAvailabilityCheck(page, buildRequest())).rejects.toThrow(DocumentTypeNotOfferedError);
    });

    it("throws PhoneRequiredError without clicking Solicitar Cita when the options menu is reached but applicant.phone is null", async () => {
        const { page, clicks } = fakePage({
            tramiteOptionLists: [["POLICIA-ASIGNACIÓN DE NIE"]],
            solicitarCitaVisible: true,
        });
        const request = buildRequest({ applicant: { ...buildRequest().applicant, phone: null } });

        await expect(runAvailabilityCheck(page, request)).rejects.toThrow(PhoneRequiredError);
        expect(clicks).not.toContain("Solicitar Cita");
    });
});
