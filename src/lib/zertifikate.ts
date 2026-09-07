/**
 * Wurzelzertifikate, auf die diese Anwendung angewiesen ist – und die
 * Verwechslung, vor der dieses Modul schützt.
 *
 * ## Der Fehlschlag, der keiner war
 *
 * `wahl.landkreis-celle.de` liefert eine unvollständige Zertifikatskette: Der
 * Server schickt sein Zertifikat und das Zwischenzertifikat „Sectigo Public
 * Server Authentication CA DV R36“ und hört dann auf. Dessen Aussteller,
 * „Sectigo Public Server Authentication Root R46“, kommt nicht mit.
 *
 * Wer den Host mit `curl` abruft, bekommt deshalb (geprüft am 07.09.2026):
 *
 *     verify error:num=20:unable to get local issuer certificate
 *     HTTP 000, 0 Bytes
 *
 * Und genau hier lag der eigentliche Fehler dieser Anwendung: Dieser Abbruch
 * sieht aus wie „der Server hat nichts“, heißt aber „mein Werkzeug kommt nicht
 * heran“. Aus solchen Fehlschlägen wurde geschlossen, für Celle und Uelzen gebe
 * es keine Ergebnisse. Es gibt sie; nur hatte niemand hinter den Abbruch
 * geschaut. **Ein fehlgeschlagener Abruf belegt keine Abwesenheit von Daten.**
 *
 * ## Warum trotzdem nichts nachgeliefert wird
 *
 * Naheliegend wäre, Sectigos gegenquittiertes R46 mitzuliefern und über
 * `NODE_EXTRA_CA_CERTS` einzuhängen. Das wäre hier aber ein Heilmittel gegen
 * eine Krankheit, die die Anwendung gar nicht hat:
 *
 * **Node bringt R46 in seinem eingebauten Wurzelspeicher schon mit.** Nur der
 * Speicher des Betriebssystems (Debian `ca-certificates`, den `curl` und
 * `openssl` benutzen) kennt es nicht. Ein echter Abruf aus Node heraus – die
 * Laufzeit, in der der Poller läuft – gelingt anstandslos:
 *
 *     fetch("https://wahl.landkreis-celle.de/.../parteistimmen.csv")
 *       → 200, 46 221 Bytes
 *
 * Ein zusätzliches Zertifikat einzuhängen hieße also, einen Vertrauensanker
 * mehr zu pflegen, ohne dass er etwas löst. Das Betriebsbild bestätigt es: Das
 * Abbild ist `node:22-alpine` und setzt weder `--use-openssl-ca` noch
 * `NODE_OPTIONS`; es gilt der eingebaute Speicher.
 *
 * Bliebe der Tag, an dem Node R46 wieder herauswirft oder jemand
 * `--use-openssl-ca` setzt. Dann ist Celle aus Node heraus unerreichbar – und
 * `pruefeWurzelspeicher()` sagt es, statt es als Datenmangel erscheinen zu
 * lassen. Der Test dazu läuft in der CI und braucht kein Netz.
 *
 * Für Werkzeuge, die am Betriebssystem hängen (`curl`, `openssl` – auch in
 * Skripten und in der CI), ist der saubere Weg nicht `-k`, sondern Sectigos
 * veröffentlichtes Zwischenzertifikat, das der Server vergisst:
 *
 *     curl -sO http://crt.sectigo.com/SectigoPublicServerAuthenticationRootR46.p7c
 *     openssl pkcs7 -inform DER -in SectigoPublicServerAuthenticationRootR46.p7c \
 *       -print_certs -out r46.pem
 *     cat /etc/ssl/certs/ca-certificates.crt r46.pem > bundle.pem
 *     curl --cacert bundle.pem https://wahl.landkreis-celle.de/...
 *
 * Die Prüfung bleibt dabei eingeschaltet; das nachgelieferte Glied ist von
 * „USERTrust RSA Certification Authority“ signiert, die ohnehin in jedem
 * Speicher steht. `curl -k` wäre etwas ganz anderes: Es nimmt jedem Server der
 * Welt die Prüfung ab, um einem einzigen zu helfen.
 */
import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";

/**
 * Wurzeln, ohne die einzelne Wahl-Server aus Node heraus unerreichbar wären.
 *
 * Aufgenommen wird eine Wurzel hier, sobald ein Host in `kreise.ts` von ihr
 * abhängt **und** sich nicht darauf verlassen kann, dass der Server die Kette
 * vollständig ausliefert. Das ist kein Vertrauensanker, den wir setzen – es ist
 * eine Erwartung an die Laufzeit, die wir überprüfbar machen.
 */
export const BENOETIGTE_WURZELN: Array<{ cn: string; warum: string }> = [
	{
		cn: "Sectigo Public Server Authentication Root R46",
		warum:
			"wahl.landkreis-celle.de schickt diese Wurzel nicht mit; ohne sie im Speicher bricht jeder Abruf mit „unable to get local issuer certificate“ ab",
	},
];

/** Alle Inhaber (Subjects) im eingebauten Wurzelspeicher von Node. */
const wurzelInhaber = (): string[] =>
	rootCertificates.flatMap((pem) => {
		try {
			return [new X509Certificate(pem).subject];
		} catch {
			return [];
		}
	});

/**
 * Welche der benötigten Wurzeln fehlen?
 *
 * Leer ist der Normalfall. Ist die Liste nicht leer, sind die betroffenen Hosts
 * nicht etwa datenlos, sondern schlicht nicht erreichbar – und das ist eine
 * andere Meldung.
 */
export const pruefeWurzelspeicher = (): Array<{
	cn: string;
	warum: string;
}> => {
	const inhaber = wurzelInhaber();
	return BENOETIGTE_WURZELN.filter(
		(w) => !inhaber.some((s) => s.includes(w.cn)),
	);
};
