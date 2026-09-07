import node from "@astrojs/node";
import preact from "@astrojs/preact";
import tailwind from "@astrojs/tailwind";
import { defineConfig } from "astro/config";

// Alles läuft on-demand (SSR): Die Seiten lesen bei jedem Aufruf den aktuellen
// Stand aus der SQLite-Datenbank, die der Poller (server/main.ts) füllt.
// Der Node-Adapter im Middleware-Modus liefert nur den Request-Handler; den
// HTTP-Server samt Poller-Schleife startet server/main.ts.
export default defineConfig({
	site: process.env.PUBLIC_SITE_URL || "https://wahlergebnisse.levinkeller.de",
	output: "server",
	adapter: node({ mode: "middleware" }),
	integrations: [tailwind(), preact()],
	vite: {
		// node:sqlite ist ein Node-Builtin und darf nicht gebündelt werden.
		ssr: { external: ["node:sqlite"] },
	},
});
