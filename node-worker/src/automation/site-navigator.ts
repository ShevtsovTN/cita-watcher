/**
 * Реальный флоу сайта `icp.administracionelectronica.gob.es`, снятый вживую через Claude in Chrome
 * (см. ../../../docs/NODE_WORKER_ROADMAP.md Phase 1): провинция → trámite (один из двух отдельных
 * `<select>`, набор доступных trámite отличается по провинциям) → либо панель "Presentación con
 * Cl@ve" (для этой процедуры анонимный флоу вообще не работает — дальше не идём), либо страница
 * `/icpplus/acInfo` с кнопкой "Entrar" → форма заявителя `/icpplus/acEntrada` → сабмит.
 *
 * Подтверждённый блокер — НЕ капча: WAF (сигнатура F5 BIG-IP ASM, "Request Rejected"/"The
 * requested URL was rejected"), который встал липким на всю сессию после сабмита формы заявителя.
 * Что реально показывается после чистого (не отбитого WAF) сабмита — капча, "нет мест" или список
 * слотов — не подтверждено (recon упёрся в WAF раньше). См. `PostSubmitUnconfirmed`.
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
 * TODO(../../../docs/NODE_WORKER_ROADMAP.md Phase 1): капча vs. "нет мест" vs. реальный список
 * слотов после чистого сабмита не подтверждён — WAF заблокировал recon раньше. Не выдумывать
 * селекторы, заменить на реальные варианты только после подтверждения на живом сайте.
 */
export interface PostSubmitUnconfirmed {
    readonly type: "post_submit_unconfirmed";
}
export type NavigationOutcome = RequiresClave | WafRejected | ValidationRejected | PostSubmitUnconfirmed;

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

const TRAMITE_SELECT_PLACEHOLDER = "Despliega para ver trámites disponibles en esta provincia";
const CLAVE_HOSTNAME = "pasarela.clave.gob.es";
const WAF_SUPPORT_ID_PATTERN = /support id is:\s*<?([\w-]+)>?/i;

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

    // Role "radio" vs. "textbox" keeps these two apart even though they share the same accessible
    // name (e.g. both called "D.N.I.") — see the file-level note on this being a confirmed-live but
    // not yet re-verified-post-implementation risk.
    await page.getByRole("radio", { name: radioLabel }).check();
    await page.getByRole("textbox", { name: radioLabel }).fill(applicant.documentId);
    await page.getByRole("textbox", { name: "Nombre y apellidos" }).fill(applicant.fullName);
    // "Año de nacimiento" is type="number" — likely exposed as role "spinbutton", not "textbox" -
    // getByLabel sidesteps the role guess entirely.
    await page.getByLabel("Año de nacimiento").fill(String(applicant.birthYear));

    const countryCode = resolveCountryCode(applicant.nationality);
    if (countryCode === undefined) throw new UnknownNationalityError(applicant.nationality);

    // Recon's accessibility snapshot reported this combobox's accessible name as the placeholder
    // "Seleccionar ...", not "País de nacionalidad" — getByLabel here relies on a <label for=...>
    // association that wasn't independently confirmed against the raw HTML. Verify against the
    // real page once this runs live; a fallback (locating the select by a marker <option>, e.g.
    // "ESPAÑA", instead of by label) is the alternative if this doesn't hold up.
    await page.getByLabel("País de nacionalidad").selectOption({ value: String(countryCode) });
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

    return { type: "post_submit_unconfirmed" };
}
