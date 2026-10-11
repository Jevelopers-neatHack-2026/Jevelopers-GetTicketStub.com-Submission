import { NextResponse } from "next/server";
import { generateImage, providerFailure } from "@/server/ai/providers";
import { buildArtPrompt } from "@/customer/studio/research/artPrompt";
import type { ArtLayer, Edition, EventData } from "@/customer/studio/types";
import { ensureDevice, getRequestContext, requireCapability } from "@/server/context";
import { hashToken } from "@/server/crypto";
import { HttpError, clientIp, errorResponse, foreignOrigin } from "@/server/http";
import { getStorage, storageAvailable } from "@/server/index";
import type { ArtQuota } from "@/server/storage";

// Daily caps on OpenAI art: per account, per device (an httpOnly cookie) and per IP as a backstop.
// The caps are read on every call but only counted when OpenAI is actually called, so a server
// without a key never uses anyone's allowance.
const PER_ACCOUNT = 10;
const PER_DEVICE = 10;
const PER_IP = 30;

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

export async function POST(req: Request) {
  // Guests make art too, so a missing Origin passes (no cookie is needed to call it); a foreign one doesn't.
  if (foreignOrigin(req)) return errorResponse(new HttpError(403, "bad_origin", "This request didn't come from TicketStub."));
  const rc = await getRequestContext(req);
  try {
    requireCapability(rc, "art.generate");
  } catch (e) {
    return errorResponse(e);
  }
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

  const device = ensureDevice(req);
  const headers: Record<string, string> = device.cookie ? { "set-cookie": device.cookie } : {};
  const reply = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });

  const quotas: ArtQuota[] = [
    { key: `dev:${hashToken(device.id)}`, max: PER_DEVICE },
    { key: `ip:${hashToken(clientIp(req))}`, max: PER_IP },
    ...(rc.actor.kind === "account" ? [{ key: `acc:${rc.actor.id}`, max: PER_ACCOUNT }] : []),
  ];
  // Only a live server with an image provider key spends anyone's allowance.
  const imageProvider =
    process.env.TICKETSTUB_RUNTIME_MODE === "live" &&
    !!(process.env.TICKETSTUB_ART_PROVIDER === "openrouter" ? process.env.TICKETSTUB_ART_OPENROUTER_API_KEY : process.env.OPENAI_API_KEY)?.trim();
  // Storage off: no counters to spend, so fail open to procedural art and never call a provider.
  const saving = storageAvailable();
  const quota = saving ? await getStorage().useArtQuota(quotas, Date.now(), imageProvider) : { ok: true as const };
  if (!quota.ok) {
    // Over the cap: say so, and hand back procedural art so the caller never has to show a broken stub.
    const art: ArtLayer = { kind: "procedural", seed, vibe, provenance: "simulated" };
    return reply(
      { error: { code: "art_limit", message: "You've made a lot of art today. Procedural art still works, and new art comes back tomorrow." }, retryAt: quota.retryAt, art },
      429,
    );
  }

  if (saving) {
    try {
      const result = await generateImage(buildArtPrompt(body.event, vibe), req.signal);
      if (result) {
        const art: ArtLayer = { kind: "image", src: result.value, seed, vibe, provenance: "live", providerMetadata: result.metadata };
        return reply(art);
      }
    } catch (error) {
      const failure = providerFailure(error);
      if (failure && (process.env.TICKETSTUB_ART_PROVIDER === "openrouter" || failure.body.code === "invalid_provider_configuration")) return reply(failure.body, failure.status);
    }
  }

  if (body.first && body.edition === "researched" && !vibe) {
    const art: ArtLayer = { kind: "image", src: "/brand/mockup-art-glasgow.webp", seed, provenance: "simulated" };
    return reply(art);
  }

  const art: ArtLayer = { kind: "procedural", seed, vibe, provenance: "simulated" };
  return reply(art);
}
