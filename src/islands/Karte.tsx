import { navigate } from "astro:transitions/client";
import { useEffect, useRef, useState } from "preact/hooks";
import type { KartenDaten } from "../lib/karte.ts";
import "leaflet/dist/leaflet.css";

type Props = { daten: KartenDaten; hoehe?: string };

/** Kartendaten der gerade angezeigten Seite (nach einem Seitenwechsel). */
const datenAusDom = (): KartenDaten | undefined => {
	const el = document.getElementById("kartendaten");
	if (!el?.textContent) return undefined;
	try {
		return JSON.parse(el.textContent) as KartenDaten;
	} catch {
		return undefined;
	}
};

export default function Karte({ daten: anfangsDaten, hoehe = "480px" }: Props) {
	const ref = useRef<HTMLDivElement>(null);
	const mapRef = useRef<import("leaflet").Map | null>(null);
	const layerRef = useRef<import("leaflet").LayerGroup | null>(null);
	const umrissRef = useRef<import("leaflet").LayerGroup | null>(null);
	const tilesRef = useRef<import("leaflet").TileLayer | null>(null);
	const LRef = useRef<typeof import("leaflet") | null>(null);
	const datenRef = useRef<KartenDaten>(anfangsDaten);

	const [daten, setDaten] = useState<KartenDaten>(anfangsDaten);
	const [ebene, setEbene] = useState(anfangsDaten.ebenen[0]?.id ?? "");
	const [hintergrund, setHintergrund] = useState(true);

	/** Zeichnet Umriss, Flächen und Punkte der aktuellen Daten neu. */
	const zeichne = (ebeneId: string, d: KartenDaten) => {
		const L = LRef.current;
		const group = layerRef.current;
		const umriss = umrissRef.current;
		if (!L || !group || !umriss) return;

		umriss.clearLayers();
		for (const g of d.umriss) {
			L.geoJSON({ type: "Feature", properties: {}, geometry: g } as never, {
				style: { color: "#2D3C4B", weight: 2, fill: false, dashArray: "4 3" },
				interactive: false,
			}).addTo(umriss);
		}

		group.clearLayers();
		const e = d.ebenen.find((x) => x.id === ebeneId) ?? d.ebenen[0];
		for (const f of e?.flaechen ?? []) {
			if (!f.geometry) continue;
			const stil = {
				color: f.aktiv ? "#FFA600" : "#ffffff",
				weight: f.aktiv ? 4 : 1.2,
				fillColor: f.farbe,
				fillOpacity: f.ohneDaten ? 0.25 : 0.62,
			};
			const layer = L.geoJSON(
				{ type: "Feature", properties: {}, geometry: f.geometry } as never,
				{ style: stil },
			);
			layer.bindTooltip(f.tooltip, {
				sticky: true,
				className: "karte-tooltip",
			});
			layer.on("mouseover", () =>
				layer.setStyle({ weight: 3, fillOpacity: 0.8 }),
			);
			layer.on("mouseout", () => layer.setStyle(stil));
			if (f.href) layer.on("click", () => gehZu(f.href as string));
			group.addLayer(layer);
		}
		for (const p of d.punkte) {
			const m = L.circleMarker([p.lat, p.lon], {
				radius: p.aktiv ? 10 : 7,
				color: p.aktiv ? "#FFA600" : "#ffffff",
				weight: p.aktiv ? 3 : 1.5,
				fillColor: p.farbe,
				fillOpacity: p.ohneDaten ? 0.4 : 0.95,
			});
			m.bindTooltip(p.tooltip, {
				className: "karte-tooltip",
				direction: "top",
				offset: [0, -8],
			});
			if (p.href) m.on("click", () => gehZu(p.href as string));
			group.addLayer(m);
		}
	};

	const gehZu = (href: string) => {
		void navigate(href);
	};

	const zeigeAusschnitt = (d: KartenDaten, ersterAufbau: boolean) => {
		const map = mapRef.current;
		const L = LRef.current;
		const b = d.fokus ?? d.bbox;
		if (!map || !L || !b) return;
		const bounds = L.latLngBounds([b[0][1], b[0][0]], [b[1][1], b[1][0]]);
		if (ersterAufbau) {
			map.fitBounds(bounds, {
				padding: [16, 16],
				maxZoom: d.fokus ? 14 : 12,
			});
			return;
		}
		if (map.getBounds().contains(bounds)) return;
		const ruhig = globalThis.matchMedia?.(
			"(prefers-reduced-motion: reduce)",
		).matches;
		map.panTo(bounds.getCenter(), { animate: !ruhig, duration: 0.4 });
	};

	useEffect(() => {
		let abgebrochen = false;
		(async () => {
			const L = await import("leaflet");
			if (abgebrochen || !ref.current || mapRef.current) return;
			LRef.current = L;
			const map = L.map(ref.current, {
				zoomSnap: 0.25,
				scrollWheelZoom: false,
			});
			map.attributionControl.setPrefix("");
			mapRef.current = map;
			tilesRef.current = L.tileLayer(
				"https://tile.openstreetmap.org/{z}/{x}/{y}.png",
				{
					maxZoom: 18,
					opacity: 0.55,
					attribution:
						'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
				},
			).addTo(map);
			umrissRef.current = L.layerGroup().addTo(map);
			layerRef.current = L.layerGroup().addTo(map);
			zeichne(ebene, datenRef.current);
			zeigeAusschnitt(datenRef.current, true);
		})();
		return () => {
			abgebrochen = true;
		};
	}, []);

	useEffect(() => {
		const beiSeitenwechsel = () => {
			const neu = datenAusDom();
			if (!neu) return;
			datenRef.current = neu;
			setDaten(neu);
			const ebeneVorhanden = neu.ebenen.some((e) => e.id === ebene);
			const ziel = ebeneVorhanden ? ebene : (neu.ebenen[0]?.id ?? "");
			if (ziel !== ebene) setEbene(ziel);
			zeichne(ziel, neu);
			zeigeAusschnitt(neu, false);
			mapRef.current?.invalidateSize();
		};
		document.addEventListener("astro:page-load", beiSeitenwechsel);
		return () =>
			document.removeEventListener("astro:page-load", beiSeitenwechsel);
	}, [ebene]);

	useEffect(() => {
		if (mapRef.current) zeichne(ebene, datenRef.current);
	}, [ebene]);

	useEffect(() => {
		const map = mapRef.current;
		const t = tilesRef.current;
		if (!map || !t) return;
		if (hintergrund) t.addTo(map);
		else t.remove();
	}, [hintergrund]);

	return (
		<div class="relative">
			<div
				ref={ref}
				style={{ height: hoehe }}
				class="w-full"
				role="application"
				aria-label="Karte der Wahlergebnisse"
			/>
			<div class="absolute top-2 right-2 z-[1000] flex flex-col gap-1 items-end">
				{daten.ebenen.length > 1 && (
					<div class="join shadow">
						{daten.ebenen.map((e) => (
							<button
								key={e.id}
								type="button"
								class={`join-item btn btn-xs ${e.id === ebene ? "btn-neutral" : "bg-base-100"}`}
								onClick={() => setEbene(e.id)}
							>
								{e.titel}
							</button>
						))}
					</div>
				)}
				<label class="btn btn-xs bg-base-100 shadow gap-1 cursor-pointer">
					<input
						type="checkbox"
						class="checkbox checkbox-xs"
						checked={hintergrund}
						onChange={(ev) =>
							setHintergrund((ev.target as HTMLInputElement).checked)
						}
					/>
					Karte
				</label>
			</div>
			{daten.legende.length > 0 && (
				<div class="absolute bottom-2 left-2 z-[1000] bg-base-100/90 px-2 py-1 text-xs flex flex-wrap gap-x-3 gap-y-0.5 max-w-[80%]">
					{daten.legende.map((l) => (
						<span key={l.kurz} class="inline-flex items-center gap-1">
							<span
								class="inline-block w-3 h-3"
								style={{ background: l.farbe }}
							/>
							{l.kurz}
						</span>
					))}
					<span class="inline-flex items-center gap-1 opacity-70">
						<span
							class="inline-block w-3 h-3"
							style={{ background: "#cbd5e1" }}
						/>
						noch offen
					</span>
				</div>
			)}
		</div>
	);
}
