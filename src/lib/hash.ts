import { createHash } from "node:crypto";

export const hash = (s: string): string =>
	createHash("sha1").update(s).digest("hex").slice(0, 16);
