/**
 * Bewerberinnen und Bewerber je Liste, sortierbar nach Ergebnis oder
 * Listenplatz.
 *
 * Warum kein Prozentwert aus der amtlichen Präsentation: Der dort ausgewiesene
 * Anteil bezieht sich auf die Kandidatenstimmen der eigenen Partei – „43 %“
 * liest sich wie ein Wahlergebnis, meint aber etwas anderes. Gezeigt wird
 * deshalb der Anteil an allen gültigen Stimmen des Gebiets.
 */
import { useState } from "preact/hooks";
import type { BewerberListe } from "../lib/kandidaten.ts";

type Props = { listen: BewerberListe[]; hatPlaetze: boolean };

const zahl = new Intl.NumberFormat("de-DE");
const prozent = new Intl.NumberFormat("de-DE", {
	minimumFractionDigits: 1,
	maximumFractionDigits: 1,
});

export default function Bewerber({ listen, hatPlaetze }: Props) {
	const [nach, setNach] = useState<"stimmen" | "platz">("stimmen");
	const sortiert = (l: BewerberListe) =>
		[...l.bewerber].sort((a, b) =>
			nach === "stimmen"
				? b.stimmen - a.stimmen
				: (a.platz ?? 999) - (b.platz ?? 999) || b.stimmen - a.stimmen,
		);

	return (
		<div>
			{hatPlaetze && (
				<div class="flex items-center gap-2 mb-4 text-sm">
					<span class="opacity-70">Sortieren nach</span>
					<div class="join">
						<button
							type="button"
							class={`join-item btn btn-xs ${nach === "stimmen" ? "btn-neutral" : "btn-outline"}`}
							onClick={() => setNach("stimmen")}
							aria-pressed={nach === "stimmen"}
						>
							Ergebnis
						</button>
						<button
							type="button"
							class={`join-item btn btn-xs ${nach === "platz" ? "btn-neutral" : "btn-outline"}`}
							onClick={() => setNach("platz")}
							aria-pressed={nach === "platz"}
						>
							Listenplatz
						</button>
					</div>
				</div>
			)}

			<div class="grid gap-x-8 gap-y-6 lg:grid-cols-2 xl:grid-cols-3">
				{listen.map((l) => (
					<section key={l.parteiKey}>
						<h3 class="font-semibold flex items-baseline gap-2 mb-1">
							<span
								class="inline-block w-3 h-3 shrink-0 translate-y-0.5"
								style={{ background: l.farbe }}
							/>
							<span class="truncate" title={l.lang}>
								{l.kurz}
							</span>
						</h3>
						<p class="text-xs opacity-60 mb-2">
							{l.listenstimmen !== null && (
								<>Listenstimmen {zahl.format(l.listenstimmen)}</>
							)}
							{l.listenstimmen !== null && l.kandidatenstimmen !== null && (
								<span class="px-1.5">·</span>
							)}
							{l.kandidatenstimmen !== null && (
								<>Personenstimmen {zahl.format(l.kandidatenstimmen)}</>
							)}
						</p>
						<table class="w-full text-sm">
							<thead class="text-xs uppercase tracking-wide opacity-60">
								<tr>
									{hatPlaetze && (
										<th class="text-right font-normal pr-3 w-8">Pl.</th>
									)}
									<th class="text-left font-normal">Name</th>
									<th class="text-right font-normal pl-4">Stimmen</th>
									<th class="text-right font-normal pl-4 w-16">Anteil</th>
								</tr>
							</thead>
							<tbody>
								{sortiert(l).map((b) => (
									<tr
										key={b.name}
										class={b.gewaehlt ? "font-semibold" : undefined}
									>
										{hatPlaetze && (
											<td class="text-right tabular-nums pr-3 opacity-60">
												{b.platz ?? "–"}
											</td>
										)}
										<td class="py-0.5">
											{b.gewaehlt && (
												<span
													class="text-green-700 pr-1.5"
													role="img"
													aria-label="gewählt"
												>
													✓
												</span>
											)}
											{b.name}
										</td>
										<td class="text-right tabular-nums pl-4">
											{zahl.format(b.stimmen)}
										</td>
										<td class="text-right tabular-nums pl-4 opacity-60">
											{b.prozent === null
												? "–"
												: `${prozent.format(b.prozent)} %`}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</section>
				))}
			</div>
			<p class="text-xs opacity-60 mt-4">
				Anteil = Stimmen dieser Person an allen gültigen Stimmen des Gebiets.
				Bei Rats- und Kreistagswahlen hat jede Wählerin drei Stimmen, die auf
				Personen und Listen verteilt werden; gewählt wird nach Stimmenzahl,
				nicht nach Listenplatz.
				{hatPlaetze &&
					" Der Listenplatz stammt aus den Open-Data-Dateien der Wahlleitung."}
			</p>
		</div>
	);
}
