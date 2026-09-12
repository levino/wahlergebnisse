export type Lage = {
	main: string;
	zweig: string;
	cluster?: readonly string[];
	laeuft: boolean;
	angehalten?: string;
};

export type Befund = { stufe: "halt" | "fehler" | "warnung"; was: string };

export const kurz = (stand: string): string =>
	/^[0-9a-f]{40}$/.test(stand) ? stand.slice(0, 7) : stand;

export const tagAus = (kustomization: string): string =>
	kustomization.match(/^\s*newTag:\s*(\S+)/m)?.[1] ?? "";

export const beurteile = (lage: Lage): Befund[] => {
	const befunde: Befund[] = [];
	if (lage.angehalten)
		befunde.push({
			stufe: "halt",
			was: `Ausrollen ist nach einem Zurückrollen angehalten – eingetragen ist ${kurz(lage.zweig)}, main steht auf ${kurz(lage.main)}`,
		});
	else if (lage.zweig !== lage.main)
		befunde.push(
			lage.laeuft
				? {
						stufe: "warnung",
						was: `main steht auf ${kurz(lage.main)}, eingetragen ist ${kurz(lage.zweig)} – eine Ausrollung läuft gerade`,
					}
				: {
						stufe: "fehler",
						was: `main steht auf ${kurz(lage.main)}, eingetragen ist ${kurz(lage.zweig)} – und es läuft keine Ausrollung`,
					},
		);
	const fremd = [
		...new Set((lage.cluster ?? []).filter((t) => t !== lage.zweig)),
	];
	if (fremd.length > 0)
		befunde.push({
			stufe: "warnung",
			was: `im Cluster läuft ${fremd.map(kurz).join(", ")}, eingetragen ist ${kurz(lage.zweig)} – Argo zieht nach`,
		});
	return befunde;
};

export const schlimmstes = (befunde: readonly Befund[]): 0 | 1 | 3 => {
	if (befunde.some((b) => b.stufe === "halt")) return 3;
	return befunde.some((b) => b.stufe === "fehler") ? 1 : 0;
};
