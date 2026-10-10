"use client";
// Local persistence: the cache and the signed-out mode. Signed in, account/sync.ts merges it with the account's wall.
// Old share links carry the stub itself (see encodeStub),
// so memory pages work without a backend. Storage can throw (private mode): every access is guarded.
import type { Stub } from "./types";

const KEY = "ticketstub.wall.v1";
const DELETED_KEY = "ticketstub.wall.deleted.v1";
/** Fired after a local change the account sync should hear about. A sync's own writes don't fire it. */
export const WALL_CHANGED = "ticketstub:wall-changed";

function changed(): void {
  try {
    window.dispatchEvent(new Event(WALL_CHANGED));
  } catch {
    /* no window (server render) */
  }
}

/** Ids removed on this device that the account hasn't heard about yet. Signed out they just accumulate, a few bytes each. */
export function loadDeleted(): string[] {
  try {
    const raw = localStorage.getItem(DELETED_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function saveDeleted(ids: string[]): void {
  try {
    localStorage.setItem(DELETED_KEY, JSON.stringify([...new Set(ids)]));
  } catch {
    /* storage unavailable or full */
  }
}

export function loadWall(): Stub[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stub[]) : [];
  } catch {
    return [];
  }
}

/** Drop inline image data from non-current versions: live art is a 200-400 KB data URL each. */
function slim(stub: Stub): Stub {
  return {
    ...stub,
    versions: stub.versions.map((v) =>
      v.id !== stub.currentVersionId && v.art.src?.startsWith("data:") ? { ...v, art: { ...v.art, kind: "procedural", src: undefined } } : v,
    ),
  };
}

/** Write the wall without telling the sync (the sync's own result goes through here). */
export function writeWall(stubs: Stub[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(stubs.map(slim)));
  } catch {
    /* storage unavailable or full: the session still works in memory */
  }
}

export function saveWall(stubs: Stub[]): void {
  writeWall(stubs);
  changed();
}

export function getStub(id: string): Stub | undefined {
  return loadWall().find((s) => s.id === id);
}

export function upsertStub(stub: Stub): void {
  const wall = loadWall().filter((s) => s.id !== stub.id);
  const gone = loadDeleted();
  if (gone.includes(stub.id)) saveDeleted(gone.filter((id) => id !== stub.id));
  saveWall([{ ...stub, updatedAt: Date.now() }, ...wall]);
}

export function removeStub(id: string): void {
  saveDeleted([...loadDeleted(), id]);
  saveWall(loadWall().filter((s) => s.id !== id));
}

/** Compact, URL-safe encoding of a stub for share links (photos dropped to keep URLs short). */
export function encodeStub(stub: Stub): string {
  // Share links can't carry inline images: data-URL art falls back to its procedural seed.
  const lean: Stub = {
    ...stub,
    photos: [],
    versions: stub.versions.map((v) => (v.art.src?.startsWith("data:") ? { ...v, art: { ...v.art, kind: "procedural", src: undefined } } : v)),
  };
  const json = JSON.stringify(lean);
  const b64 = typeof window === "undefined" ? Buffer.from(json, "utf-8").toString("base64") : btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeStub(token: string): Stub | undefined {
  try {
    const b64 = token.replace(/-/g, "+").replace(/_/g, "/");
    const json = typeof window === "undefined" ? Buffer.from(b64, "base64").toString("utf-8") : decodeURIComponent(escape(atob(b64)));
    return JSON.parse(json) as Stub;
  } catch {
    return undefined;
  }
}
