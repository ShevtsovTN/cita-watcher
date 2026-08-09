import { describe, expect, it, vi } from "vitest";
import type { Locator, Page } from "playwright";

import { buildCitarUrl, resolveProvinceRoute } from "./province-routes";
import {
    type CheckAvailabilityRequest,
    DocumentTypeNotOfferedError,
    PhoneRequiredError,
    SedeNotFoundError,
    TramiteNotFoundError,
    UnknownNationalityError,
    UnknownProvinceError,
    classifyPostResolutionOutcome,
    runAvailabilityCheck,
} from "./site-navigator";

const TRAMITE_SELECT_CSS_SELECTOR = 'select[id^="tramiteGrupo"]';
const SEDE_SELECT_SELECTOR = "select#sede";
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

/** Same shape as `fakeTramiteSelect` — `selectSede` reads options the same way `selectTramite` does. */
function fakeSedeSelect(optionLabels: readonly string[], onSelect: (label: string) => void): Locator {
    return fakeTramiteSelect(optionLabels, onSelect);
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
    /** `undefined` means "no sede select on this fake page" — matches every pre-Phase-9 test not needing one. */
    readonly sedeOptionLabels?: readonly string[];
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
    /** Defaults to the trámite index page — used by `classifyPostResolutionOutcome` tests to simulate `page.url()` after a human's CDP session ends. */
    readonly urlOverride?: string;
}

