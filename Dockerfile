# syntax=docker/dockerfile:1
# Wahlergebnisse: Astro-SSR, Poller und SQLite in einem Node-Prozess.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATABASE_PATH=/data/wahlen.db
RUN mkdir -p /data && chown -R node:node /data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# server/ und src/ laufen zur Laufzeit direkt als TypeScript (Type-Stripping)
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./package.json
USER node
VOLUME ["/data"]
EXPOSE 8080
# --experimental-strip-types: TypeScript direkt ausführen. Ab Node 22.18 ist das
# der Standard, das Flag bleibt gültig; auf älteren 22ern ist es nötig.
CMD ["node", "--no-warnings", "--experimental-strip-types", "server/main.ts"]
