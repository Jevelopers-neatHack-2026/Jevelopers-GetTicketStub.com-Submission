import { requireSession } from "@/server/auth";
import { newToken } from "@/server/crypto";
import { HttpError, checkOrigin, isObject, json, readJson, route } from "@/server/http";
import { getStorage } from "@/server/index";

export const PUT = route(async (req: Request) => {
  checkOrigin(req);
  const account = await requireSession(req);
  const body = await readJson(req, 1024);
  if (!isObject(body) || typeof body.isPublic !== "boolean") throw new HttpError(400, "bad_request", "Send { isPublic: true or false }.");
  const token = await getStorage().setWallPublic(account.id, body.isPublic, newToken(12));
  return json({ token });
});

export const GET = route(async (req: Request) => {
  const account = await requireSession(req);
  return json(await getStorage().getWallPublic(account.id));
});
