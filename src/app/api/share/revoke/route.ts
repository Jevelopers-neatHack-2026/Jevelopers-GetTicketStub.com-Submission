import { getRequestContext, requireCapability } from "@/server/context";
import { HttpError, checkOrigin, clientIp, isObject, json, limit, readJson, route } from "@/server/http";
import { getStorage } from "@/server/index";

// "Stop sharing": deletes the stub's share snapshot, so its link answers 404 from now on. Sharing again
// mints a new link. Only the owner (a stub on their wall, or one their device or account shared) can do it.
export const POST = route(async (req: Request) => {
  checkOrigin(req);
  limit(`revoke:ip:${clientIp(req)}`, 60, 15 * 60_000);
  const body = await readJson(req, 1024);
  if (!isObject(body) || typeof body.stubId !== "string") throw new HttpError(400, "bad_request", "Send { stubId }.");
  const ctx = await getRequestContext(req, { kind: "stub", id: body.stubId });
  requireCapability(ctx, "share.revoke"); // a stub that isn't theirs is a 404, exactly as if it did not exist
  const revoked = await getStorage().revokeShare(ctx.tenant.id, body.stubId);
  return json({ ok: true, revoked });
});
