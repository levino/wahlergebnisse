/**
 * Die Untergebiete einer Wahl – eine Ebene zur Zeit, umschaltbar ohne
 * Neuladen. Alles gleichzeitig zu zeigen (Gemeinden, Wahlbereiche, Ortsteile
 * und Wahlbezirke untereinander) war unübersichtlich.
 */
import { useMemo, useState } from "preact/hooks";
import type { UntergebietTabelle } from "../lib/seite.ts";

type Props = { tabellen: UntergebietTabelle[]; ebene?: string };

const zahl = new Intl.NumberFormat("de-DE");
const prozent = new Intl.NumberFormat("de-DE", {
	minimumFractionDigits: 1,
	maximumFractionDigits: 1,
});
const fmtZahl = (n?: number) => (n === undefined ? "–" : zahl.format(n));
const fmtProzent = (n?: number) =>
	n === undefined ? "–" : `${prozent.format(n)} %`;

export default function Untergebiete({ tabellen, ebene }: Props) {
	const [aktiv, setAktiv] = useState(
		() =>
			tabellen.find((t) => t.ebene === ebene)?.ebene ??
			tabellen[0]?.ebene ??
			"",
	);
	const [sortSpalte, setSortSpalte] = useState<string | null>(null);
	const tabelle = tabellen.find((t) => t.ebene === aktiv) ?? tabellen[0];

	const zeilen = useMemo(() => {
		if (!tabelle) return [];
		if (!sortSpalte) return tabelle.zeilen;
		return [...tabelle.zeilen].sort((a, b) => {
			if (sortSpalte === "beteiligung")
				return (b.wahlbeteiligung ?? 0) - (a.wahlbeteiligung ?? 0);
			const wert = (z: typeof a) =>
				z.werte.find((w) => w.kurz === sortSpalte)?.prozent ?? 0;
			return wert(b) - wert(a);
		});
	}, [tabelle, sortSpalte]);

	if (!tabelle) return null;

	const sortierbar = (spalte: string) => ({
		onClick: () => setSortSpalte(sortSpalte === spalte ? null : spalte),
		class: `text-right whitespace-nowrap cursor-pointer select-none ${sortSpalte === spalte ? "underline" : ""}`,
		title: "Nach dieser Spalte sortieren",
	});

	return (
		<section class="bg-base-100 p-4">
			<div class="flex flex-wrap items-center justify-between gap-3 mb-3">
				<h2 class="font-bold text-lg">Ergebnisse nach Gebiet</h2>
				{tabellen.length > 1 && (
					<div class="join">
						{tabellen.map((t) => (
							<button
								key={t.ebene}
								type="button"
								class={`join-item btn btn-xs ${t.ebene === aktiv ? "btn-neutral" : "btn-outline"}`}
								onClick={() => setAktiv(t.ebene)}
								aria-pressed={t.ebene === aktiv}
							>
								{t.titel}
							</button>
						))}
					</div>
				)}
			</div>
			<div class="overflow-x-auto">
				<table class="table table-sm table-zebra w-full text-sm">
					<thead>
						<tr>
							<th class="text-left">{tabelle.titel}</th>
							<th class="text-right whitespace-nowrap">Stand</th>
							<th class="text-right">Wahlber.</th>
							<th {...sortierbar("beteiligung")}>Beteiligung</th>
							{tabelle.spalten.map((s) => (
								<th
									key={s.kurz}
									{...sortierbar(s.kurz)}
									title={s.lang ?? s.kurz}
								>
									<span
										class="inline-block w-2 h-2 rounded-full mr-1.5"
										style={{ background: s.farbe }}
									/>
									{s.kurz}
								</th>
							))}
						</tr>
					</thead>
					<tbody>
						{zeilen.map((z) => (
							<tr key={z.label}>
								<td class="whitespace-nowrap">
									<span
										class="inline-block w-2.5 h-2.5 mr-2 align-middle"
										style={{ background: z.siegerFarbe ?? "#cbd5e1" }}
										aria-hidden="true"
									/>
									{z.href ? (
										<a href={z.href} class="link link-hover font-medium">
											{z.label}
										</a>
									) : (
										<span class="font-medium">{z.label}</span>
									)}
								</td>
								<td class="text-right whitespace-nowrap tabular-nums opacity-80">
									{z.status || "–"}
								</td>
								<td class="text-right tabular-nums">
									{fmtZahl(z.wahlberechtigte)}
								</td>
								<td class="text-right tabular-nums">
									{fmtProzent(z.wahlbeteiligung)}
								</td>
								{z.werte.map((w) => (
									<td
										key={w.kurz}
										class="text-right tabular-nums"
										title={
											w.absolut === undefined
												? undefined
												: `${zahl.format(w.absolut)} Stimmen`
										}
									>
										{fmtProzent(w.prozent)}
									</td>
								))}
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{sortSpalte && (
				<p class="text-xs opacity-60 mt-2">
					Sortiert nach{" "}
					{sortSpalte === "beteiligung" ? "Wahlbeteiligung" : sortSpalte}.
					Nochmal klicken stellt die ursprüngliche Reihenfolge wieder her.
				</p>
			)}
		</section>
	);
}
