export type Rolle = "poller" | "web" | "beides";

const ERLAUBT: Rolle[] = ["poller", "web", "beides"];

export const rolle = (): Rolle => {
	const wert = (process.env.WAHLEN_ROLLE ?? "").trim().toLowerCase();
	if (!wert) return "beides";
	if ((ERLAUBT as string[]).includes(wert)) return wert as Rolle;
	console.warn(
		`WAHLEN_ROLLE="${wert}" ist unbekannt (erlaubt: ${ERLAUBT.join(", ")}) – es gilt "beides"`,
	);
	return "beides";
};

/** Fragt dieser Prozess bei den Wahlleitungen nach und schreibt? */
export const schreibtDieserProzess = (): boolean => rolle() !== "web";
