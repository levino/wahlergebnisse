import plugin from "tailwindcss/plugin";
import { cduColors, cduDaisyTheme } from "./theme.mjs";

// Deutsche Komposita sind lang — im Fließtext und in schmalen Karten-
// Überschriften rettet automatische Silbentrennung den Flattersatz.
// Bei den großen Display-Überschriften (h1/h2) tut sie das Gegenteil: dort
// steht dann "Unsere Verbän-de" quer über die Seite, weil ein Wort um wenige
// Pixel nicht passt. h1/h2 trennen deshalb nicht, brechen aber weiterhin
// überlange Wörter statt aus dem Layout zu laufen.
const hyphenationPlugin = plugin(({ addBase }) => {
	addBase({
		"h1, h2, h3, h4, h5, h6, p, li, td, th, blockquote": {
			"overflow-wrap": "break-word",
		},
		"h3, h4, h5, h6, p, li, td, th, blockquote": {
			hyphens: "auto",
		},
		"h1, h2": {
			hyphens: "manual",
			"text-wrap": "balance",
		},
	});
});

/** @type {import('tailwindcss').Config} */
export default {
	content: ["./src/**/*.{astro,html,js,jsx,ts,tsx}"],
	theme: {
		extend: {
			colors: {
				cadenabbia: cduColors.cadenabbia,
				rhoendorf: cduColors.rhoendorf,
				unionsschwarz: cduColors.unionsschwarz,
				unionsgold: cduColors.unionsgold,
				unionsrot: cduColors.unionsrot,
			},
			// Sehr schmale Geräte: dort verschwinden Beiwörter wie "Stimmen",
			// damit Name und Zahl in eine Zeile passen.
			screens: { xs: "400px" },
			fontFamily: {
				sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
				// Serifenschrift nur als Rückfallkette – diese App lädt keine
				// eigenen Schriftdateien und bleibt bei den Systemschriften.
				serif: [
					"IBM Plex Serif",
					"IBM Plex Serif Fallback",
					"Georgia",
					"Cambria",
					"Times New Roman",
					"serif",
				],
			},
		},
	},
	plugins: [
		require("@tailwindcss/typography"),
		require("daisyui"),
		hyphenationPlugin,
	],
	daisyui: {
		themes: [cduDaisyTheme],
		darkTheme: false,
	},
};
