/** Das Abspielen hinterlegter Aufnahmen und die Schlange davor. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const modul = async () => {
	vi.resetModules();
	return await import("./stimme.ts");
};

describe("der Hinweis auf die erzeugte Stimme", () => {
	it("sagt, dass die Stimme synthetisch ist – Auflage des Anbieters", async () => {
		const { STIMME_HINWEIS } = await modul();
		expect(STIMME_HINWEIS).toMatch(/synthetisch/i);
	});
});

describe("die Warteschlange der Moderationsbeiträge", () => {
	const gespielt: string[] = [];
	const gezeigt: string[] = [];
	const getoent: string[] = [];
	const freigegeben: string[] = [];
	let klaenge: FakeAudio[] = [];

	class FakeAudio {
		src: string;
		horcher = new Map<string, (() => void)[]>();
		constructor(src: string) {
			this.src = src;
			klaenge.push(this);
		}
		addEventListener(art: string, fn: () => void) {
			this.horcher.set(art, [...(this.horcher.get(art) ?? []), fn]);
		}
		ausloesen(art: string) {
			for (const fn of this.horcher.get(art) ?? []) fn();
		}
		pause() {}
		async play() {
			gespielt.push(this.src);
		}
	}

	const umgebung = (opts: { ton: boolean; an?: boolean; ok?: boolean }) => {
		gespielt.length = 0;
		gezeigt.length = 0;
		getoent.length = 0;
		freigegeben.length = 0;
		klaenge = [];
		let n = 0;
		vi.stubGlobal("fetch", async () => ({
			ok: opts.ok ?? true,
			status: opts.ok === false ? 404 : 200,
			blob: async () => ({ size: 42, nummer: n++ }),
		}));
		Object.assign(URL, {
			createObjectURL: (b: { nummer?: number }) => `blob:${b.nummer ?? 0}`,
			revokeObjectURL: (a: string) => freigegeben.push(a),
		});
		vi.stubGlobal("Audio", FakeAudio);
		vi.stubGlobal("window", {});
		vi.doMock("./klang.ts", () => ({
			tonFrei: () => opts.ton,
			tonAn: () => opts.an ?? true,
		}));
	};

	const auftrag = (
		name: string,
		mehr: { dringend?: boolean; seit?: number } = {},
	) => ({
		url: `/api/beitrag/${name}.mp3`,
		...mehr,
		zeige: () => gezeigt.push(name),
		ton: () => getoent.push(name),
	});

	let letzter: { grund: string; meldung?: string } | undefined;

	const geladen = async () => {
		const m = await modul();
		letzter = undefined;
		m.wennAnsageSpur((h) => {
			letzter = h;
		});
		return m;
	};

	beforeEach(() => {
		vi.doUnmock("./klang.ts");
	});

	it("zeigt Einblender, Ton und Stimme in einem Zug", async () => {
		umgebung({ ton: true });
		const { reiheBeitragEin } = await geladen();
		reiheBeitragEin(auftrag("eins"));
		await vi.waitFor(() => expect(gespielt).toHaveLength(1));
		expect(gezeigt).toEqual(["eins"]);
		expect(getoent).toEqual(["eins"]);
	});

	it("spricht keinen Beitrag über die laufende Tonprobe", async () => {
		umgebung({ ton: true });
		const { sprichProbe, reiheBeitragEin } = await geladen();
		sprichProbe();
		await vi.waitFor(() => expect(gespielt).toHaveLength(1));
		reiheBeitragEin(auftrag("eins"));
		await new Promise((f) => setTimeout(f, 20));
		expect(gespielt).toHaveLength(1);
		klaenge[0].ausloesen("ended");
		await vi.waitFor(() => expect(gespielt).toHaveLength(2));
	});

	it("lässt nie zwei übereinander sprechen", async () => {
		umgebung({ ton: true });
		const { reiheBeitragEin } = await geladen();
		reiheBeitragEin(auftrag("eins"));
		await vi.waitFor(() => expect(gespielt).toHaveLength(1));
		reiheBeitragEin(auftrag("zwei"));
		await vi.waitFor(() => expect(klaenge).toHaveLength(2));
		expect(gespielt).toHaveLength(1);
		expect(gezeigt).toEqual(["eins"]);
		klaenge[0].ausloesen("ended");
		await vi.waitFor(() => expect(gespielt).toHaveLength(2));
		expect(gezeigt).toEqual(["eins", "zwei"]);
	});

	it("stellt Dringendes an den Anfang, schneidet aber nicht ab", async () => {
		umgebung({ ton: true });
		const { reiheBeitragEin } = await geladen();
		reiheBeitragEin(auftrag("laufend"));
		await vi.waitFor(() => expect(gespielt).toHaveLength(1));
		reiheBeitragEin(auftrag("gewoehnlich"));
		await vi.waitFor(() => expect(klaenge).toHaveLength(2));
		reiheBeitragEin(auftrag("fertig", { dringend: true }));
		await vi.waitFor(() => expect(klaenge).toHaveLength(3));
		expect(gezeigt).toEqual(["laufend"]);
		klaenge[0].ausloesen("ended");
		await vi.waitFor(() => expect(gezeigt).toHaveLength(2));
		expect(gezeigt[1]).toBe("fertig");
	});

	it("hält die Schlange am Laufen, wenn eine Aufnahme scheitert", async () => {
		umgebung({ ton: true });
		const { reiheBeitragEin } = await geladen();
		reiheBeitragEin(auftrag("eins"));
		await vi.waitFor(() => expect(gespielt).toHaveLength(1));
		reiheBeitragEin(auftrag("zwei"));
		await vi.waitFor(() => expect(klaenge).toHaveLength(2));
		klaenge[0].ausloesen("error");
		await vi.waitFor(() => expect(gespielt).toHaveLength(2));
	});

	it("spricht nicht, was beim Drankommen überholt ist", async () => {
		// Der Zeitpunkt kommt aus der Ablage, nicht vom Einreihen: Was sich
		// angestaut hat, ist alt, auch wenn es eben erst eintraf.
		umgebung({ ton: true });
		const { reiheBeitragEin } = await geladen();
		const { ANSAGE_GILT_MS } = await import("./beitrag-schlange.ts");
		reiheBeitragEin(
			auftrag("vorhin", { seit: Date.now() - ANSAGE_GILT_MS - 1_000 }),
		);
		await vi.waitFor(() => expect(gezeigt).toEqual(["vorhin"]));
		expect(gespielt).toEqual([]);
		expect(getoent).toEqual([]);
		expect(letzter?.grund).toBe("verfallen");
	});

	it("plappert einen angestauten Schwung nicht ab", async () => {
		// Der Fall aus dem Saal: Der Reiter lag eine Minute hinten, fünf
		// Beiträge kamen auf einmal. Gesprochen wird nur, was noch gilt.
		umgebung({ ton: true });
		const { reiheBeitragEin } = await geladen();
		const { ANSAGE_GILT_MS } = await import("./beitrag-schlange.ts");
		const jetzt = Date.now();
		const alter = [200_000, 150_000, 120_000, 100_000, 1_000];
		for (const [i, ab] of alter.entries())
			reiheBeitragEin(auftrag(`b${i}`, { seit: jetzt - ab }));
		await vi.waitFor(() => expect(gezeigt).toHaveLength(5));
		// Alle Einblender stehen, gesprochen wird allein der gültige.
		expect(gespielt).toHaveLength(1);
		expect(getoent).toEqual(["b4"]);
		expect(alter.filter((a) => a <= ANSAGE_GILT_MS)).toHaveLength(1);
	});

	it("lässt beim Deckel die Alten fallen, nicht die Neuen", async () => {
		umgebung({ ton: true });
		const { reiheBeitragEin } = await geladen();
		const jetzt = Date.now();
		reiheBeitragEin(auftrag("laeuft", { seit: jetzt }));
		await vi.waitFor(() => expect(gespielt).toHaveLength(1));
		for (const [i, ab] of [40_000, 30_000, 20_000, 10_000, 0].entries())
			reiheBeitragEin(auftrag(`w${i}`, { seit: jetzt - ab }));
		await vi.waitFor(() => expect(klaenge).toHaveLength(6));
		// Drei warten; die beiden ältesten sind still verabschiedet.
		await vi.waitFor(() => expect(gezeigt).toContain("w0"));
		expect(getoent).toEqual(["laeuft"]);
		klaenge[0].ausloesen("ended");
		await vi.waitFor(() => expect(getoent).toHaveLength(2));
		expect(getoent[1]).toBe("w2");
	});

	it("gongt nicht, wenn keine Stimme kommt", async () => {
		// Ein Plopp ohne Ansage ist im Saal die verwirrendste aller Meldungen.
		umgebung({ ton: true, ok: false });
		const { reiheBeitragEin } = await geladen();
		reiheBeitragEin(auftrag("eins"));
		await vi.waitFor(() => expect(gezeigt).toEqual(["eins"]));
		expect(getoent).toEqual([]);
		expect(gespielt).toEqual([]);
	});

	it("zeigt den Einblender sofort, wenn der Ton gesperrt ist", async () => {
		umgebung({ ton: false });
		const { reiheBeitragEin } = await geladen();
		reiheBeitragEin(auftrag("eins"));
		expect(gezeigt).toEqual(["eins"]);
		expect(letzter?.grund).toBe("gesperrt");
		expect(gespielt).toEqual([]);
	});

	it("zeigt den Einblender sofort, wenn der Ton abgeschaltet ist", async () => {
		umgebung({ ton: true, an: false });
		const { reiheBeitragEin } = await geladen();
		reiheBeitragEin(auftrag("eins"));
		expect(gezeigt).toEqual(["eins"]);
		expect(getoent).toEqual([]);
		expect(letzter?.grund).toBe("aus");
	});

	it("gongt, wenn das Paket gar keine Aufnahme trägt", async () => {
		// Hier ist nie eine Stimme zu erwarten – der Gong ist die ganze Meldung.
		umgebung({ ton: true });
		const { reiheBeitragEin } = await geladen();
		reiheBeitragEin({ ...auftrag("ohne"), url: undefined });
		expect(gezeigt).toEqual(["ohne"]);
		expect(getoent).toEqual(["ohne"]);
		expect(letzter?.grund).toBe("keine-aufnahme");
	});

	it("verliert den Einblender nicht, wenn die Aufnahme nicht abrufbar ist", async () => {
		umgebung({ ton: true, ok: false });
		const { reiheBeitragEin } = await geladen();
		reiheBeitragEin(auftrag("eins"));
		await vi.waitFor(() => expect(gezeigt).toEqual(["eins"]));
		expect(gespielt).toEqual([]);
	});

	it("hält auf Knopfdruck sofort die Fresse", async () => {
		// Wer im Saal die Glocke drückt, will reden. Dann hat die Stimme zu
		// schweigen – mitten im Satz, nicht erst nach ihm.
		umgebung({ ton: true });
		const { reiheBeitragEin, verstumme } = await geladen();
		reiheBeitragEin(auftrag("eins"));
		await vi.waitFor(() => expect(gespielt).toHaveLength(1));
		reiheBeitragEin(auftrag("zwei"));
		await vi.waitFor(() => expect(klaenge).toHaveLength(2));

		let angehalten = false;
		klaenge[0].pause = () => {
			angehalten = true;
		};
		verstumme();

		expect(angehalten).toBe(true);
		expect(freigegeben).toContain(klaenge[1].src);
		// Der Einblender des Wartenden bleibt stehen, seine Stimme entfällt.
		expect(gezeigt).toEqual(["eins", "zwei"]);
		expect(getoent).toEqual(["eins"]);
		klaenge[0].ausloesen("ended");
		await new Promise((f) => setTimeout(f, 20));
		expect(gespielt).toHaveLength(1);
	});

	it("holt nach dem Verstummen nichts nach", async () => {
		umgebung({ ton: true });
		const { reiheBeitragEin, verstumme } = await geladen();
		reiheBeitragEin(auftrag("eins"));
		await vi.waitFor(() => expect(gespielt).toHaveLength(1));
		reiheBeitragEin(auftrag("zwei"));
		await vi.waitFor(() => expect(klaenge).toHaveLength(2));

		verstumme();

		await new Promise((f) => setTimeout(f, 30));
		expect(gespielt).toHaveLength(1);

		// Ab jetzt wird wieder gesprochen.
		reiheBeitragEin(auftrag("drei"));
		await vi.waitFor(() => expect(gespielt).toHaveLength(2));
	});

	it("holt beim Zurückkommen nichts nach", async () => {
		// Was im Hintergrund gesprochen werden sollte, war für den Augenblick
		// gedacht. Die laufende Ansage spricht zu Ende, die Wartenden nicht.
		umgebung({ ton: true });
		const { reiheBeitragEin, nichtsNachholen } = await geladen();
		reiheBeitragEin(auftrag("laeuft"));
		await vi.waitFor(() => expect(gespielt).toHaveLength(1));
		reiheBeitragEin(auftrag("wartet"));
		await vi.waitFor(() => expect(klaenge).toHaveLength(2));

		nichtsNachholen();

		expect(gezeigt).toEqual(["laeuft", "wartet"]);
		expect(getoent).toEqual(["laeuft"]);
		klaenge[0].ausloesen("ended");
		await new Promise((f) => setTimeout(f, 30));
		expect(gespielt).toHaveLength(1);

		// Was danach eintrifft, wird gesprochen.
		reiheBeitragEin(auftrag("danach"));
		await vi.waitFor(() => expect(gespielt).toHaveLength(2));
	});
});
