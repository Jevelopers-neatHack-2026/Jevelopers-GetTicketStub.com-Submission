import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

export const packageRoot = new URL("../../../", import.meta.url);
export function resource(path: string): URL {
	return new URL(path, packageRoot);
}
export function sha256(bytes: Uint8Array | string): string {
	return createHash("sha256").update(bytes).digest("hex");
}
export async function readResource(path: string): Promise<Buffer> {
	return readFile(resource(path));
}
