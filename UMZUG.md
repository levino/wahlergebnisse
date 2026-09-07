# Umzug nach levino/wahlergebnisse

Dieses Verzeichnis ist der fertige, eigenständige Stand der App. Es liegt
noch nicht auf GitHub, weil die GitHub-App keine Repos anlegen darf (403).

## Was zu tun ist

1. **Leeres Repo anlegen**: `levino/wahlergebnisse`, öffentlich, ohne README,
   ohne Lizenz, ohne .gitignore (der Inhalt kommt aus dem ersten Commit).
2. **Code pushen** (der erste Commit liegt fertig vor):
   ```bash
   cd /tmp/wahlergebnisse
   git remote add origin https://github.com/levino/wahlergebnisse.git
   git branch -M main
   git push -u origin main
   ```
3. **DNS**: `wahlergebnisse.levinkeller.de` löst derzeit nur über den
   Wildcard-AAAA auf (IPv6 des Servers). Für IPv4-Besucher fehlt ein
   A-Record auf 116.202.20.205 — bei Cloudflare anzulegen.
4. **Argo**: Der Eintrag liegt als PR bereit:
   levino/server-config#64 (`apps/wahlergebnisse.yaml` plus Eintrag in
   `apps/kustomization.yaml`). Erst mergen, wenn Schritt 2 erledigt ist —
   sonst zeigt die Application auf ein leeres Repo.
5. **Erster Start**: Der Poller lädt die Archive 2020 und 2021 einmal
   vollständig (~4 500 Anfragen, ein paar Minuten) und danach nur noch
   Änderungen.

## Was schon fertig ist

- Eigenständiges Projekt ohne Monorepo-Abhängigkeiten (Tailwind-Theme liegt
  als `theme.mjs` bei)
- `deploy/base` und `deploy/overlays/production` nach der Konvention des
  Clusters (Argo liest das Overlay, die CI trägt den Image-Tag ein)
- `.github/workflows/ci.yml` (Typen, Lint, Unit- und Browser-Tests) und
  `deploy.yml` (ARM-Build, GHCR, Tag ins Overlay, race-fest)
- Alle Verweise zeigen auf das neue Zuhause: Fußzeile, API-Kontakt,
  User-Agent des Pollers, `PUBLIC_SITE_URL`
- Geprüft: 72 Unit- und Integrationstests, 36 Browser-Tests, Lint und Build

## Was danach zu entscheiden ist

`apps/wahlen` im Repo cdu-kv-hildesheim/websites läuft weiter unter
wahlen.cduhildesheim.de. Beide Kopien nebeneinander zu pflegen, lohnt nicht:
Entweder die CDU-Instanz wird abgeschaltet und `cduhildesheim.de` verlinkt
auf die neue Adresse, oder umgekehrt. Das ist eine Entscheidung, keine
technische Frage — beides ist mit wenigen Handgriffen erledigt.
