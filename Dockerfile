# Сборка из корня проекта. Используется и docker compose, и хостингами вроде BotHost
# (вариант «свой Dockerfile»). Порт берётся из переменной PORT, по умолчанию 3000.
FROM node:22-alpine AS build
WORKDIR /srv/backend
COPY backend/package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY backend/tsconfig*.json ./
COPY backend/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /srv/backend
ENV NODE_ENV=production
COPY --from=build /srv/backend/node_modules ./node_modules
COPY --from=build /srv/backend/dist ./dist
COPY backend/package.json ./
COPY backend/migrations ./migrations
COPY webapp /srv/webapp
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/health" >/dev/null || exit 1
CMD ["node", "dist/main.js"]
