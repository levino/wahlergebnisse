import { describe, expect, it } from "vitest";
import { kreisBySlug } from "../data/kreise.ts";
import { gemeindeDerZeile } from "./kreiswahl.ts";

const peine = kreisBySlug("peine")!;
const hildesheim = kreisBySlug("hildesheim")!;

describe("gemeindeDerZeile", () => {
	it("nimmt den Gebietsschlüssel aus dem Verweis", () => {
		expect(
			gemeindeDerZeile(peine, {
				label: "Gemeinde Edemissen",
				externeUrl: "../../03157001/praesentation/index.html",
			})?.slug,
		).toBe("edemissen");
	});

	it("sucht nur im eigenen Kreis", () => {
		expect(
			gemeindeDerZeile(hildesheim, {
				label: "Gemeinde Edemissen",
				externeUrl: "../../03157001/praesentation/index.html",
			}),
		).toBeUndefined();
	});

	it("fällt ohne Verweis auf den Namen zurück", () => {
		expect(
			gemeindeDerZeile(hildesheim, { label: "Gemeinde Nordstemmen" })?.slug,
		).toBe("nordstemmen");
		expect(
			gemeindeDerZeile(hildesheim, { label: "Stadt Alfeld (Leine)" })?.slug,
		).toBe("alfeld");
	});

	it("die Summenzeile des Kreises ist keine Gemeinde", () => {
		expect(
			gemeindeDerZeile(hildesheim, { label: "Landkreis Hildesheim" }),
		).toBeUndefined();
		expect(gemeindeDerZeile(hildesheim, { label: "Wahlbereich B" })).toBe(
			undefined,
		);
	});
});
