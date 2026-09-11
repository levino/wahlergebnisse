import { spawn } from "node:child_process";
import { createServer } from "node:net";

const freierPort = () =>
	new Promise((fertig, fehler) => {
		const s = createServer();
		s.on("error", fehler);
		s.listen(0, "127.0.0.1", () => {
			const { port } = s.address();
			s.close(() => fertig(port));
		});
	});

const [app, steuer] = [await freierPort(), await freierPort()];
const [befehl, ...argumente] = process.argv.slice(2);
if (!befehl) {
	console.error("Aufruf: node scripts/freie-ports.mjs <befehl> [argumente…]");
	process.exit(2);
}

const kind = spawn(befehl, argumente, {
	stdio: "inherit",
	env: {
		...process.env,
		E2E_APP_PORT: String(app),
		E2E_STEUER_PORT: String(steuer),
	},
	shell: process.platform === "win32",
});
kind.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
