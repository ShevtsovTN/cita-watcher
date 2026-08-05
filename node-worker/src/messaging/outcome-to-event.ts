/**
 * Отображает `NavigationOutcome` (../automation/site-navigator.ts) в исходящий `WorkerEvent` — то,
 * что `command-handler.ts` публикует после каждого прогона `checkAvailability`. См.
 * ../../docs/NODE_WORKER_ROADMAP.md Phase 3.
 *
 * Все пять сегодняшних вариантов `NavigationOutcome` мапятся на `CheckFailedEvent` — ни
 * `CheckCompletedEvent` (нет подтверждённого реального бронирования), ни `CaptchaRequiredEvent`
 * (у него до сих пор нет session-токена — публиковать его значило бы обещать действие, которое
 * никто не сможет выполнить) ещё нельзя выдать честно. Это не временная заглушка "пока не
 * доделали" — это текущее состояние знания о сайте и контракта; расширять этот switch новыми
 * вариантами `WorkerEvent` можно только вместе с новым подтверждённым вариантом `NavigationOutcome`
 * в site-navigator.ts, не раньше.
 *
 * `retryable` по каждому варианту:
 *  - `requires_clave` → `false`: Cl@ve-only trámite физически не пройти автоматизацией никогда,
 *    retry не поможет.
 *  - `waf_rejected` → `true`: WAF-блок — по определению временный (см. Phase 1 roadmap notes,
 *    "flagged here for messaging/ (Phase 3) to eventually map onto CheckFailedEvent{retryable: true}").
 *  - `validation_rejected` → `false`: те же данные заявителя дадут тот же "Es incorrecto" снова.
 *  - `post_submit_unconfirmed` → `true`: намеренно консервативный выбор — раз неизвестно, что было
 *    на странице (капча/нет мест/реальный список), не заявляем ни то, ни другое, просто пробуем
 *    ещё раз по расписанию. Отличается от "оптимистичного" варианта (трактовать как капчу) тем, что
 *    не притворяется уверенностью, которой на самом деле нет.
 *  - `captcha_blocked_slots_offered` → `true`: ничего не забронировано, а собственный 5-минутный
 *    таймер сайта (см. site-navigator.ts) в любом случае аннулирует именно эти слоты раньше, чем
 *    что-либо ниже по потоку успеет отреагировать — retry по расписанию честнее, чем
 *    `CaptchaRequiredEvent` без токена, на который никто не сможет отреагировать.
 */

import type { NavigationOutcome } from "../automation";
import type { CheckFailedEvent } from "../types";

export function mapNavigationOutcomeToCheckFailedEvent(
    outcome: NavigationOutcome,
    watchTaskId: number,
    occurredAt: string,
): CheckFailedEvent {
    switch (outcome.type) {
        case "requires_clave":
            return {
                type: "check_failed",
                watchTaskId,
                reason: "This trámite requires Cl@ve authentication, which the automated flow cannot complete.",
                retryable: false,
                occurredAt,
            };
        case "waf_rejected":
            return {
                type: "check_failed",
                watchTaskId,
                reason:
                    outcome.supportId === null
                        ? "Rejected by the site's WAF."
                        : `Rejected by the site's WAF (support id: ${outcome.supportId}).`,
                retryable: true,
                occurredAt,
            };
        case "validation_rejected":
            return {
                type: "check_failed",
                watchTaskId,
                reason: outcome.message,
                retryable: false,
                occurredAt,
            };
        case "post_submit_unconfirmed":
            return {
                type: "check_failed",
                watchTaskId,
                reason: "Post-submit page could not be interpreted (captcha vs. no slots vs. a real listing is unconfirmed).",
                retryable: true,
                occurredAt,
            };
        case "captcha_blocked_slots_offered":
            return {
                type: "check_failed",
                watchTaskId,
                reason:
                    outcome.slots.length === 0
                        ? "Reached the offered-slots step but a required captcha blocked completion (no slot details could be parsed)."
                        : `Found ${String(outcome.slots.length)} offered slot(s) (${outcome.slots
                              .map((slot) => `${slot.day} ${slot.time}`)
                              .join(", ")}), but a required captcha blocked completion.`,
                retryable: true,
                occurredAt,
            };
    }
}
