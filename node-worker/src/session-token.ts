/**
 * Идентификатор сессии, встраиваемый прямо в путь `/captcha-ws/<token>` и связывающий входящее
 * WS-соединение с конкретной CDP/Chromium-сессией (`captcha/`, Phase 2). nginx для этого пути
 * никакой аутентификации не делает (см. корневой ../../CLAUDE.md, "Cross-service architecture") —
 * сам токен и есть единственная защита, поэтому он должен быть криптографически случайным и
 * непредсказуемым, а не просто уникальным (обычный `randomUUID()` даёт лишь ~122 бита энтропии и
 * узнаваемую структуру; здесь — 256 бит сырых случайных байт).
 *
 * Известный открытый вопрос (см. ../../docs/NODE_WORKER_ROADMAP.md Phase 0 notes): текущий
 * `CaptchaRequiredEvent` (см. types.ts) не несёт сам токен — Laravel-стороне сейчас нечем передать
 * человеку ссылку на `/captcha-ws/<token>`. Это осознанно не решается здесь; должно быть закрыто
 * вместе с Phase 2 (`captcha/`, когда токен реально начинает к чему-то привязываться) или Phase 3
 * (`messaging/`, если токен должен ехать в `CaptchaRequiredEvent`).
 */

import { randomBytes } from "node:crypto";

/** Непрозрачная строка — не создавать вручную, только через `generateSessionToken()`. */
export type SessionToken = string;

const TOKEN_BYTES = 32;
/** base64url без паддинга: ceil(bytes * 8 / 6) символов. */
const TOKEN_LENGTH = Math.ceil((TOKEN_BYTES * 8) / 6);
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

export function generateSessionToken(): SessionToken {
    return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * Проверка формы (не подлинности) токена: используется `captcha/`'s WS-сервером (Phase 2) для
 * разбора пути `/captcha-ws/<token>` — отсеивает заведомо не наш токен ещё до того, как
 * какой-либо реестр сессий вообще спросят, известен ли он.
 */
export function isSessionToken(value: string): value is SessionToken {
    return value.length === TOKEN_LENGTH && BASE64URL_PATTERN.test(value);
}
