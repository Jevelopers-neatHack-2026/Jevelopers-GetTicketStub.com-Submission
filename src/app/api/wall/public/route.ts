import { accountOf, getRequestContext, requireCapability } from "@/server/context";
import { newToken } from "@/server/crypto";
import { HttpError, checkOrigin, isObject, json, readJson, route } from "@/server/http";
import { getStorage } from "@/server/index";

// { isPublic } switches the public wall on or off and keeps its token. { rotate: true } issues a new token so the
// old link dies; with { isPublic: false } as well it is "Stop sharing" (private, and a re-share gets a new link).
export const PUT = route(async (req: Request) => {
  checkOrigin(req);
  const ctx = await getRequestContext(req);
  requireCapability(ctx, "wall.publish");
  const account = await accountOf(ctx);
  const body = await readJson(req, 1024);
  if (!isObject(body) || typeof body.isPublic !== "boolean" || (body.rotate !== undefined && typeof body.rotate !== "boolean")) {
    throw new HttpError(400, "bad_request", "Send { isPublic: true or false, rotate?: true }.");
  }
  const storage = getStorage();
  const token =
    body.rotate === true
      ? await storage.rotateWallToken(account.id, newToken(12), body.isPublic)
      : await storage.setWallPublic(account.id, body.isPublic, newToken(12));
  return json({ token });
});

export const GET = route(async (req: Request) => {
  const ctx = await getRequestContext(req);
  requireCapability(ctx, "wall.publish");
  return json(await getStorage().getWallPublic((await accountOf(ctx)).id));
});
