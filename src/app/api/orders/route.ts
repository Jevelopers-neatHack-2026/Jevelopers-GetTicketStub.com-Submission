import { randomBytes } from "node:crypto";
import type { Order } from "@/customer/pages/commerce";
import { CAPABILITY_VERSION, orderGate, runtimeMode, variantFor } from "@/customer/pages/capabilities";
import { accountOf, getRequestContext, requireCapability } from "@/server/context";
import { recordEvent } from "@/server/event-log";
import { HttpError, appOrigin, checkOrigin, clientIp, isObject, json, limit, readJson, route } from "@/server/http";
import { getStorage, requireStorage } from "@/server/index";
import { refOf } from "@/server/events";
import { sendReceipt } from "@/server/receipt";
import { parseEmail, parseText } from "@/server/validate";
import { DodoError, createCheckout, dodoConfig } from "@/server/payments/dodo";
import { allOrderable, isDigitalOnly, verifiedTotalMinor } from "@/server/payments/pricing";

const MATERIALS = ["digital", "card", "print", "framed"];
const FINISHES = ["matte", "foil", "holo"];
const SIZES = ["classic", "stamp", "framed", "file"];
const METHODS = ["apple-pay", "google-pay", "card", "gift-print", "organizer-print"];
/** Methods a hosted provider checkout collects. Gift and organizer prints are not paid this way. */
const PAID_METHODS = new Set(["apple-pay", "google-pay", "card"]);
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
    const material = l.material as Order["lines"][number]["material"];
    const finish = l.finish as Order["lines"][number]["finish"];
    const size = l.size as Order["lines"][number]["size"];
    // The status is derived here from the capability map. A variantStatus the browser sent is read by nobody.
    const variant = variantFor(material, size, finish);
    const gate = orderGate(variant, runtimeMode({ TICKETSTUB_RUNTIME_MODE: process.env.TICKETSTUB_RUNTIME_MODE }));
    if (!gate.ok || !variant) throw new HttpError(422, "variant_not_orderable", gate.ok ? "That combination isn't on our list." : gate.message);
    return {
      title: parseText(l.title, 200, "A line title"),
      material,
      finish,
      size,
      totalMinor: minor(l.totalMinor, "A line total"),
      variantStatus: variant.status,
    };
  });
  if (!METHODS.includes(v.method as string)) throw bad("The payment method is not valid.");
  const out: Omit<Order, "id" | "mode" | "createdAt"> = {
    stubIds: v.stubIds as string[],
    lines,
    capabilityVersion: CAPABILITY_VERSION,
    totalMinor: minor(v.totalMinor, "The total"),
    currency: "USD",
    method: v.method as Order["method"],
  };
  if (typeof v.quoteId === "string" && v.quoteId.length <= 200) out.quoteId = v.quoteId;
  if (v.email !== undefined && v.email !== "") out.email = parseEmail(v.email);
  return out;
}

export const POST = route(async (req: Request) => {
  requireStorage();
  checkOrigin(req);
  limit(`orders:ip:${clientIp(req)}`, 30, 15 * 60_000);
  const body = await readJson(req, 64 * 1024);
  if (!isObject(body)) throw bad("Send { order }.");
  let parsed: ReturnType<typeof parseOrder>;
  try {
    parsed = parseOrder(body.order);
  } catch (e) {
    if (e instanceof HttpError && e.code === "variant_not_orderable") await recordEvent(req, "order_blocked", { code: e.code });
    throw e;
  }
  const ctx = await getRequestContext(req);
  requireCapability(ctx, "order.create");
  const account = ctx.actor.kind === "account" ? await accountOf(ctx) : null;
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
  // An all-digital card or wallet order of orderable variants is paid through Dodo when it is configured. Anything else
  // (a physical line, or a preview such as digital holo) stays a sandbox order
  // until it can be charged (#64). Nothing is stored when the checkout can't be started.
  const dodo = dodoConfig();
  let checkoutUrl: string | undefined;
  if (dodo && isDigitalOnly(order) && allOrderable(order) && PAID_METHODS.has(order.method)) {
    const amountMinor = verifiedTotalMinor(order);
    try {
      const c = await createCheckout(dodo, { orderId: order.id, amountMinor, email, returnUrl: `${appOrigin(req)}/payment/return?order=${encodeURIComponent(order.id)}` });
      order.payment = { provider: "dodo", environment: dodo.environment, status: "pending", amountMinor, currency: "USD", checkoutSessionId: c.sessionId, updatedAt: new Date().toISOString() };
      checkoutUrl = c.checkoutUrl;
    } catch (e) {
      if (!(e instanceof DodoError)) throw e;
      console.error(`[payments] dodo checkout failed: ${e.status}`);
      throw new HttpError(502, "payment_unavailable", "We couldn't start the payment. Nothing was charged. Try again in a moment.");
    }
  }
  await getStorage().createOrder(order, account?.id ?? null, email);
  // A paid order's receipt is sent once its payment is confirmed (see the Dodo webhook), not now.
  if (!checkoutUrl) await sendReceipt(order, account?.id ?? null, email, appOrigin(req));
  await recordEvent(req, "order_placed", { order: refOf(order.id), lines: order.lines.length, totalMinor: order.totalMinor }, { ctx });
  return json(checkoutUrl ? { order, checkoutUrl } : { order });
});

export const GET = route(async (req: Request) => {
  requireStorage();
  const ctx = await getRequestContext(req);
  requireCapability(ctx, "order.read");
  const account = await accountOf(ctx);
  return json({ orders: await getStorage().listOrders(account.id, account.email) });
});
