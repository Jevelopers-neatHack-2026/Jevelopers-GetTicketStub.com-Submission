import { clearedCookie, endSession } from "@/server/auth";
import { accountOf, getRequestContext, requireCapability } from "@/server/context";
import { checkOrigin, isObject, json, readJson, route } from "@/server/http";
import { getStorage } from "@/server/index";

export const POST = route(async (req: Request) => {
  checkOrigin(req);
  // { everywhere: true } ends every session of the account and moves its membershipRevision, so context tokens
  // issued before it read as revoked or stale. Plain sign-out ends this browser's session only.
  const body = await readJson(req, 1024).catch(() => null);
  if (isObject(body) && body.everywhere === true) {
    const ctx = await getRequestContext(req);
    requireCapability(ctx, "session.revoke");
    await getStorage().deleteAccountSessions((await accountOf(ctx)).id);
  }
  await endSession(req);
  return json({ ok: true }, { headers: { "set-cookie": clearedCookie() } });
});
