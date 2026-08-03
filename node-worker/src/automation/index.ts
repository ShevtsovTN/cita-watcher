/**
 * Публичный API `automation/` — остальной код (`messaging/`, `captcha/`, `index.ts`) импортирует
 * отсюда, не из `session-manager.ts` напрямую (см. node-worker/CLAUDE.md, "Conventions").
 */
export * from "./session-manager";
