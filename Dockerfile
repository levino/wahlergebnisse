# syntax=docker/dockerfile:1@sha256:4edf897a3ffa55b89f906fc8cc78afdb3f1834cc9c7083565e611a8a7d5fe99e
FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM alpine:3.21@sha256:ee16d92f96db08d9d2d07da48555a27f3a69d8f0759021dbc601195ed0d2b5bd AS ausgangsbestand
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

FROM node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914
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
