import { getSession } from "@/server/auth";
import { newToken } from "@/server/crypto";
import { HttpError, checkOrigin, clientIp, isObject, json, limit, readJson, route } from "@/server/http";
import { getStorage } from "@/server/index";
import { MAX_STUB_BODY, readStub } from "@/server/validate";

// A share snapshot is keyed by (owner, stub id): a signed-in owner can only ever update their own, and
// the token is the same each time. Signed-out shares all sit under "anon" (there is no owner to prove).
export const POST = route(async (req: Request) => {
  checkOrigin(req);
  limit(`share:ip:${clientIp(req)}`, 60, 15 * 60_000);
  const body = await readJson(req, MAX_STUB_BODY + 1024);
  if (!isObject(body)) throw new HttpError(400, "bad_request", "Send { stub }.");
  const now = Date.now();
  const stub = readStub(body.stub, now);
  const account = await getSession(req);
  const token = await getStorage().upsertShare(account?.id ?? "anon", stub, newToken(9), now);
  return json({ token });
});
