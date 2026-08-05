/**
 * Реальный флоу сайта `icp.administracionelectronica.gob.es`, снятый вживую через Claude in Chrome
 * (см. ../../../docs/NODE_WORKER_ROADMAP.md Phase 1): провинция → trámite (один из двух отдельных
 * `<select>`, набор доступных trámite отличается по провинциям) → либо панель "Presentación con
 * Cl@ve" (для этой процедуры анонимный флоу вообще не работает — дальше не идём), либо страница
 * `/icpplus/acInfo` с кнопкой "Entrar" → форма заявителя `/icpplus/acEntrada` → сабмит.
 *
 * Один из блокеров — WAF (сигнатура F5 BIG-IP ASM, "Request Rejected"/"The requested URL was
 * rejected"), который встаёт липким на всю сессию после сабмита формы заявителя, но не всегда —
 * см. `WafRejected` и следующий абзац.
 *
 * ВАЖНО (ручной recon 2026-08-05, см. ../../../docs/PHASE9_DRY_RUN.md "Manual browser recon" —
 * это НЕ прогон через node-worker, просто человек в реальном браузере, но данные подтверждены
 * вживую, не выдуманы): для `POLICIA - RECOGIDA DE TARJETA DE IDENTIDAD DE EXTRANJERO (TIE)`
 * (Alicante/icpco/p=3) чистый (не отбитый WAF) сабмит формы заявителя ведёт НЕ сразу к
 * `PostSubmitUnconfirmed`-развязке, а в 5-шаговый визард: меню опций (Solicitar/Consultar/Anular
 * Cita) → `acCitar` ("Paso 2 de 5": телефон+email) → `acOfertarCita` ("Paso 3 de 5": реальный
 * список слотов + первая реально увиденная в этом проекте капча — простой ~6-символьный
 * alphanumeric image-челлендж, виджет `eu-captcha` сайта, с audio-альтернативой; с этого шага
 * стартует жёсткий, серверный 5-минутный таймер — по истечении сабмит молча не срабатывает и
 * откатывает на выбор провинции, без ошибки) → `acVerificarCita` ("Paso 4 de 5": экран
 * подтверждения данных) → `acGrabarCita` (финальный коммит, не понаблюдён — таймер истёк раньше).
 * **Шаги 1-3 (меню опций → `acCitar` → `acOfertarCita`) теперь промоделированы** —
 * `runAvailabilityCheck` доходит до `CaptchaBlockedSlotsOffered`, если эти три шага распознаются;
 * `acVerificarCita`/`acGrabarCita` и реальное решение капчи (пауза сессии на human-in-the-loop
 * через `../captcha/`) — сознательно отдельная, ещё не начатая задача (см.
 * ../../../docs/NODE_WORKER_ROADMAP.md Phase 6). Форма заявителя (`acEntrada`) тоже оказалась
 * trámite-зависимой: для этого trámite там только N.I.E.+ФИО, без года рождения/национальности/
 * выбора типа документа — `fillApplicantForm` теперь опрашивает наличие каждого поля перед
 * заполнением вместо того, чтобы предполагать фиксированный набор. Другой trámite
 * (`POLICÍA-TOMA DE HUELLAS...`) в той же провинции реально дал `RequiresClave`.
 */
import { type Locator, type Page } from "playwright";

import type { ApplicantData, DocumentType } from "../types";
import { resolveCountryCode } from "./country-codes";
import { isValidDocumentId } from "./document-id-validator";
import { buildCitarUrl, resolveProvinceRoute } from "./province-routes";

export interface CheckAvailabilityRequest {
    /** Метка провинции как в `<select>` "Selecciona Provincia", резолвится через `resolveProvinceRoute`. */
    readonly province: string;
    /** Видимый текст опции trámite — навигатор сам ищет её в обоих `<select>` (extranjería/policía). */
    readonly tramiteLabel: string;
    /**
     * `ApplicantData` (../types/commands.ts) напрямую — до Phase 3 это был отдельный
     * `DocumentIdentity`, потому что у wire-контракта не было `documentType`/`birthYear`/
     * `nationality`; теперь, когда поля совпадают, дублировать тип незачем.
     */
    readonly applicant: ApplicantData;
}

