/**
 * Die Umgebung eines Testservers – an einer Stelle gebaut.
 *
 * Der Schlüssel des Sprachdienstes wird dabei ausgesondert und nicht
 * weitergereicht, auch nicht von einem Aufrufer. Im Wurzelverzeichnis liegt
 * eine `.env` mit einem gültigen Schlüssel; ein geerbter Schlüssel ließe einen
 * Testlauf auf Rechnung des Betreibers telefonieren.
 *
 * Wer den Ansageweg mitprüfen will, gibt eine Gegenstelle auf diesem Rechner
 * an: Dann steht ein erfundener Schlüssel in der Umgebung, und `OPENAI_BASIS`
 * führt zu ihr. Der echte Schlüssel kommt auch dann nicht hinein.
 */

/** Der Schlüssel für die Gegenstelle im Test – ein Wort, kein Geheimnis. */
export const TEST_SCHLUESSEL = "test-ohne-guthaben";

const AUF_DIESEM_RECHNER = /^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/;

export const testUmgebung = (
	eigenes: NodeJS.ProcessEnv = {},
	gegenstelle?: string,
): NodeJS.ProcessEnv => {
	const umgebung: NodeJS.ProcessEnv = { ...process.env, ...eigenes };
	delete umgebung.OPENAI_API_KEY;
	if (!gegenstelle) return umgebung;
	if (!AUF_DIESEM_RECHNER.test(gegenstelle))
		throw new Error(
			`Die Gegenstelle eines Tests liegt auf diesem Rechner, nicht auf ${gegenstelle}`,
		);
	umgebung.OPENAI_BASIS = gegenstelle;
	umgebung.OPENAI_API_KEY = TEST_SCHLUESSEL;
	return umgebung;
};
