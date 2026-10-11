import { getRequestContext, ensureDevice, guestTenant, requireCapability } from "@/server/context";
import { newToken } from "@/server/crypto";
import { HttpError, checkOrigin, clientIp, isObject, json, limit, readJson, route } from "@/server/http";
import { getStorage } from "@/server/index";
import { publicStub } from "@/server/project";
import { MAX_STUB_BODY, readStub } from "@/server/validate";

// A share snapshot is keyed by (owner, stub id): the owner is the signed-in account, or the guest device
// (a server-issued cookie), never anything in the body. The token is the same each time until it is
// revoked. The stored snapshot is the public projection: no friends, note or photos.
export const POST = route(async (req: Request) => {
  checkOrigin(req);
  limit(`share:ip:${clientIp(req)}`, 60, 15 * 60_000);
  const body = await readJson(req, MAX_STUB_BODY + 1024);
  if (!isObject(body)) throw new HttpError(400, "bad_request", "Send { stub }.");
  const now = Date.now();
  const stub = publicStub(readStub(body.stub, now));
  const ctx = await getRequestContext(req);
  requireCapability(ctx, "share.create");
  const device = ctx.actor.kind === "account" ? null : ensureDevice(req);
  const owner = device ? guestTenant(device.id) : ctx.tenant.id;
  const token = await getStorage().upsertShare(owner, stub, newToken(9), now);
  return json({ token }, device?.cookie ? { headers: { "set-cookie": device.cookie } } : undefined);
});
