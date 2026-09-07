# syntax=docker/dockerfile:1
# Wahlergebnisse: Astro-SSR, Poller und SQLite in einem Node-Prozess.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# --- Ausgangsbestand -------------------------------------------------------
#
# Eine frische Instanz soll nicht vier Stunden lang 63 000 Anfragen an fremde
# Server stellen, ehe sie etwas zeigt (docs/ausgangsbestand.md). Deshalb liegt
# eine fertige Datenbank als Anhang eines GitHub-Release bereit und wird hier
# ins Image gebacken. Kein Download zur Laufzeit, kein Token – das Release ist
# öffentlich.
#
# **Eine eigene Stufe, und zwar vor jedem COPY des Quellcodes.** Nur so hängt
# der ~70-MB-Layer allein an der Fassung unten und nicht am letzten Commit.
# Ein gewöhnlicher Code-Push zieht ihn also nicht neu.
#
# **So wird eine neue Fassung eingespielt:** unten `SCHNAPPSCHUSS` auf den
# Release-Namen setzen (`daten-JJJJ-MM-TT`) und committen. Das ist die einzige
# Stelle, an der die Fassung steht.
#
# `keiner` heißt: ohne Ausgangsbestand bauen. Das ist die Voreinstellung,
# solange noch kein Schnappschuss veröffentlicht ist – der Archivlauf muss
# einmal durch sein, ehe es einen zu ziehen gibt.
FROM alpine:3.21 AS ausgangsbestand
ARG SCHNAPPSCHUSS=keiner
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
# Der Ausgangsbestand zuerst: Er ändert sich selten, der Code bei jedem Push.
# So bleibt der große Layer beim Ausrollen liegen, wo er liegt.
COPY --from=ausgangsbestand /schnappschuss/ /app/schnappschuss/
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# server/ und src/ laufen zur Laufzeit direkt als TypeScript (Type-Stripping)
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
# Damit sich ein Schnappschuss auch aus dem laufenden Poller-Pod ziehen lässt
# (kubectl exec, siehe docs/ausgangsbestand.md).
COPY --from=build /app/scripts/schnappschuss.ts ./scripts/schnappschuss.ts
COPY --from=build /app/package.json ./package.json
USER node
VOLUME ["/data"]
EXPOSE 8080
# --experimental-strip-types: TypeScript direkt ausführen. Ab Node 22.18 ist das
# der Standard, das Flag bleibt gültig; auf älteren 22ern ist es nötig.
CMD ["node", "--no-warnings", "--experimental-strip-types", "server/main.ts"]
