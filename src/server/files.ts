import "server-only";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Stub } from "@/customer/studio/types";
import { HttpError } from "./http";

// Art lives on disk as content-hashed files, not inside the database rows. A stub carries the relative
// URL /api/files/<sha256>.<ext>. Same bytes, same name, so nothing is stored twice and the URL never changes.

export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const FILE_NAME = /^[a-f0-9]{64}\.(png|jpg|webp)$/;
export const CONTENT_TYPE: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

const DATA_URL = /^data:image\/(png|jpe?g|webp);base64,([A-Za-z0-9+/]+={0,2})$/;

const dir = () => resolve(/*turbopackIgnore: true*/ process.env.TICKETSTUB_FILES ?? "./data/files");

/** What the bytes really are, by magic number. The declared type is never trusted. */
function sniff(b: Buffer): "png" | "jpg" | "webp" | null {
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  if (b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  return null;
}

const refuse = (message: string) => new HttpError(400, "bad_image", message);

/** Writes one data URL to disk and returns its /api/files/ URL. Throws 400 on anything that isn't a real png, jpeg or webp. */
export function storeDataUrl(dataUrl: string): string {
  // Cheap size gate before decoding: base64 is 4 chars per 3 bytes.
  if (dataUrl.length > Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 64) throw new HttpError(413, "too_large", "An image is too large to save.");
  const m = DATA_URL.exec(dataUrl);
  if (!m) throw refuse("An image isn't a PNG, JPEG or WebP.");
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, "too_large", "An image is too large to save.");
  const kind = sniff(bytes);
  const declared = m[1] === "jpeg" ? "jpg" : m[1];
  if (!kind || kind !== declared) throw refuse("An image isn't a PNG, JPEG or WebP.");
  const name = `${createHash("sha256").update(bytes).digest("hex")}.${kind}`;
  const target = join(dir(), name);
  if (!existsSync(target)) {
    mkdirSync(dir(), { recursive: true });
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, bytes);
    renameSync(tmp, target); // atomic, so a reader never sees half a file
  }
  return `/api/files/${name}`;
}

/**
 * Moves every data:image URL in a stub (versions[].art.src, and anything else that holds one) out to a file.
 * Only the string values change: updatedAt and every other field are left exactly as they were.
 */
export function externalizeArt(stub: Stub): Stub {
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === "string") {
      if (!v.startsWith("data:")) return v;
      return storeDataUrl(v);
    }
    if (depth > 12 || v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) out[k] = walk(x, depth + 1);
    return out;
  };
  return walk(stub, 0) as Stub;
}

/** The bytes of a stored file, or null. The name is checked against the strict pattern first, so no path can escape the folder. */
export function readStoredFile(name: string): { bytes: Buffer; type: string } | null {
  const m = FILE_NAME.exec(name);
  if (!m) return null;
  try {
    return { bytes: readFileSync(/*turbopackIgnore: true*/ join(dir(), name)), type: CONTENT_TYPE[m[1]] };
  } catch {
    return null;
  }
}

export function removeStoredFiles(names: string[]): void {
  for (const n of names) if (FILE_NAME.test(n)) rmSync(/*turbopackIgnore: true*/ join(dir(), n), { force: true });
}
