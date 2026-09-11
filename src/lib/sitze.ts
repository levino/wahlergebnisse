export type Stimmen = { key: string; stimmen: number };
export type Sitze = { key: string; sitze: number };

export const hareNiemeyer = (
	stimmen: Stimmen[],
	gesamtSitze: number,
): Sitze[] => {
	const total = stimmen.reduce((a, s) => a + Math.max(0, s.stimmen), 0);
	if (total <= 0 || gesamtSitze <= 0)
		return stimmen.map((s) => ({ key: s.key, sitze: 0 }));
	const quoten = stimmen.map((s) => {
		const q = (Math.max(0, s.stimmen) * gesamtSitze) / total;
		return { key: s.key, ganz: Math.floor(q), rest: q - Math.floor(q) };
	});
	let vergeben = quoten.reduce((a, q) => a + q.ganz, 0);
	const sitze = new Map(quoten.map((q) => [q.key, q.ganz]));
	const nachRest = [...quoten].sort((a, b) => b.rest - a.rest);
	for (const q of nachRest) {
		if (vergeben >= gesamtSitze) break;
		sitze.set(q.key, (sitze.get(q.key) ?? 0) + 1);
		vergeben++;
	}
	return stimmen.map((s) => ({ key: s.key, sitze: sitze.get(s.key) ?? 0 }));
};

/** Mehrheit: mehr als die Hälfte der Sitze. */
export const mehrheit = (gesamtSitze: number): number =>
	Math.floor(gesamtSitze / 2) + 1;

export const SITZE_2021: Record<string, number> = {
	"03254000/kreistag": 64,
	"03254026/rat": 30,
};
