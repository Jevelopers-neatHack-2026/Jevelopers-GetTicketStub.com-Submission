import { randomBytes } from "node:crypto";
import type { Order } from "@/customer/pages/commerce";
import { getSession, requireSession } from "@/server/auth";
import { HttpError, appOrigin, checkOrigin, clientIp, isObject, json, limit, readJson, route } from "@/server/http";
import { getStorage } from "@/server/index";
import { sendMail } from "@/server/mail";
import { newToken } from "@/server/crypto";
import { receiptMail, stubImageUrl } from "@/server/templates";
import { parseEmail, parseText } from "@/server/validate";

const MATERIALS = ["digital", "card", "print", "framed"];
const FINISHES = ["matte", "foil", "holo"];
const SIZES = ["classic", "stamp", "framed", "file"];
const METHODS = ["apple-pay", "google-pay", "card", "gift-print", "organizer-print"];
const bad = (m: string) => new HttpError(400, "bad_request", m);
const minor = (v: unknown, what: string) => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 100_000_000) throw bad(`${what} is not a valid amount.`);
  return v;
};

/** Rebuilds the order from the fields we know, so nothing else the client sent is stored. */
function parseOrder(v: unknown): Omit<Order, "id" | "mode" | "createdAt"> {
  if (!isObject(v)) throw bad("Send { order }.");
  if (!Array.isArray(v.stubIds) || v.stubIds.length > 200 || !v.stubIds.every((s) => typeof s === "string" && s.length > 0 && s.length <= 128)) throw bad("The order's stubs are not valid.");
  if (!Array.isArray(v.lines) || v.lines.length < 1 || v.lines.length > 200) throw bad("The order has no lines.");
  const lines = v.lines.map((l: unknown) => {
    if (!isObject(l)) throw bad("An order line is not valid.");
    if (!MATERIALS.includes(l.material as string) || !FINISHES.includes(l.finish as string) || !SIZES.includes(l.size as string)) throw bad("An order line has an unknown material, finish or size.");
    return {
      title: parseText(l.title, 200, "A line title"),
      material: l.material as Order["lines"][number]["material"],
      finish: l.finish as Order["lines"][number]["finish"],
      size: l.size as Order["lines"][number]["size"],
      totalMinor: minor(l.totalMinor, "A line total"),
    };
  });
  if (!METHODS.includes(v.method as string)) throw bad("The payment method is not valid.");
  const out: Omit<Order, "id" | "mode" | "createdAt"> = {
    stubIds: v.stubIds as string[],
    lines,
    totalMinor: minor(v.totalMinor, "The total"),
    currency: "USD",
    method: v.method as Order["method"],
  };
  if (typeof v.quoteId === "string" && v.quoteId.length <= 200) out.quoteId = v.quoteId;
  if (v.email !== undefined && v.email !== "") out.email = parseEmail(v.email);
  return out;
}

export const POST = route(async (req: Request) => {
  checkOrigin(req);
  limit(`orders:ip:${clientIp(req)}`, 30, 15 * 60_000);
  const body = await readJson(req, 64 * 1024);
  if (!isObject(body)) throw bad("Send { order }.");
  const parsed = parseOrder(body.order);
  const account = await getSession(req);
  // A guest order needs an email for the receipt. A signed-in order always uses the account's email.
  if (!account && !parsed.email) throw new HttpError(401, "unauthorized", "Add your email or sign in to place an order.");
  const email = account?.email ?? (parsed.email as string);
  const order: Order = {
    ...parsed,
    email,
    id: `ord_${randomBytes(9).toString("base64url")}`,
    mode: "sandbox",
    createdAt: new Date().toISOString(),
  };
  await getStorage().createOrder(order, account?.id ?? null, email);
  try {
    const origin = appOrigin(req);
    // A signed-in order can show its first stub: snapshot it as a share so the email picture can render it.
    let shareToken: string | null = null;
    const first = account ? (await getStorage().listWall(account.id)).find((s) => s.id === order.stubIds[0]) : undefined;
    if (account && first) shareToken = await getStorage().upsertShare(account.id, first, newToken(9), Date.now());
    await sendMail(email, receiptMail(order, `${origin}/wall`, stubImageUrl(origin, shareToken)), `receipt ${order.id}`);
  } catch {
    // The order is saved either way; sendMail has logged why the receipt didn't go.
  }
  return json({ order });
});

export const GET = route(async (req: Request) => {
  const account = await requireSession(req);
  return json({ orders: await getStorage().listOrders(account.id, account.email) });
});
