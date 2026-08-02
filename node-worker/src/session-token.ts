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

export function generateSessionToken(): SessionToken {
    return randomBytes(TOKEN_BYTES).toString("base64url");
}
