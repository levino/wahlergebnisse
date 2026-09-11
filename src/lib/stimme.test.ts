/** Der Ansage-Schalter und das Abspielen hinterlegter Aufnahmen. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const speicher = new Map<string, string>();

const echterSpeicher = {
	getItem: (k: string) => speicher.get(k) ?? null,
	setItem: (k: string, v: string) => {
		speicher.set(k, v);
	},
	removeItem: (k: string) => {
		speicher.delete(k);
	},
};

vi.stubGlobal("localStorage", echterSpeicher);

const modul = async () => {
	vi.resetModules();
	return await import("./stimme.ts");
};

beforeEach(() => {
	speicher.clear();
});

describe("der Ansage-Schalter", () => {
	it("steht am Wahlabend von selbst auf an", async () => {
		const { ansageAn } = await modul();
		expect(ansageAn()).toBe(true);
	});

	it("merkt sich das Abschalten", async () => {
		const { ansageAn, setzeAnsage } = await modul();
		setzeAnsage(false);
		expect(ansageAn()).toBe(false);
		setzeAnsage(true);
		expect(ansageAn()).toBe(true);
	});

	it("bleibt an, wenn der Speicher zumacht", async () => {
		const { ansageAn } = await modul();
		vi.stubGlobal("localStorage", {
			getItem: () => {
				throw new Error("kein Speicher");
			},
			setItem: () => {
				throw new Error("kein Speicher");
			},
			removeItem: () => {},
		});
		expect(ansageAn()).toBe(true);
		vi.stubGlobal("localStorage", echterSpeicher);
	});

	it("hält den Schalter getrennt vom Ton", async () => {
		const { STIMME_SCHLUESSEL } = await modul();
		const { TON_SCHLUESSEL } = await import("./klang.ts");
		expect(STIMME_SCHLUESSEL).not.toBe(TON_SCHLUESSEL);
	});
});

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

	const umgebung = (opts: { ton: boolean; ok?: boolean }) => {
		gespielt.length = 0;
		gezeigt.length = 0;
		getoent.length = 0;
		klaenge = [];
		let n = 0;
		vi.stubGlobal("fetch", async () => ({
			ok: opts.ok ?? true,
			status: opts.ok === false ? 404 : 200,
			blob: async () => ({ size: 42, nummer: n++ }),
		}));
		Object.assign(URL, {
			createObjectURL: (b: { nummer?: number }) => `blob:${b.nummer ?? 0}`,
			revokeObjectURL: () => {},
		});
		vi.stubGlobal("Audio", FakeAudio);
		vi.stubGlobal("window", {});
		vi.doMock("./klang.ts", () => ({ tonFrei: () => opts.ton }));
	};

	const auftrag = (name: string, dringend = false) => ({
		url: `/api/beitrag/${name}.mp3`,
		dringend,
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
		reiheBeitragEin(auftrag("fertig", true));
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

	it("zeigt den Einblender sofort, wenn der Ton gesperrt ist", async () => {
		umgebung({ ton: false });
		const { reiheBeitragEin } = await geladen();
		reiheBeitragEin(auftrag("eins"));
		expect(gezeigt).toEqual(["eins"]);
		expect(letzter?.grund).toBe("gesperrt");
		expect(gespielt).toEqual([]);
	});

	it("zeigt den Einblender sofort, wenn die Ansage abgeschaltet ist", async () => {
		umgebung({ ton: true });
		const { reiheBeitragEin, setzeAnsage } = await geladen();
		setzeAnsage(false);
		reiheBeitragEin(auftrag("eins"));
		expect(gezeigt).toEqual(["eins"]);
		expect(letzter?.grund).toBe("aus");
	});

	it("zeigt den Einblender sofort, wenn das Paket keine Aufnahme trägt", async () => {
		umgebung({ ton: true });
		const { reiheBeitragEin } = await geladen();
		reiheBeitragEin({ ...auftrag("ohne"), url: undefined });
		expect(gezeigt).toEqual(["ohne"]);
		expect(letzter?.grund).toBe("keine-aufnahme");
	});

	it("verliert den Einblender nicht, wenn die Aufnahme nicht abrufbar ist", async () => {
		umgebung({ ton: true, ok: false });
		const { reiheBeitragEin } = await geladen();
		reiheBeitragEin(auftrag("eins"));
		await vi.waitFor(() => expect(gezeigt).toEqual(["eins"]));
		expect(gespielt).toEqual([]);
	});
});
