import { accountOf, getRequestContext, requireCapability } from "@/server/context";
import { hashToken } from "@/server/crypto";
import { HttpError, checkOrigin, json, notFound, route } from "@/server/http";
import { getStorage } from "@/server/index";
import { publicStub } from "@/server/project";
import type { ClaimView } from "@/server/storage";
import { parseToken } from "@/server/validate";
import { withGuestName, type Stub } from "@/customer/studio/types";

type Ctx = { params: Promise<{ token: string }> };

/** The stub as that guest sees it: their name printed on it, the seat on the event, no friends list. */
function guestStub(view: ClaimView): Stub {
  const named = withGuestName(view.stub, view.guestName);
  return view.seat ? { ...named, event: { ...named.event, seat: view.seat } } : named;
}

export const GET = route(async (req: Request, ctx: Ctx) => {
  requireCapability(await getRequestContext(req), "claim.view");
  const view = await getStorage().getClaim(hashToken(parseToken((await ctx.params).token)));
  if (!view) throw notFound();
  return json({
    stub: publicStub(guestStub(view)),
    guestName: view.guestName,
    ...(view.seat ? { seat: view.seat } : {}),
    claimed: view.claimedBy !== null,
    expired: Date.now() > view.expiresAt,
  });
});

export const POST = route(async (req: Request, ctx: Ctx) => {
  checkOrigin(req);
  const rc = await getRequestContext(req);
  requireCapability(rc, "claim.redeem");
  const account = await accountOf(rc); // the claim lands on the verified account, never on an id from the body
  const tokenHash = hashToken(parseToken((await ctx.params).token));
  const now = Date.now();
  // Each claim gets its own stub id on the guest's wall, stable per link, so claiming twice can't duplicate it.
  const result = await getStorage().claim(
    tokenHash,
    account.id,
    (view) => ({ ...guestStub(view), id: `${view.stub.id}-g${tokenHash.slice(0, 10)}`, torn: true, photos: [], updatedAt: now, setId: view.stub.setId ?? view.eventId }),
    now,
  );
  switch (result.status) {
    case "claimed":
    case "already":
      return json({ stub: result.stub });
    case "taken":
      throw new HttpError(409, "already_claimed", "Someone else already claimed this stub.");
    case "expired":
      throw new HttpError(410, "expired", "This claim link has expired. Ask the organizer for a new one.");
    default:
      throw notFound();
  }
});
