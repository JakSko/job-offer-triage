# Obraz aplikacji dla Railway (F6): jeden przebieg i koniec procesu (cron co 30 min uruchamia go ponownie).
# Budowanie z katalogu app:  docker build -t oferty-pracy .
# Konfiguracja wyłącznie ze zmiennych środowiskowych (patrz docs/migracja/06_wdrozenie_railway.md);
# plik .env nie trafia do obrazu.

FROM node:24-slim AS budowanie
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
ENV NODE_ENV=production \
    TRYB=railway
WORKDIR /app
COPY --from=budowanie /app/node_modules ./node_modules
COPY --from=budowanie /app/dist ./dist
COPY package.json ./
# CV dla modelu (W-34): ten sam plik co na laptopie, z repo
COPY dane ./dane
USER node
CMD ["node", "dist/cli.js", "run"]
