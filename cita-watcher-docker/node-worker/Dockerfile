# syntax=docker/dockerfile:1
#
# Базовый образ уже содержит Node.js нужной версии + Chromium/Firefox/WebKit,
# собранные под конкретную версию Playwright — версия тега ДОЛЖНА совпадать
# с версией пакета "playwright" в package.json, иначе бинарники браузера не найдутся.
FROM mcr.microsoft.com/playwright:v1.61.0-noble

WORKDIR /usr/src/app

# --- Зависимости отдельным слоем (кешируется, пока не меняются package*.json) ---
COPY package.json package-lock.json ./
RUN npm ci

# --- Исходники и сборка TypeScript -> dist/ ---
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- Запуск от непривилегированного pwuser: тот же пользователь, под которым Playwright
#     уже настроен в базовом образе ---
USER pwuser

# CDP screencast relay поднимает свой WS-сервер на этом порту (см. CDP_RELAY_PORT)
EXPOSE 4001
# Health-check HTTP endpoint (см. HEALTH_PORT, docker-compose.yml's healthcheck:) — Phase 5
EXPOSE 4002

# `xvfb-run` (уже есть в базовом образе Playwright): automation/session-manager.ts запускает
# Chromium с `headless: false`, а не headless — см. ../../docs/NODE_WORKER_ROADMAP.md Phase 9 —
# плоский `headless: true` ни разу не прошёл собственную bot-defense целевого сайта живьём, а
# `headless: false` под виртуальным дисплеем — прошёл. `xvfb-run -a` сам поднимает Xserver на
# свободном :N и держит его на всё время жизни обёрнутого процесса — то же самое, чем это было
# подтверждено вживую в dev-контейнере, просто не для разового скрипта, а для долгоживущего
# `node dist/index.js`.
CMD ["xvfb-run", "-a", "node", "dist/index.js"]