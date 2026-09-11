import { useMemo, useState } from "preact/hooks";

type Partei = { key: string; kurz: string; farbe: string; sitze: number };
type Props = {
	parteien: Partei[];
	gesamt: number;
	quelle: "amtlich" | "hochrechnung";
};

const kombinationen = (parteien: Partei[], mehrheit: number): Partei[][] => {
	const relevant = parteien.filter((p) => p.sitze > 0);
	const out: Partei[][] = [];
	const n = relevant.length;
	for (let mask = 1; mask < 1 << n; mask++) {
		const teil = relevant.filter((_, i) => mask & (1 << i));
		const summe = teil.reduce((a, p) => a + p.sitze, 0);
		if (summe < mehrheit) continue;
		const minimal = teil.every((p) => summe - p.sitze < mehrheit);
		if (minimal) out.push(teil);
	}
	return out
		.sort(
			(a, b) =>
				a.length - b.length ||
				b.reduce((x, p) => x + p.sitze, 0) - a.reduce((x, p) => x + p.sitze, 0),
		)
		.slice(0, 8);
};

export default function Koalitionsrechner({ parteien, gesamt, quelle }: Props) {
	const mehrheit = Math.floor(gesamt / 2) + 1;
	const [gewaehlt, setGewaehlt] = useState<Set<string>>(() => new Set());
	const summe = parteien
		.filter((p) => gewaehlt.has(p.key))
		.reduce((a, p) => a + p.sitze, 0);
	const vorschlaege = useMemo(
		() => kombinationen(parteien, mehrheit),
		[parteien, mehrheit],
	);

	const toggle = (key: string) =>
		setGewaehlt((alt) => {
			const neu = new Set(alt);
			if (neu.has(key)) neu.delete(key);
			else neu.add(key);
			return neu;
		});

	return (
		<div class="space-y-3">
			<div class="flex flex-wrap gap-2">
				{parteien.map((p) => (
					<button
						type="button"
						onClick={() => toggle(p.key)}
						aria-pressed={gewaehlt.has(p.key)}
						class={`btn btn-sm gap-2 ${gewaehlt.has(p.key) ? "btn-neutral" : "btn-outline"}`}
					>
						<span
							class="inline-block w-3 h-3 rounded-full"
							style={{ background: p.farbe }}
						/>
						{p.kurz} <span class="tabular-nums opacity-80">{p.sitze}</span>
					</button>
				))}
			</div>
			<div class="h-5 bg-base-300 relative overflow-hidden">
				<div class="flex h-full">
					{parteien
						.filter((p) => gewaehlt.has(p.key))
						.map((p) => (
							<div
								style={{
									width: `${(p.sitze / gesamt) * 100}%`,
									background: p.farbe,
								}}
								title={`${p.kurz}: ${p.sitze}`}
							/>
						))}
				</div>
				<div
					class="absolute top-0 bottom-0 border-l-2 border-unionsschwarz"
					style={{ left: `${(mehrheit / gesamt) * 100}%` }}
					title={`Mehrheit ab ${mehrheit}`}
				/>
			</div>
			<p class="text-sm">
				<span
					class={`font-bold tabular-nums ${summe >= mehrheit ? "text-green-700" : gewaehlt.size ? "text-red-700" : ""}`}
				>
					{summe}
				</span>{" "}
				von {gesamt} Sitzen
				{gewaehlt.size > 0 &&
					(summe >= mehrheit
						? " – Mehrheit"
						: ` – ${mehrheit - summe} fehlen zur Mehrheit`)}
				{gewaehlt.size === 0 &&
					" – Parteien antippen, um eine Koalition zu prüfen"}
			</p>
			{vorschlaege.length > 0 && (
				<details class="text-sm">
					<summary class="cursor-pointer opacity-80">
						Mögliche Mehrheiten (minimale Bündnisse)
					</summary>
					<ul class="mt-1 space-y-1">
						{vorschlaege.map((k) => (
							<li>
								<button
									type="button"
									class="link link-hover"
									onClick={() => setGewaehlt(new Set(k.map((p) => p.key)))}
								>
									{k.map((p) => p.kurz).join(" + ")}{" "}
									<span class="tabular-nums opacity-70">
										({k.reduce((a, p) => a + p.sitze, 0)})
									</span>
								</button>
							</li>
						))}
					</ul>
				</details>
			)}
			{quelle === "hochrechnung" && (
				<p class="text-xs opacity-60">
					Basis: Hochrechnung – ändert sich mit jeder Schnellmeldung.
				</p>
			)}
		</div>
	);
}
