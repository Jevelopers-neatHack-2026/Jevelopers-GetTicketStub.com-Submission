import { accountOf, getRequestContext, requireCapability } from "@/server/context";
import { HttpError, checkOrigin, isObject, json, readJson, route } from "@/server/http";
import { getStorage, requireStorage } from "@/server/index";
import { readStub } from "@/server/validate";

const MAX_BODY = 32 * 1024 * 1024; // stubs can still carry generated art as data URLs (moved to files on arrival); photos are dropped
const MAX_ITEMS = 1000;

export const POST = route(async (req: Request) => {
  requireStorage();
  checkOrigin(req);
  const ctx = await getRequestContext(req);
  requireCapability(ctx, "wall.sync");
  const account = await accountOf(ctx); // the wall written is always the caller's own, whatever ids the body carries
  const body = await readJson(req, MAX_BODY);
  if (!isObject(body) || !Array.isArray(body.stubs) || !Array.isArray(body.deleted)) {
    throw new HttpError(400, "bad_request", "Send { stubs, deleted }.");
  }
  if (body.stubs.length > MAX_ITEMS || body.deleted.length > MAX_ITEMS) throw new HttpError(413, "too_large", "That's too many stubs to sync at once.");
  const now = Date.now();
  const stubs = body.stubs.map((s) => readStub(s, now));
  const deleted = body.deleted.map((d) => {
    if (typeof d !== "string" || d.length < 1 || d.length > 128) throw new HttpError(400, "bad_request", "A deleted id is not valid.");
    return d;
  });
  const wall = await getStorage().syncWall(account.id, stubs, deleted, now);
  return json({ stubs: wall.stubs, deleted: wall.deleted, now });
});