export interface RequiresClave {
    readonly type: "requires_clave";
}
export interface WafRejected {
    readonly type: "waf_rejected";
    readonly supportId: string | null;
}
export interface ValidationRejected {
    readonly type: "validation_rejected";
    readonly message: string;
}
/**
 * Оставшийся catch-all: страница после сабмита формы заявителя, меню опций после неё, или страница
 * `acOfertarCita` не распознаны ни как один из подтверждённых сценариев ниже, ни как WAF/Cl@ve. Не
 * выдумывать селекторы для этого случая — `acVerificarCita`/`acGrabarCita` и любые другие реальные
 * состояния (например "нет мест" без капчи) остаются неподтверждёнными до следующего recon.
 */
export interface PostSubmitUnconfirmed {
    readonly type: "post_submit_unconfirmed";
}

/**
 * День+время как показано в лейблах `div#cita_N` на `acOfertarCita` — реальный офис появляется
 * только на непромоделированном `acVerificarCita`, так что этот тип не может честно нести поле
 * `office`, как это делает wire-фейсинговый `AppointmentSlot` из ../types/check-result.ts. Намеренно
 * локальный для этого файла тип, а не переиспользование/мутация wire-типа.
 */
export interface OfferedSlot {
    /** "DD/MM/YYYY" как показано на странице. */
    readonly day: string;
    /** "HH:MM" как показано на странице. */
    readonly time: string;
}

/**
 * Подтверждённое живым recon состояние `acOfertarCita` ("Paso 3 de 5"): виден список предложенных
 * слотов и обязательная капча, блокирующая продолжение. Пустой `slots` — тоже честный результат
 * (парсинг конкретных `#cita_N` — best-effort), единственный gate на этот outcome — видимость
 * капчи, см. `detectOfferedSlots`.
 */
export interface CaptchaBlockedSlotsOffered {
    readonly type: "captcha_blocked_slots_offered";
    readonly slots: readonly OfferedSlot[];
}

export type NavigationOutcome =
    | RequiresClave
    | WafRejected
    | ValidationRejected
    | PostSubmitUnconfirmed
    | CaptchaBlockedSlotsOffered;

export class UnknownProvinceError extends Error {
    public constructor(province: string) {
        super(`Unknown province "${province}": no confirmed ICP Plus route for it`);
        this.name = "UnknownProvinceError";
    }
}

export class TramiteNotFoundError extends Error {
    public constructor(tramiteLabel: string) {
        super(`Trámite "${tramiteLabel}" was not found in either select on this province's page`);
        this.name = "TramiteNotFoundError";
    }
}

export class UnknownNationalityError extends Error {
    public constructor(nationality: string) {
        super(`Unknown nationality "${nationality}": no confirmed country code for it`);
        this.name = "UnknownNationalityError";
    }
}

export class DocumentTypeNotOfferedError extends Error {
    public constructor(documentType: DocumentType) {
        super(`Document type "${documentType}" is not offered on this trámite's applicant form`);
        this.name = "DocumentTypeNotOfferedError";
    }
}

export class PhoneRequiredError extends Error {
    public constructor() {
        super('Reached the "Solicitar Cita" step, which requires a phone number, but applicant.phone is null');
        this.name = "PhoneRequiredError";
    }
}

const TRAMITE_SELECT_PLACEHOLDER = "Despliega para ver trámites disponibles en esta provincia";
const CLAVE_HOSTNAME = "pasarela.clave.gob.es";
const WAF_SUPPORT_ID_PATTERN = /support id is:\s*<?([\w-]+)>?/i;
const SOLICITAR_CITA_BUTTON_NAME = "Solicitar Cita";
const CAPTCHA_INPUT_PLACEHOLDER = "Introduce el texto aquí";
const MAX_OFFERED_SLOTS = 3;
const OFFERED_SLOT_DAY_PATTERN = /Día:\s*(\d{2}\/\d{2}\/\d{4})/;
const OFFERED_SLOT_TIME_PATTERN = /Hora:\s*(\d{2}:\d{2})/;

