/**
 * Общие доменные типы, которыми `automation/`, `captcha/` и `messaging/` обмениваются вместо
 * прямых импортов конкретных классов друг у друга (см. node-worker/CLAUDE.md, "Conventions").
 * Реэкспортирует всё из соседних файлов этой директории — остальной код импортирует из "./types",
 * не из конкретных файлов внутри неё.
 */
export * from "./check-result";
export * from "./commands";
export * from "./events";
