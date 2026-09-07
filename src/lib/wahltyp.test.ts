import { describe, expect, it } from "vitest";
import {
	erkenneWahltyp,
	kurzBezeichnung,
	slugify,
	wahlSlug,
} from "./wahltyp.ts";

describe("erkenneWahltyp", () => {
	it("erkennt die votemanager-Titel beider Termine", () => {
		expect(erkenneWahltyp("Landratswahl - Landkreis Hildesheim")).toBe(
			"landrat",
		);
		expect(
			erkenneWahltyp("Stichwahl des Landrats - Stadt Alfeld (Leine)"),
		).toBe("landrat-stichwahl");
		expect(erkenneWahltyp("Kreiswahl - Landkreis Hildesheim")).toBe("kreistag");
		expect(erkenneWahltyp("Kreistagswahl - Gemeinde Nordstemmen")).toBe(
			"kreistag",
		);
		expect(
			erkenneWahltyp(
				"Wahl des/der Bürgermeisters/in - Gemeinde Nordstemmen - Gemeinde Nordstemmen",
			),
		).toBe("buergermeister");
		expect(
			erkenneWahltyp("Wahl des/der Oberbürgermeisters/in - Stadt Hildesheim"),
		).toBe("buergermeister");
		expect(
			erkenneWahltyp(
				"Stichwahl des/der Bürgermeisters/in - Stadt Alfeld (Leine)",
			),
		).toBe("buergermeister-stichwahl");
		expect(
			erkenneWahltyp(
				"Samtgemeindebürgermeister(-innen)wahl - Samtgemeinde Leinebergland",
			),
		).toBe("buergermeister");
		expect(erkenneWahltyp("Gemeindewahl - Gemeinde Nordstemmen")).toBe("rat");
		expect(erkenneWahltyp("Stadtratswahl - Stadt Hildesheim")).toBe("rat");
		expect(
			erkenneWahltyp("Wahl des Rates der Stadt Sarstedt - Stadt Sarstedt"),
		).toBe("rat");
		expect(
			erkenneWahltyp("Samtgemeindewahl - Samtgemeinde Leinebergland"),
		).toBe("rat");
		expect(erkenneWahltyp("Ortsratswahl - Adensen - Ortschaft Adensen")).toBe(
			"ortsrat",
		);
	});
});

describe("kurzBezeichnung", () => {
	it("kürzt die sperrigen amtlichen Titel", () => {
		expect(
			kurzBezeichnung(
				"Wahl des/der Bürgermeisters/in - Gemeinde Nordstemmen",
				"buergermeister",
			),
		).toBe("Bürgermeisterwahl");
		expect(
			kurzBezeichnung(
				"Wahl des/der Oberbürgermeisters/in - Stadt Hildesheim",
				"buergermeister",
			),
		).toBe("Oberbürgermeisterwahl");
		expect(
			kurzBezeichnung(
				"Samtgemeindebürgermeister(-innen)wahl - Samtgemeinde Leinebergland",
				"buergermeister",
			),
		).toBe("Samtgemeindebürgermeisterwahl");
		expect(
			kurzBezeichnung("Landratswahl - Landkreis Hildesheim", "landrat"),
		).toBe("Landratswahl");
		expect(
			kurzBezeichnung(
				"Stichwahl des Landrats - Landkreis Hildesheim",
				"landrat-stichwahl",
			),
		).toBe("Stichwahl Landrat");
		expect(
			kurzBezeichnung("Kreiswahl - Landkreis Hildesheim", "kreistag"),
		).toBe("Kreistagswahl");
	});

	it("ergibt bei der Stichwahl nicht 'StichBürgermeisterwahl'", () => {
		expect(
			kurzBezeichnung(
				"Stichwahl des/der Bürgermeisters/in - Stadt Alfeld (Leine)",
				"buergermeister-stichwahl",
			),
		).toBe("Stichwahl Bürgermeister");
	});

	it("lässt Rats- und Ortsratswahlen bei ihrem amtlichen Namen", () => {
		expect(
			kurzBezeichnung(
				"Wahl des Rates der Stadt Sarstedt - Stadt Sarstedt",
				"rat",
			),
		).toBe("Wahl des Rates der Stadt Sarstedt");
		expect(
			kurzBezeichnung("Ortsratswahl - Adensen - Ortschaft Adensen", "ortsrat"),
		).toBe("Ortsratswahl");
	});
});

describe("wahlSlug", () => {
	it("hängt bei Ortsräten den Ort an", () => {
		expect(
			wahlSlug("ortsrat", "Ortsratswahl - Groß Escherde", "Groß Escherde"),
		).toBe("ortsrat-gross-escherde");
		expect(
			wahlSlug(
				"ortsrat",
				"Ortsratswahl - Adensen - Ortschaft Adensen",
				"Ortschaft Adensen",
			),
		).toBe("ortsrat-adensen");
		expect(wahlSlug("rat", "Gemeindewahl - Duingen", "Duingen")).toBe(
			"rat-duingen",
		);
		expect(
			wahlSlug(
				"rat",
				"Gemeindewahl - Gemeinde Nordstemmen",
				"Gemeinde Nordstemmen",
			),
		).toBe("rat");
		expect(
			wahlSlug(
				"landrat",
				"Landratswahl - Landkreis Hildesheim",
				"Landkreis Hildesheim",
			),
		).toBe("landrat");
	});
	it("slugify", () => {
		expect(slugify("Rössing")).toBe("roessing");
		expect(slugify("Stadt Alfeld (Leine)")).toBe("stadt-alfeld-leine");
	});
});
