/** Zwei Ansagen sprechen nie übereinander – am echten Abspielweg geprüft. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const speicher = new Map<string, string>();
vi.stubGlobal("localStorage", {
	getItem: (k: string) => speicher.get(k) ?? null,
	setItem: (k: string, v: string) => {
		speicher.set(k, v);
	},
	removeItem: (k: string) => {
		speicher.delete(k);
	},
});

const gespielt: string[] = [];
const freigegeben: string[] = [];
let tonIstAn = true;
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

const geladen = async () => {
	vi.resetModules();
	speicher.clear();
	gespielt.length = 0;
	freigegeben.length = 0;
	klaenge = [];
	tonIstAn = true;
	let n = 0;
	vi.stubGlobal("fetch", async (url: string) =>
		String(url).includes("/stand")
			? {
					ok: true,
					json: async () => ({ verfuegbar: true, modell: "gpt-4o-mini-tts" }),
				}
			: {
					ok: true,
					status: 200,
					blob: async () => ({ size: 42, nummer: n++ }),
				},
	);
	Object.assign(URL, {
		createObjectURL: (b: { nummer?: number }) => `blob:${b.nummer ?? 0}`,
		revokeObjectURL: (a: string) => freigegeben.push(a),
	});
	vi.stubGlobal("Audio", FakeAudio);
	vi.stubGlobal("window", {});
	vi.doMock("./klang.ts", () => ({
		tonFrei: () => true,
		tonAn: () => tonIstAn,
	}));
	const m = await import("./stimme.ts");
	m.setzeBehoerde("03254026");
	await m.holeDienstStand();
	return m;
};

beforeEach(() => {
	vi.doUnmock("./klang.ts");
});

describe("der Abspielweg", () => {
	it("spielt die zweite Ansage erst, wenn die erste zu Ende ist", async () => {
		const { sprich } = await geladen();
		sprich("Rössing ist fertig ausgezählt.");
		await vi.waitFor(() => expect(gespielt).toHaveLength(1));

		sprich("Adensen ist fertig ausgezählt.");
		await vi.waitFor(() => expect(klaenge).toHaveLength(2));
		expect(gespielt).toHaveLength(1);

		klaenge[0].ausloesen("ended");
		await vi.waitFor(() => expect(gespielt).toHaveLength(2));
	});

	it("schneidet für eine dringende Ansage nicht mitten ins Wort", async () => {
		const { sprich } = await geladen();
		sprich("Ein laufender Satz.");
		await vi.waitFor(() => expect(gespielt).toHaveLength(1));
		sprich("Gewöhnlich.");
		await vi.waitFor(() => expect(klaenge).toHaveLength(2));
		sprich("Fertig ausgezählt!", true);
		await vi.waitFor(() => expect(klaenge).toHaveLength(3));

		// Die laufende spricht zu Ende; das Dringende überholt nur die Wartenden.
		expect(gespielt).toEqual(["blob:0"]);
		klaenge[0].ausloesen("ended");
		await vi.waitFor(() => expect(gespielt).toHaveLength(2));
		expect(gespielt[1]).toBe("blob:2");
	});

	it("bleibt nicht stehen, wenn eine Ansage mit einem Fehler endet", async () => {
		const { sprich } = await geladen();
		sprich("Erste.");
		await vi.waitFor(() => expect(gespielt).toHaveLength(1));
		sprich("Zweite.");
		await vi.waitFor(() => expect(klaenge).toHaveLength(2));
		klaenge[0].ausloesen("error");
		await vi.waitFor(() => expect(gespielt).toHaveLength(2));
	});

	it("hält auf Knopfdruck sofort die Fresse", async () => {
		// Wer im Saal die Glocke drückt, will reden. Dann hat die Stimme zu
		// schweigen – mitten im Satz, nicht erst nach ihm.
		const { sprich, verstumme } = await geladen();
		sprich("Ein langer Satz, der gerade läuft.");
		await vi.waitFor(() => expect(gespielt).toHaveLength(1));
		sprich("Und einer, der noch wartet.");
		await vi.waitFor(() => expect(klaenge).toHaveLength(2));

		let angehalten = false;
		klaenge[0].pause = () => {
			angehalten = true;
		};
		tonIstAn = false;
		verstumme();

		expect(angehalten).toBe(true);
		// Auch das Wartende ist weg – und seine Adresse freigegeben.
		expect(freigegeben).toContain("blob:0");
		expect(freigegeben).toContain("blob:1");
		klaenge[0].ausloesen("ended");
		await new Promise((f) => setTimeout(f, 20));
		expect(gespielt).toHaveLength(1);
	});

	it("holt nach dem Wiedereinschalten nichts nach", async () => {
		const { sprich, verstumme } = await geladen();
		sprich("Erste.");
		await vi.waitFor(() => expect(gespielt).toHaveLength(1));
		sprich("Zweite.");
		await vi.waitFor(() => expect(klaenge).toHaveLength(2));

		tonIstAn = false;
		verstumme();
		tonIstAn = true;

		// Nichts läuft von selbst wieder an; was in der Stille kam, ist vorbei.
		await new Promise((f) => setTimeout(f, 30));
		expect(gespielt).toHaveLength(1);

		// Aber ab jetzt wird wieder gesprochen.
		sprich("Dritte.");
		await vi.waitFor(() => expect(gespielt).toHaveLength(2));
	});
});
