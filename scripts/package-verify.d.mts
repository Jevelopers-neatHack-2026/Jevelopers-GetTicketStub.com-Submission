export function canonicalJson(value: unknown): string;
export function sha256Hex(bytes: Uint8Array): string;
export function hashManifest(value: unknown): string;
export function verifyInstalledPackage(snapshot: string, pin: Record<string, string>, consumerRoot: string): string | null;
