import { getRequestContext, requireCapability } from "@/server/context";
import { hashToken } from "@/server/crypto";
import { checkOrigin, clientIp, json, limit, notFound, route } from "@/server/http";
import { getStorage } from "@/server/index";
import { publicStub } from "@/server/project";
import { parseToken } from "@/server/validate";

type Ctx = { params: Promise<{ token: string }> };

// The gift token is the claim link: whoever holds it reads the message. Nothing else does.
export const GET = route(async (req: Request, ctx: Ctx) => {
  limit(`gift:read:${clientIp(req)}`, 120, 15 * 60_000);
  const rc = await getRequestContext(req);
  const tokenHash = hashToken(parseToken((await ctx.params).token));
  const gift = await getStorage().getGift(tokenHash, Date.now(), false);
  if (!gift) throw notFound();
  // The sender previewing their own gift doesn't count as the recipient opening it.
  const own = rc.actor.kind !== "anonymous" && gift.ownerKey === rc.tenant.id;
  const seen = own ? gift : ((await getStorage().getGift(tokenHash, Date.now(), true)) ?? gift);
  return json(
    { stub: publicStub(seen.stub), to: seen.to, message: seen.message, openedAt: seen.openedAt },
    { headers: { "x-robots-tag": "noindex, nofollow" } },
  );
});

// The sender takes the gift back: the row and its message are deleted, and the link answers 404.
export const DELETE = route(async (req: Request, ctx: Ctx) => {
  checkOrigin(req);
  limit(`gift:revoke:${clientIp(req)}`, 60, 15 * 60_000);
  const tokenHash = hashToken(parseToken((await ctx.params).token));
  const gift = await getStorage().getGift(tokenHash, Date.now(), false);
  if (!gift) throw notFound();
  const rc = await getRequestContext(req, { kind: "stub", id: gift.stubId });
  requireCapability(rc, "share.revoke"); // not the owner: 404, the same as an unknown gift
  const revoked = await getStorage().revokeGift(rc.tenant.id, tokenHash);
  return json({ ok: true, revoked });
});
