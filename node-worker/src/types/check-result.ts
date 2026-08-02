/** Один свободный слот записи, найденный на сайте. */
export interface AppointmentSlot {
    /** ISO 8601. */
    readonly dateTime: string;
    readonly office: string;
}

/**
 * Внутренний результат проверки `automation/` — то, что `messaging/` дальше оборачивает в
 * `CheckCompletedEvent` (см. `./events`) для публикации. Не сериализуется сам по себе как
 * отдельный wire-объект.
 */
export interface CheckResult {
    readonly slots: readonly AppointmentSlot[];
    /** ISO 8601. */
    readonly checkedAt: string;
}
