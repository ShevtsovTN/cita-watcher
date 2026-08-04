/**
 * Публичный API `automation/` — остальной код (`messaging/`, `captcha/`, `index.ts`) импортирует
 * отсюда, не из отдельных файлов напрямую (см. node-worker/CLAUDE.md, "Conventions").
 */
export * from "./session-manager";
export * from "./province-routes";
export * from "./country-codes";
export * from "./document-id-validator";
export * from "./site-navigator";
export * from "./availability-checker";
