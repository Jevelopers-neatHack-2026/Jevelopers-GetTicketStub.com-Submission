import "server-only";
import {
  PRODIGI_SANDBOX_ORIGIN,
  ProdigiSandboxClient,
  type ProdigiHttpPort,
  type ProdigiOrderCreateInput,
  type ProdigiOrderObservation,
} from "../vendor/fulfillment-connectors/dist/prodigi-sandbox.js";
import { PRODIGI_SANDBOX_OPERATION_ENDPOINTS, type SandboxDecisionVerifier } from "../vendor/fulfillment-connectors/dist/provider-matrix.js";
import type { ServerSecretSource } from "../vendor/fulfillment-connectors/dist/security.js";
import { callbackUrl, callbacksEnabled, PRODIGI_SANDBOX_DECISION } from "./prodigi-config";
import type { ProdigiHost } from "./prodigi-host";
import { UNVERIFIED_DECISION } from "./prodigi-host";

// The one place this app creates a Prodigi sandbox order. Nothing calls it yet: it is what the owner-approved
// sandbox order (0003 checklist) and a later order flow go through, so the callback rules hold from the first order.
//
// - callbackUrl is sent only when the callback route is enabled (TICKETSTUB_PRODIGI_CALLBACKS=sandbox), and only
//   on POST /v4.0/Orders. The vendored adapter's create-order body has no callbackUrl field, so it is added at the
//   transport port, which is the adapter's documented injection point; nothing else in the request changes.
// - The URL is built (and the token checked) before anything is sent, so a misconfiguration sends nothing.
// - trackOrder runs as soon as POST /Orders returns, before this function returns. Prodigi assigns the order ID in
//   that response, so the order cannot be tracked before the request: this is the documented "immediately after
//   POST /Orders returns" path (docs/prodigi-callbacks.md, "Tracking"). A callback that races it is answered
//   not_tracked/503 and redelivered. If trackOrder fails, a durable "track" job tracks the order and reads it once.

const ORDERS_URL = `${PRODIGI_SANDBOX_ORIGIN}${PRODIGI_SANDBOX_OPERATION_ENDPOINTS.submit.path}`;

/** Adds `callbackUrl` to the create-order body, and to nothing else. Refuses a body that already carries one. */
export function withCallbackUrl(http: ProdigiHttpPort, url: string): ProdigiHttpPort {
  return Object.freeze({
    async send(request: Parameters<ProdigiHttpPort["send"]>[0]) {
      if (request.method !== "POST" || request.url !== ORDERS_URL || typeof request.body !== "string") return http.send(request);
      const body = JSON.parse(request.body) as unknown;
      if (body === null || typeof body !== "object" || Array.isArray(body) || Object.hasOwn(body, "callbackUrl")) {
        throw new Error("unexpected create-order body");
      }
      return http.send({ ...request, body: JSON.stringify({ ...body, callbackUrl: url }) });
    },
  });
}

export interface SandboxOrderDeps {
  readonly http: ProdigiHttpPort;
  readonly secrets: ServerSecretSource;
  /** Required for anything to be sent; defaults to the fail-closed verifier. */
  readonly decisionVerifier?: SandboxDecisionVerifier;
  /** Must be exactly true, set by the owner-approved caller. Defaults off, so nothing is sent. */
  readonly sandboxCallsEnabled?: boolean;
  /** The callback host, when the route is enabled. */
  readonly callbacks: ProdigiHost | null;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface SandboxOrderResult {
  readonly observation: ProdigiOrderObservation;
  readonly callbackUrlSent: boolean;
  /** "now": tracked before returning. "queued": trackOrder failed and a durable track job owns it. "off": callbacks off. */
  readonly tracking: "now" | "queued" | "off";
}

export async function createSandboxOrder(deps: SandboxOrderDeps, input: ProdigiOrderCreateInput, signal?: AbortSignal): Promise<SandboxOrderResult> {
  const env = deps.env ?? process.env;
  const enabled = callbacksEnabled(env) && deps.callbacks !== null;
  const url = enabled ? callbackUrl(env) : null; // throws before anything is sent
  const client = new ProdigiSandboxClient({
    http: url ? withCallbackUrl(deps.http, url) : deps.http,
    secrets: deps.secrets,
    decision: PRODIGI_SANDBOX_DECISION,
    decisionVerifier: deps.decisionVerifier ?? UNVERIFIED_DECISION,
    sandboxCallsEnabled: deps.sandboxCallsEnabled === true,
  });
  const observation = await client.createOrder(input, signal);
  if (!enabled || !deps.callbacks) return { observation, callbackUrlSent: false, tracking: "off" };
  try {
    await deps.callbacks.reconciler.trackOrder(observation.orderId);
    return { observation, callbackUrlSent: true, tracking: "now" };
  } catch {
    deps.callbacks.queue.enqueue("track", observation.orderId, {});
    console.warn(`[prodigi] trackOrder failed for ${observation.orderId}; queued a track job`);
    return { observation, callbackUrlSent: true, tracking: "queued" };
  }
}
