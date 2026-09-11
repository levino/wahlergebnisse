import plugin from "tailwindcss/plugin";
import { cduColors, cduDaisyTheme } from "./theme.mjs";

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
			screens: { xs: "400px" },
			fontFamily: {
				sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
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
