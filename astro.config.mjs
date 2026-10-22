import node from "@astrojs/node";
import preact from "@astrojs/preact";
import { defineConfig } from "astro/config";

export default defineConfig({
	site: process.env.PUBLIC_SITE_URL || "https://wahlergebnisse.levinkeller.de",
	output: "server",
	// Astro 7 kürzt Leerraum standardmäßig nach JSX-Regeln ("jsx"); das alte
	// Verhalten behalten, damit zwischen Inline-Elementen keine Leerzeichen fehlen.
	compressHTML: true,
	adapter: node({ mode: "middleware" }),
	integrations: [preact()],
	vite: {
		ssr: { external: ["node:sqlite"] },
	},
});
