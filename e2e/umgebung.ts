/**
 * Die Umgebung eines Testservers – an einer Stelle gebaut.
 *
 * Der Schlüssel des Sprachdienstes wird dabei ausgesondert und nicht
 * weitergereicht, auch nicht von einem Aufrufer. Im Wurzelverzeichnis liegt
 * eine `.env` mit einem gültigen Schlüssel; ein geerbter Schlüssel ließe einen
 * Testlauf auf Rechnung des Betreibers telefonieren.
 *
 * Dass der Ansageweg damit ins Leere läuft, ist gewollt: Die Browser-Tests
 * prüfen Einblender, Ton und Bedienung, nicht den Sprachdienst.
 */
export const testUmgebung = (
	eigenes: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv => {
	const umgebung: NodeJS.ProcessEnv = { ...process.env, ...eigenes };
	delete umgebung.OPENAI_API_KEY;
	return umgebung;
};
