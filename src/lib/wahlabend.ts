/**
 * Der Schalter der Wahlabend-Schicht: Leinwand, Zustellung, Ansagedienst.
 *
 * Eine Stelle für alles, was nur läuft, während ausgezählt wird. Steht sie auf
 * `0`, gibt es kein Dashboard, keine Leitung, keinen Beitrag und keinen Aufruf
 * beim Sprachdienst – der Rest des Angebots bleibt, wie er ist.
 */
export const wahlabendAn = (): boolean => process.env.WAHLABEND !== "0";
