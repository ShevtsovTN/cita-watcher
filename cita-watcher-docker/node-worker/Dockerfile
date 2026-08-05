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

# --- Headless-запуск не требует root: Chromium уже настроен образом Playwright
#     под непривилегированного пользователя pwuser ---
USER pwuser

# CDP screencast relay поднимает свой WS-сервер на этом порту (см. CDP_RELAY_PORT)
EXPOSE 4001
# Health-check HTTP endpoint (см. HEALTH_PORT, docker-compose.yml's healthcheck:) — Phase 5
EXPOSE 4002

CMD ["node", "dist/index.js"]