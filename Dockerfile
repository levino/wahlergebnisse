# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM alpine:3.21 AS ausgangsbestand
ARG SCHNAPPSCHUSS=daten-2026-09-07
ARG SCHNAPPSCHUSS_REPO=levino/wahlergebnisse
RUN apk add --no-cache curl
WORKDIR /schnappschuss
RUN set -eu; \
	if [ "$SCHNAPPSCHUSS" = "keiner" ]; then \
		echo "Ohne Ausgangsbestand – die Instanz sammelt alles selbst."; \
	else \
		url="https://github.com/${SCHNAPPSCHUSS_REPO}/releases/download/${SCHNAPPSCHUSS}/wahlen.db.zst"; \
		echo "Ausgangsbestand ${SCHNAPPSCHUSS} von ${url}"; \
		curl -fsSL --retry 3 "$url" -o wahlen.db.zst; \
		ls -l wahlen.db.zst; \
	fi

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 DATABASE_PATH=/data/wahlen.db
RUN mkdir -p /data && chown -R node:node /data
COPY --from=ausgangsbestand /schnappschuss/ /app/schnappschuss/
COPY --from=build /app/daten ./daten
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/scripts/schnappschuss.ts ./scripts/schnappschuss.ts
COPY --from=build /app/scripts/demo-bestand.ts ./scripts/demo-bestand.ts
COPY --from=build /app/package.json ./package.json
USER node
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "--no-warnings", "--experimental-strip-types", "server/main.ts"]
