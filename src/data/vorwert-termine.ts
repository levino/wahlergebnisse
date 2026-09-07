/**
 * Vorwerte der Direktwahlen – ERZEUGT, nicht von Hand ändern.
 *
 * Quelle: scripts/quellen/nds-vorwerte.json,
 * Erzeuger: scripts/kreise-erzeugen.ts, Beschreibung: scripts/quellen/vorwerte.md.
 *
 * 25 Termine mit 181 Zuordnungen zu 169 Behörden.
 *
 * **Wozu.** Die Seite stellt jedes Ergebnis neben die jeweils passende frühere
 * Wahl. Für Räte, Kreistage und Ortsräte ist das überall die Kommunalwahl vom
 * 12.09.2021 – die laufen im gemeinsamen Takt. Bürgermeister, Oberbürgermeister
 * und Landräte nicht: Ihre Amtszeiten sind eigene, und die letzte Wahl liegt je
 * nach Kommune 2013, 2019, 2022 oder 2025. Ohne diese Termine stünde neben der
 * Bürgermeisterwahl 2026 entweder gar nichts oder – schlimmer – die Ratswahl
 * 2021, also eine Zahl, die nichts mit ihr zu tun hat.
 *
 * **Warum je Behörde und nicht je Kreis.** Weil so ein Wahltag fast nie einen
 * ganzen Kreis betrifft: Am 26.05.2019 hat der Landkreis Emsland seinen Landrat
 * gewählt und acht seiner Gemeinden zusätzlich ihren Bürgermeister, die übrigen
 * keine einzige Wahl. Welche Behörde welchen Termin führt, steht deshalb in
 * `Behoerde.archive` im Kreiskatalog.
 *
 * Ordner und Schema sind hier die **Vorgabe** – der häufigste Wert unter den
 * Behörden dieses Tages. Wo eine abweicht (Duderstadt führt seine Termine als
 * `Wahl-2019-09-01`), löst der Poller den Fundort aus ihrem eigenen
 * Termin-Index auf, so wie bei jedem anderen Termin auch.
 */
import type { Termin } from "./termine.ts";