const DOCUMENT_TYPE_RADIO_LABELS: Readonly<Record<DocumentType, string>> = Object.freeze({
    nie: "N.I.E.",
    dni: "D.N.I.",
    pasaporte: "PASAPORTE",
});

async function detectWafRejection(page: Page): Promise<WafRejected | undefined> {
    const bodyText = await page
        .locator("body")
        .innerText()
        .catch(() => "");
    if (!bodyText.includes("The requested URL was rejected")) return undefined;

    const match = WAF_SUPPORT_ID_PATTERN.exec(bodyText);
    return { type: "waf_rejected", supportId: match?.[1] ?? null };
}

async function detectClavePanel(page: Page): Promise<boolean> {
    return page
        .getByText("Presentación con Cl@ve")
        .isVisible()
        .catch(() => false);
}

async function detectValidationRejection(page: Page): Promise<ValidationRejected | undefined> {
    const visible = await page
        .getByText("Es incorrecto")
        .isVisible()
        .catch(() => false);
    if (!visible) return undefined;

    return { type: "validation_rejected", message: "Es incorrecto" };
}

async function detectSolicitarCitaButton(page: Page): Promise<Locator | undefined> {
    const button = page.getByRole("button", { name: SOLICITAR_CITA_BUTTON_NAME });
    return (await button.isVisible().catch(() => false)) ? button : undefined;
}

async function fillContactForm(page: Page, phone: string, email: string): Promise<void> {
    await page.getByRole("textbox", { name: "Teléfono" }).fill(phone);
    // `exact: true` matters here: "Repite Correo electrónico" contains "Correo electrónico" as a
    // substring, and Playwright's default accessible-name match isn't exact — without this, the
    // first getByRole call would resolve to both inputs and hit strict-mode ambiguity.
    await page.getByRole("textbox", { name: "Correo electrónico", exact: true }).fill(email);
    await page.getByRole("textbox", { name: "Repite Correo electrónico" }).fill(email);
    await page.getByRole("button", { name: "Siguiente" }).click();
}

async function detectOfferedSlots(page: Page): Promise<CaptchaBlockedSlotsOffered | undefined> {
    const captchaVisible = await page
        .getByPlaceholder(CAPTCHA_INPUT_PLACEHOLDER)
        .isVisible()
        .catch(() => false);
    if (!captchaVisible) return undefined;

    const slots: OfferedSlot[] = [];
    for (let n = 1; n <= MAX_OFFERED_SLOTS; n++) {
        const slotText = await page
            .locator(`#cita_${String(n)}`)
            .innerText()
            .catch(() => "");
        const day = OFFERED_SLOT_DAY_PATTERN.exec(slotText)?.[1];
        const time = OFFERED_SLOT_TIME_PATTERN.exec(slotText)?.[1];
        if (day !== undefined && time !== undefined) slots.push({ day, time });
    }
    return { type: "captcha_blocked_slots_offered", slots };
}

async function selectTramite(page: Page, tramiteLabel: string): Promise<void> {
    const selects: readonly Locator[] = await page.getByRole("combobox", { name: TRAMITE_SELECT_PLACEHOLDER }).all();

    for (const select of selects) {
        const optionLabels = await select.locator("option").allTextContents();
        if (optionLabels.includes(tramiteLabel)) {
            await select.selectOption({ label: tramiteLabel });
            return;
        }
    }

    throw new TramiteNotFoundError(tramiteLabel);
}

