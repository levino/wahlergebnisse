/** Wartet, bis der E2E-Server die Fixture-Daten eines Termins geladen hat. */
export const warteAufDaten = async (
	termin: string,
	sekunden = 180,
): Promise<void> => {
	for (let i = 0; i < sekunden; i++) {
		try {
			const r = await fetch(`http://127.0.0.1:8099/api/v1/${termin}`);
			if (r.ok && (await r.json()).termin?.stand) return;
		} catch {
			/* Server startet noch */
		}
		await new Promise((res) => setTimeout(res, 1000));
	}
	throw new Error(`Daten für ${termin} wurden nicht geladen`);
};