export const VORWERT_TERMINE: Termin[] = [
	{
		id: "2013-09-22",
		titel: "Landratswahlen 22. September 2013",
		datum: "2013-09-22",
		ordner: "20130922",
		layout: "v26",
		live: false,
		beschreibung:
			"Landratswahl in einer Wahlleitung – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2014-05-25",
		titel: "Bürgermeisterwahlen 25. Mai 2014",
		datum: "2014-05-25",
		ordner: "20140525",
		layout: "v26",
		live: false,
		beschreibung:
			"Bürgermeisterwahl in 4 Wahlleitungen – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2017-09-24",
		titel: "Bürgermeisterwahlen 24. September 2017",
		datum: "2017-09-24",
		ordner: "20170924",
		layout: "v22",
		live: false,
		beschreibung:
			"Bürgermeisterwahl in 2 Wahlleitungen – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2018-12-16",
		titel: "Bürgermeisterwahlen 16. Dezember 2018",
		datum: "2018-12-16",
		ordner: "20181216",
		layout: "v22",
		live: false,
		beschreibung:
			"Bürgermeisterwahl in einer Wahlleitung – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2019-05-26",
		titel: "Landrats- und Bürgermeisterwahlen 26. Mai 2019",
		datum: "2019-05-26",
		ordner: "20190526",
		layout: "v26",
		live: false,
		beschreibung:
			"Landratswahl in 114 Wahlleitungen, Bürgermeisterwahl in 47 Wahlleitungen – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2019-09-01",
		titel: "Bürgermeisterwahlen 1. September 2019",
		datum: "2019-09-01",
		ordner: "Wahl-2019-09-01",
		layout: "v26",
		live: false,
		beschreibung:
			"Bürgermeisterwahl in einer Wahlleitung – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2019-09-15",
		titel: "Bürgermeisterwahlen 15. September 2019",
		datum: "2019-09-15",
		ordner: "20190915",
		layout: "v22",
		live: false,
		beschreibung:
			"Bürgermeisterwahl in 2 Wahlleitungen – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2019-12-01",
		titel: "Bürgermeisterwahlen 1. Dezember 2019",
		datum: "2019-12-01",
		ordner: "20191201",
		layout: "v26",
		live: false,
		beschreibung:
			"Bürgermeisterwahl in einer Wahlleitung – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2020-02-09",
		titel: "Bürgermeisterwahlen 9. Februar 2020",
		datum: "2020-02-09",
		ordner: "20200209",
		layout: "v22",
		live: false,
		beschreibung:
			"Bürgermeisterwahl in einer Wahlleitung – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2020-02-23",
		titel: "Bürgermeisterwahlen 23. Februar 2020",
		datum: "2020-02-23",
		ordner: "20200223",
		layout: "v22",
		live: false,
		beschreibung:
			"Bürgermeisterwahl in einer Wahlleitung – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2020-09-20",
		titel: "Bürgermeisterwahlen 20. September 2020",
		datum: "2020-09-20",
		ordner: "20200920",
		layout: "v22",
		live: false,
		beschreibung:
			"Bürgermeisterwahl in einer Wahlleitung – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2020-10-25",
		titel: "Bürgermeisterwahlen 25. Oktober 2020",
		datum: "2020-10-25",
		ordner: "20201025",
		layout: "v22",
		live: false,
		beschreibung:
			"Bürgermeisterwahl in einer Wahlleitung – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2020-11-08",
		titel: "Bürgermeisterwahlen 8. November 2020",
		datum: "2020-11-08",
		ordner: "20201108",
		layout: "v22",
		live: false,
		beschreibung:
			"Bürgermeisterwahl in einer Wahlleitung – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2021-10-03",
		titel: "Bürgermeister-, Rats- und Ortsratswahlen 3. Oktober 2021",
		datum: "2021-10-03",
		ordner: "0120210912",
		layout: "v22",
		live: false,
		beschreibung:
			"Bürgermeisterwahl in 4 Wahlleitungen, Ratswahl in 6 Wahlleitungen, Ortsratswahl in 4 Wahlleitungen – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2022-01-23",
		titel: "Bürgermeisterwahlen 23. Januar 2022",
		datum: "2022-01-23",
		ordner: "20220123",
		layout: "v22",
		live: false,
		beschreibung:
			"Bürgermeisterwahl in einer Wahlleitung – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2022-02-27",
		titel: "Kreistags-, Bürgermeister- und Ratswahlen 27. Februar 2022",
		datum: "2022-02-27",
		ordner: "20220227",
		layout: "v22",
		live: false,
		beschreibung:
			"Kreistagswahl in 8 Wahlleitungen, Bürgermeisterwahl in 2 Wahlleitungen, Ratswahl in einer Wahlleitung – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2022-03-06",
		titel: "Ortsratswahlen 6. März 2022",
		datum: "2022-03-06",
		ordner: "20220306",
		layout: "v22",
		live: false,
		beschreibung:
			"Ortsratswahl in einer Wahlleitung – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2022-10-09",
		titel: "Landratswahlen 9. Oktober 2022",
		datum: "2022-10-09",
		ordner: "20221009",
		layout: "v22",
		live: false,
		beschreibung:
			"Landratswahl in einer Wahlleitung – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2023-03-05",
		titel: "Bürgermeisterwahlen 5. März 2023",
		datum: "2023-03-05",
		ordner: "20230305",
		layout: "v26",
		live: false,
		beschreibung:
			"Bürgermeisterwahl in einer Wahlleitung – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2024-06-09",
		titel: "Ortsratswahlen 9. Juni 2024",
		datum: "2024-06-09",
		ordner: "20240609",
		layout: "v26",
		live: false,
		beschreibung:
			"Ortsratswahl in einer Wahlleitung – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2024-10-27",
		titel: "Ortsratswahlen 27. Oktober 2024",
		datum: "2024-10-27",
		ordner: "20241027",
		layout: "v26",
		live: false,
		beschreibung:
			"Ortsratswahl in einer Wahlleitung – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2025-02-23",
		titel: "Bürgermeisterwahlen 23. Februar 2025",
		datum: "2025-02-23",
		ordner: "20250223",
		layout: "v26",
		live: false,
		beschreibung:
			"Bürgermeisterwahl in einer Wahlleitung – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2025-10-05",
		titel: "Ortsratswahlen 5. Oktober 2025",
		datum: "2025-10-05",
		ordner: "2025072201",
		layout: "v26",
		live: false,
		beschreibung:
			"Ortsratswahl in einer Wahlleitung – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2025-10-12",
		titel: "Bürgermeisterwahlen 12. Oktober 2025",
		datum: "2025-10-12",
		ordner: "20251012",
		layout: "v26",
		live: false,
		beschreibung:
			"Bürgermeisterwahl in einer Wahlleitung – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
	{
		id: "2025-12-14",
		titel: "Ortsratswahlen 14. Dezember 2025",
		datum: "2025-12-14",
		ordner: "20251214",
		layout: "v26",
		live: false,
		beschreibung:
			"Ortsratswahl in einer Wahlleitung – die letzte Wahl dieser Ämter vor dem 13. September 2026 und damit ihr Vergleichswert.",
	},
];
