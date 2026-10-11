import { getRequestContext, ensureDevice, requireCapability } from "@/server/context";
import { hashToken, newToken } from "@/server/crypto";
import { HttpError, checkOrigin, clientIp, isObject, json, limit, notFound, readJson, route } from "@/server/http";
import { getStorage, requireStorage } from "@/server/index";
import { cleanGiftText, GIFT_MESSAGE_MAX, GIFT_TO_MAX } from "@/server/validate";

// A gift is a message that travels with its own link. The sender must own the stub (a stub on their
// account's wall, or one their account or guest device shared); the stub id in the body only names it.
// The message is stored here, hashed-token keyed, and never joins a share snapshot.
export const POST = route(async (req: Request) => {
  requireStorage();
  checkOrigin(req);
  limit(`gift:ip:${clientIp(req)}`, 60, 15 * 60_000);
  const body = await readJson(req, 4096);
  if (!isObject(body) || typeof body.stub !== "string") throw new HttpError(400, "bad_request", "Send { stub, to, message }.");
  const to = cleanGiftText(body.to, GIFT_TO_MAX);
  if (!to) throw new HttpError(400, "bad_request", "Add who the gift is for.");
  if (body.message !== undefined && typeof body.message !== "string") throw new HttpError(400, "bad_request", "The message has to be text.");
  const message = cleanGiftText(body.message ?? "", GIFT_MESSAGE_MAX + 1);
  if (message.length > GIFT_MESSAGE_MAX) throw new HttpError(400, "message_too_long", `Keep the message to ${GIFT_MESSAGE_MAX} characters.`);
  const ctx = await getRequestContext(req, { kind: "stub", id: body.stub });
  requireCapability(ctx, "gift.create"); // someone else's stub is a 404, exactly as if it did not exist
  const device = ctx.actor.kind === "account" ? null : ensureDevice(req);
  const giftToken = newToken(16);
  const shareToken = await getStorage().createGift(ctx.tenant.id, body.stub, hashToken(giftToken), to, message, Date.now());
  if (!shareToken) throw notFound(); // owned, but not shared yet: nothing to unwrap
  return json({ giftToken, sharePath: `/s/${shareToken}?gift=${giftToken}` }, device?.cookie ? { headers: { "set-cookie": device.cookie } } : undefined);
});
