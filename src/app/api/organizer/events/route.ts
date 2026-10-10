import { randomBytes } from "node:crypto";
import { requireSession } from "@/server/auth";
import { hashToken, newToken } from "@/server/crypto";
import { HttpError, checkOrigin, isObject, json, readJson, route } from "@/server/http";
import { getStorage } from "@/server/index";
import type { NewClaim } from "@/server/storage";
import { MAX_STUB_BODY, readStub, parseText } from "@/server/validate";

const MAX_GUESTS = 500;
const bad = (m: string) => new HttpError(400, "bad_request", m);

export const POST = route(async (req: Request) => {
  checkOrigin(req);
  const account = await requireSession(req);
  const body = await readJson(req, MAX_STUB_BODY + 256 * 1024);
  if (!isObject(body)) throw bad("Send { title, stub, guests }.");
  const now = Date.now();
  const title = parseText(body.title, 200, "The event title");
  const stub = readStub(body.stub, now);
  if (!Array.isArray(body.guests) || body.guests.length < 1 || body.guests.length > MAX_GUESTS) throw bad(`Add between 1 and ${MAX_GUESTS} guests.`);
  const days = body.expiresInDays === undefined ? 30 : body.expiresInDays;
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > 365) throw bad("Expiry must be 1 to 365 days.");

  const claims: { token: string; name: string; seat?: string }[] = [];
  const rows: NewClaim[] = [];
  for (const g of body.guests) {
    if (!isObject(g)) throw bad("A guest is not valid.");
    const name = parseText(g.name, 120, "A guest name");
    const seat = g.seat === undefined || g.seat === "" ? undefined : parseText(g.seat, 60, "A seat");
    const token = newToken(16);
    claims.push({ token, name, ...(seat ? { seat } : {}) });
    rows.push({ tokenHash: hashToken(token), guestName: name, seat });
  }
  const eventId = `evt_${randomBytes(9).toString("base64url")}`;
  await getStorage().createEvent(account.id, { id: eventId, title, stub, expiresAt: now + days * 24 * 3600_000 }, rows, now);
  return json({ eventId, claims });
});
