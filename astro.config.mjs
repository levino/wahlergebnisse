import node from "@astrojs/node";
import preact from "@astrojs/preact";
import tailwind from "@astrojs/tailwind";
import { defineConfig } from "astro/config";

export default defineConfig({
	site: process.env.PUBLIC_SITE_URL || "https://wahlergebnisse.levinkeller.de",
	output: "server",
	adapter: node({ mode: "middleware" }),
	integrations: [tailwind(), preact()],
	vite: {
		ssr: { external: ["node:sqlite"] },
	},
});
