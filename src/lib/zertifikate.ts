import { X509Certificate } from "node:crypto";
import { rootCertificates } from "node:tls";

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

export const pruefeWurzelspeicher = (): Array<{
	cn: string;
	warum: string;
}> => {
	const inhaber = wurzelInhaber();
	return BENOETIGTE_WURZELN.filter(
		(w) => !inhaber.some((s) => s.includes(w.cn)),
	);
};