interface FakePageState {
    readonly page: Page;
    readonly clicks: string[];
    readonly checkedRadios: string[];
    readonly filledTextboxes: Record<string, string>;
    readonly filledLabels: Record<string, string>;
    selectedTramite: string | undefined;
    selectedSede: string | undefined;
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
        selectedSede: undefined,
    };
    let currentUrl = scenario.urlOverride ?? "https://icp.administracionelectronica.gob.es/icpplus/index.html";

    const tramiteSelects = (scenario.tramiteOptionLists ?? []).map((labels) =>
        fakeTramiteSelect(labels, (label) => {
            state.selectedTramite = label;
        }),
    );
    const tramiteGroupLocator = fakeLocator({ all: vi.fn(() => Promise.resolve(tramiteSelects)) });
    const sedeLocator =
        scenario.sedeOptionLabels === undefined
            ? undefined
            : fakeSedeSelect(scenario.sedeOptionLabels, (label) => {
                  state.selectedSede = label;
              });
    const bodyLocator = fakeLocator({ innerText: vi.fn(() => Promise.resolve(scenario.bodyText ?? "")) });
    const clavePanelLocator = fakeLocator({ isVisible: vi.fn(() => Promise.resolve(scenario.clavePanelVisible ?? false)) });
    const validationLocator = fakeLocator({ isVisible: vi.fn(() => Promise.resolve(scenario.validationVisible ?? false)) });

    const page = {
        goto: vi.fn(() => Promise.resolve(null)),
        url: vi.fn(() => currentUrl),
        waitForTimeout: vi.fn(() => Promise.resolve(undefined)),
        locator: vi.fn((selector: string) => {
            if (selector === "body") return bodyLocator;
            if (selector === SEDE_SELECT_SELECTOR) {
                if (sedeLocator === undefined) throw new Error("test scenario has no select#sede — set sedeOptionLabels");
                return sedeLocator;
            }
            if (selector === TRAMITE_SELECT_CSS_SELECTOR) return tramiteGroupLocator;
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

    it("never touches select#sede when request.sede is omitted", async () => {
        const { page } = fakePage({
            tramiteOptionLists: [["POLICIA-ASIGNACIÓN DE NIE"], []],
            clavePanelVisible: true, // short-circuit before needing "Entrar"/form fakes
        });

        await runAvailabilityCheck(page, buildRequest());

        expect(page.locator).not.toHaveBeenCalledWith("select#sede");
    });

    it("selects the sede before the trámite when request.sede is given", async () => {
        const state = fakePage({
            sedeOptionLabels: ["Cualquier oficina", "CNP Benidorm TIE, Callosa D`Ensarria, 2, Benidorm"],
            tramiteOptionLists: [["POLICIA-ASIGNACIÓN DE NIE"], []],
            clavePanelVisible: true,
        });

        await runAvailabilityCheck(
            state.page,
            buildRequest({ sede: "CNP Benidorm TIE, Callosa D`Ensarria, 2, Benidorm" }),
        );

        expect(state.selectedSede).toBe("CNP Benidorm TIE, Callosa D`Ensarria, 2, Benidorm");
        expect(state.selectedTramite).toBe("POLICIA-ASIGNACIÓN DE NIE");
    });

    it("waits after selecting sede for the site's own cargaTramites() AJAX reload", async () => {
        const { page } = fakePage({
            sedeOptionLabels: ["Cualquier oficina", "CNP Benidorm TIE, Callosa D`Ensarria, 2, Benidorm"],
            tramiteOptionLists: [["POLICIA-ASIGNACIÓN DE NIE"], []],
            clavePanelVisible: true,
        });

        await runAvailabilityCheck(page, buildRequest({ sede: "CNP Benidorm TIE, Callosa D`Ensarria, 2, Benidorm" }));

        expect(page.waitForTimeout).toHaveBeenCalled();
    });

    it("selects the sede once its options populate on a later poll attempt (bot-defense reload race)", async () => {
        const optionsLocator = fakeLocator({
            allTextContents: vi
                .fn()
                .mockResolvedValueOnce([]) // challenge not yet resolved — matches Phase 12's live finding
                .mockResolvedValueOnce([])
                .mockResolvedValue(["Cualquier oficina", "CNP Benidorm TIE, Callosa D`Ensarria, 2, Benidorm"]),
        });
        let selectedSede: string | undefined;
        const delayedSedeSelect = fakeLocator({
            locator: vi.fn(() => optionsLocator),
            selectOption: vi.fn((opts: { label: string }) => {
                selectedSede = opts.label;
                return Promise.resolve([opts.label]);
            }),
        });
        const { page } = fakePage({
            tramiteOptionLists: [["POLICIA-ASIGNACIÓN DE NIE"], []],
            clavePanelVisible: true,
        });
        const originalLocatorImpl = (
            page.locator as unknown as { getMockImplementation: () => (selector: string) => Locator }
        ).getMockImplementation();
        (page.locator as unknown as { mockImplementation: (fn: (selector: string) => Locator) => void }).mockImplementation(
            (selector: string) => (selector === SEDE_SELECT_SELECTOR ? delayedSedeSelect : originalLocatorImpl(selector)),
        );

        await runAvailabilityCheck(
            page,
            buildRequest({ sede: "CNP Benidorm TIE, Callosa D`Ensarria, 2, Benidorm" }),
        );

        expect(selectedSede).toBe("CNP Benidorm TIE, Callosa D`Ensarria, 2, Benidorm");
        expect(optionsLocator.allTextContents).toHaveBeenCalledTimes(3);
    });

    it("tolerates a mid-poll 'Execution context was destroyed' error (a live-observed mid-reload race) and keeps polling", async () => {
        const optionsLocator = fakeLocator({
            allTextContents: vi
                .fn()
                .mockRejectedValueOnce(new Error("locator.allTextContents: Execution context was destroyed, most likely because of a navigation"))
                .mockResolvedValue(["Cualquier oficina", "CNP Benidorm TIE, Callosa D`Ensarria, 2, Benidorm"]),
        });
        let selectedSede: string | undefined;
        const delayedSedeSelect = fakeLocator({
            locator: vi.fn(() => optionsLocator),
            selectOption: vi.fn((opts: { label: string }) => {
                selectedSede = opts.label;
                return Promise.resolve([opts.label]);
            }),
        });
        const { page } = fakePage({
            tramiteOptionLists: [["POLICIA-ASIGNACIÓN DE NIE"], []],
            clavePanelVisible: true,
        });
        const originalLocatorImpl = (
            page.locator as unknown as { getMockImplementation: () => (selector: string) => Locator }
        ).getMockImplementation();
        (page.locator as unknown as { mockImplementation: (fn: (selector: string) => Locator) => void }).mockImplementation(
            (selector: string) => (selector === SEDE_SELECT_SELECTOR ? delayedSedeSelect : originalLocatorImpl(selector)),
        );

        await runAvailabilityCheck(
            page,
            buildRequest({ sede: "CNP Benidorm TIE, Callosa D`Ensarria, 2, Benidorm" }),
        );

        expect(selectedSede).toBe("CNP Benidorm TIE, Callosa D`Ensarria, 2, Benidorm");
    });

    it("throws SedeNotFoundError when the given sede isn't among select#sede's options", async () => {
        const { page } = fakePage({ sedeOptionLabels: ["Cualquier oficina", "CNP Alcoy, Placeta Les Xiques, S/N, Alcoy"] });

        await expect(runAvailabilityCheck(page, buildRequest({ sede: "Nonexistent Office" }))).rejects.toThrow(
            SedeNotFoundError,
        );
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

    it("finds the trámite once the combobox options populate on a later poll attempt (bot-defense reload race)", async () => {
        const optionsLocator = fakeLocator({
            allTextContents: vi
                .fn()
                .mockResolvedValueOnce([]) // challenge not yet resolved
                .mockResolvedValue(["POLICIA-ASIGNACIÓN DE NIE"]),
        });
        let selectedTramite: string | undefined;
        const delayedTramiteSelect = fakeLocator({
            locator: vi.fn(() => optionsLocator),
            selectOption: vi.fn((opts: { label: string }) => {
                selectedTramite = opts.label;
                return Promise.resolve([opts.label]);
            }),
        });
        const tramiteGroupLocator = fakeLocator({ all: vi.fn(() => Promise.resolve([delayedTramiteSelect])) });
        const { page } = fakePage({ clavePanelVisible: true });
        const originalLocatorImpl = (
            page.locator as unknown as {
                getMockImplementation: () => (selector: string) => Locator;
            }
        ).getMockImplementation();
        (
            page.locator as unknown as {
                mockImplementation: (fn: (selector: string) => Locator) => void;
            }
        ).mockImplementation((selector: string) => (selector === TRAMITE_SELECT_CSS_SELECTOR ? tramiteGroupLocator : originalLocatorImpl(selector)));

        await runAvailabilityCheck(page, buildRequest());

        expect(selectedTramite).toBe("POLICIA-ASIGNACIÓN DE NIE");
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

describe("classifyPostResolutionOutcome", () => {
    const route = resolveProvinceRoute("Cuenca");
    if (route === undefined) throw new Error("test fixture expects Cuenca to have a confirmed route");
    const citarUrl = buildCitarUrl(route);

    it("returns waf_rejected when the page shows the WAF rejection text", async () => {
        const { page } = fakePage({
            bodyText: "The requested URL was rejected. Please consult with your administrador. Your support ID is: <123>",
        });

        const outcome = await classifyPostResolutionOutcome(page, "Cuenca");

        expect(outcome).toEqual({ type: "waf_rejected", supportId: "123" });
    });

    it("returns reservation_window_expired when the page bounced back to the trámite entry URL", async () => {
        const { page } = fakePage({ urlOverride: citarUrl });

        const outcome = await classifyPostResolutionOutcome(page, "Cuenca");

        expect(outcome).toEqual({ type: "reservation_window_expired" });
    });

    it("returns post_submit_unconfirmed for any other page state", async () => {
        const { page } = fakePage({
            urlOverride: "https://icp.administracionelectronica.gob.es/icpplus/acVerificarCita.html",
        });

        const outcome = await classifyPostResolutionOutcome(page, "Cuenca");

        expect(outcome).toEqual({ type: "post_submit_unconfirmed" });
    });
});
