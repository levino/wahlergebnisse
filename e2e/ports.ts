export const APP_PORT = Number(process.env.E2E_APP_PORT ?? 8099);
export const STEUER_PORT = Number(process.env.E2E_STEUER_PORT ?? 8098);
export const BASIS = `http://127.0.0.1:${APP_PORT}`;
export const STEUERUNG = `http://127.0.0.1:${STEUER_PORT}`;
