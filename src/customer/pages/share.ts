"use client";
import { decodeStub, encodeStub } from "@/customer/studio/store";
import type { Stub } from "@/customer/studio/types";

export function absoluteUrl(path: string): string {
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export const memoryPath = (stub: Stub) => `/s/${encodeStub(stub)}`;

/** Lean copy for list tokens: only the current design version travels. */
function lean(stub: Stub): Stub {
  return { ...stub, photos: [], versions: stub.versions.filter((v) => v.id === stub.currentVersionId).slice(0, 1) };
}

export const WALL_TOKEN_MAX = 6;

/** Public wall token: up to 6 encoded stubs joined by "." (base64url never contains "."). */
export function encodeWall(stubs: Stub[]): string {
  return stubs.slice(0, WALL_TOKEN_MAX).map((s) => encodeStub(lean(s))).join(".");
}

export function decodeWall(token: string): Stub[] {
  return token
    .split(".")
    .map((t) => decodeStub(t))
    .filter((s): s is Stub => !!s && typeof s === "object" && !!s.event);
}

export function isStub(s: unknown): s is Stub {
  return !!s && typeof s === "object" && "event" in s && "id" in s && "versions" in s;
}

export function formatDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
