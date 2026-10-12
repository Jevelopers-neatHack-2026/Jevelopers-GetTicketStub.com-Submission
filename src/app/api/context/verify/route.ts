import { verifyContextTokenLive } from "@/server/context";
import { HttpError, clientIp, isObject, json, limit, readJson, route } from "@/server/http";

// The verification port for a consumer in another process that can't hold the signing key. It answers what
// the issuer says about a token right now. It uses no cookie, so there is nothing for a cross-site page to ride.
export const POST = route(async (req: Request) => {
  limit(`ctx-verify:ip:${clientIp(req)}`, 120, 60_000);
  const body = await readJson(req, 16 * 1024);
  if (!isObject(body) || typeof body.token !== "string") throw new HttpError(400, "bad_request", "Send { token }.");
  const result = await verifyContextTokenLive(body.token);
  return result.ok ? json({ ok: true, context: result.ctx }) : json({ ok: false, reason: result.reason, error: { code: "unauthorized", message: "That context token is no longer good." } }, { status: 401 });
});
