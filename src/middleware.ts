import { defineMiddleware } from "astro:middleware";
import { TERMINE, type Termin, istLive, terminById } from "./data/termine.ts";
import { seitenCacheControl } from "./lib/http.ts";
import { altePfadUmschreibung, kreisAusPfad } from "./lib/pfade.ts";

const seitenTermin = (pfad: string): Termin | undefined =>
	terminById(pfad.split("/")[2] ?? "") ??
	(kreisAusPfad(pfad)
		? (TERMINE.find(istLive) ?? TERMINE.find((t) => t.live) ?? TERMINE[0])
		: undefined);

export const onRequest = defineMiddleware(async (context, next) => {
	const { pathname, search } = context.url;

	const ziel = altePfadUmschreibung(pathname);
	if (ziel) return context.redirect(`${ziel}${search}`, 301);

	const antwort = await next();
	if (
		antwort.status === 200 &&
		(antwort.headers.get("content-type") ?? "").startsWith("text/html") &&
		!antwort.headers.has("cache-control")
	) {
		const gezeigt = seitenTermin(pathname);
		antwort.headers.set(
			"cache-control",
			seitenCacheControl(Boolean(gezeigt && istLive(gezeigt))),
		);
	}
	return antwort;
});