async function fillApplicantForm(page: Page, applicant: ApplicantData): Promise<void> {
    const radioLabel = DOCUMENT_TYPE_RADIO_LABELS[applicant.documentType];

    // Confirmed trámite-dependent (see file-level comment): the recogida-de-TIE form only offers a
    // single N.I.E. radio, not all three document types. A requested type this trámite doesn't
    // offer is a real client/config mismatch, worth a clear domain error rather than a Playwright
    // timeout on a radio that was never going to appear.
    const documentTypeRadio = page.getByRole("radio", { name: radioLabel });
    if (!(await documentTypeRadio.isVisible().catch(() => false))) {
        throw new DocumentTypeNotOfferedError(applicant.documentType);
    }
    // Role "radio" vs. "textbox" keeps these two apart even though they share the same accessible
    // name (e.g. both called "D.N.I.") — see the file-level note on this being a confirmed-live but
    // not yet re-verified-post-implementation risk.
    await documentTypeRadio.check();
    await page.getByRole("textbox", { name: radioLabel }).fill(applicant.documentId);
    await page.getByRole("textbox", { name: "Nombre y apellidos" }).fill(applicant.fullName);

    // Confirmed trámite-dependent: the recogida-de-TIE form has neither of these fields at all —
    // fill them only when the page actually asks for them, matching the
    // detectWafRejection/detectClavePanel "locator + isVisible().catch(() => false)" idiom used
    // throughout this file, instead of assuming a fixed field set for every trámite.
    // "Año de nacimiento" is type="number" — likely exposed as role "spinbutton", not "textbox" -
    // getByLabel sidesteps the role guess entirely.
    const birthYearField = page.getByLabel("Año de nacimiento");
    if (await birthYearField.isVisible().catch(() => false)) {
        await birthYearField.fill(String(applicant.birthYear));
    }

    // Recon's accessibility snapshot reported this combobox's accessible name as the placeholder
    // "Seleccionar ...", not "País de nacionalidad" — getByLabel here relies on a <label for=...>
    // association that wasn't independently confirmed against the raw HTML. Verify against the
    // real page once this runs live; a fallback (locating the select by a marker <option>, e.g.
    // "ESPAÑA", instead of by label) is the alternative if this doesn't hold up.
    const nationalityField = page.getByLabel("País de nacionalidad");
    if (await nationalityField.isVisible().catch(() => false)) {
        const countryCode = resolveCountryCode(applicant.nationality);
        if (countryCode === undefined) throw new UnknownNationalityError(applicant.nationality);
        await nationalityField.selectOption({ value: String(countryCode) });
    }
}

export async function runAvailabilityCheck(page: Page, request: CheckAvailabilityRequest): Promise<NavigationOutcome> {
    const { applicant } = request;

    if (applicant.documentType !== "pasaporte" && !isValidDocumentId(applicant.documentType, applicant.documentId)) {
        return { type: "validation_rejected", message: "Es incorrecto" };
    }

    const route = resolveProvinceRoute(request.province);
    if (route === undefined) throw new UnknownProvinceError(request.province);

    await page.goto(buildCitarUrl(route), { waitUntil: "domcontentloaded" });
    const wafAfterProvince = await detectWafRejection(page);
    if (wafAfterProvince !== undefined) return wafAfterProvince;

    await selectTramite(page, request.tramiteLabel);
    await page.getByRole("button", { name: "Aceptar" }).click();
    const wafAfterTramite = await detectWafRejection(page);
    if (wafAfterTramite !== undefined) return wafAfterTramite;

    if (await detectClavePanel(page)) return { type: "requires_clave" };

    await page.getByRole("button", { name: "Entrar" }).click();
    if (new URL(page.url()).hostname === CLAVE_HOSTNAME) return { type: "requires_clave" };
    const wafAfterEntrar = await detectWafRejection(page);
    if (wafAfterEntrar !== undefined) return wafAfterEntrar;

    await fillApplicantForm(page, applicant);
    await page.getByRole("button", { name: "Aceptar" }).click();

    const wafAfterSubmit = await detectWafRejection(page);
    if (wafAfterSubmit !== undefined) return wafAfterSubmit;

    const validationRejection = await detectValidationRejection(page);
    if (validationRejection !== undefined) return validationRejection;

    const solicitarCitaButton = await detectSolicitarCitaButton(page);
    if (solicitarCitaButton === undefined) return { type: "post_submit_unconfirmed" };
    if (applicant.phone === null) throw new PhoneRequiredError();

    await solicitarCitaButton.click();
    const wafAfterSolicitar = await detectWafRejection(page);
    if (wafAfterSolicitar !== undefined) return wafAfterSolicitar;

    await fillContactForm(page, applicant.phone, applicant.email);
    const wafAfterContact = await detectWafRejection(page);
    if (wafAfterContact !== undefined) return wafAfterContact;

    const offeredSlots = await detectOfferedSlots(page);
    return offeredSlots ?? { type: "post_submit_unconfirmed" };
}
