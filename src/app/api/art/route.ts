import { NextResponse } from "next/server";
import { buildArtPrompt } from "@/customer/studio/research/artPrompt";
import type { ArtLayer, Edition, EventData } from "@/customer/studio/types";
import { getSession } from "@/server/auth";
import { hashToken, newToken } from "@/server/crypto";
import { clientIp } from "@/server/http";
import { getStorage } from "@/server/index";
import type { ArtQuota } from "@/server/storage";

// Daily caps on OpenAI art: per account, per device (an httpOnly cookie) and per IP as a backstop.
// The caps are read on every call but only counted when OpenAI is actually called, so a server
// without a key never uses anyone's allowance.
const PER_ACCOUNT = 10;
const PER_DEVICE = 10;
const PER_IP = 30;
const DEVICE_COOKIE = "ts_device";
const DEVICE_RE = /^[A-Za-z0-9_-]{16,64}$/;

// Art layer generation. "live" only when a real image model returned pixels in this request;
// otherwise a deterministic procedural layer (seed + vibe) marked "simulated".

interface ArtRequest {
  event?: EventData;
  vibe?: string;
  seed?: number;
  /** Optional: edition of the version being made. */
  edition?: Edition;
  /** Optional: true for the very first version of a stub (no remix yet). */
  first?: boolean;
}

function freshSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

async function openAiImage(prompt: string): Promise<string | undefined> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return undefined;
  try {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "gpt-image-1", prompt, size: "1024x1536", n: 1, quality: "medium", output_format: "jpeg", output_compression: 82 }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { data?: { b64_json?: string }[] };
    const b64 = data.data?.[0]?.b64_json;
    return b64 ? `data:image/jpeg;base64,${b64}` : undefined;
  } catch {
    return undefined;
  }
}

function deviceId(req: Request): { id: string; fresh: boolean } {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === DEVICE_COOKIE) {
      const v = part.slice(i + 1).trim();
      if (DEVICE_RE.test(v)) return { id: v, fresh: false };
    }
  }
  return { id: newToken(), fresh: true };
}

export async function POST(req: Request) {
  let body: ArtRequest;
  try {
    body = (await req.json()) as ArtRequest;
  } catch {
    return NextResponse.json({ error: "Send the event to remix." }, { status: 400 });
  }
  if (!body.event || typeof body.event.title !== "string") {
    return NextResponse.json({ error: "Send the event to remix." }, { status: 400 });
  }

  const vibe = typeof body.vibe === "string" && body.vibe.trim() ? body.vibe.trim().slice(0, 120) : undefined;
  const seed = typeof body.seed === "number" && Number.isFinite(body.seed) ? Math.floor(body.seed) : freshSeed();

  const device = deviceId(req);
  const headers: Record<string, string> = device.fresh
    ? { "set-cookie": `${DEVICE_COOKIE}=${device.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${365 * 24 * 3600}${process.env.NODE_ENV === "production" ? "; Secure" : ""}` }
    : {};
  const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });

  const account = await getSession(req).catch(() => null);
  const quotas: ArtQuota[] = [
    { key: `dev:${hashToken(device.id)}`, max: PER_DEVICE },
    { key: `ip:${hashToken(clientIp(req))}`, max: PER_IP },
    ...(account ? [{ key: `acc:${account.id}`, max: PER_ACCOUNT }] : []),
  ];
  const quota = await getStorage().useArtQuota(quotas, Date.now(), !!process.env.OPENAI_API_KEY);
  if (!quota.ok) {
    // Over the cap: say so, and hand back procedural art so the caller never has to show a broken stub.
    const art: ArtLayer = { kind: "procedural", seed, vibe, provenance: "simulated" };
    return reply(
      { error: { code: "art_limit", message: "You've made a lot of art today. Procedural art still works, and new art comes back tomorrow." }, retryAt: quota.retryAt, art },
      429,
    );
  }

  const src = await openAiImage(buildArtPrompt(body.event, vibe));
  if (src) {
    const art: ArtLayer = { kind: "image", src, seed, vibe, provenance: "live" };
    return reply(art);
  }

  if (body.first && body.edition === "researched" && !vibe) {
    const art: ArtLayer = { kind: "image", src: "/brand/mockup-art-glasgow.webp", seed, provenance: "simulated" };
    return reply(art);
  }

  const art: ArtLayer = { kind: "procedural", seed, vibe, provenance: "simulated" };
  return reply(art);
}
