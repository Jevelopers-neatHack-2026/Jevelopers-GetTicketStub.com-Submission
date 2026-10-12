import "server-only";
import { randomBytes } from "node:crypto";
import { APPROVAL_TTL_MS } from "./approval-token";
import { isLiveRuntime } from "./context";
import { HttpError } from "./http";
import { loadKeyring, type Keyring, type KeysetProblem } from "./keyring";

// The environment bindings for the versioned token key sets (integration-evals decision 0003, row K4). Each token class
// has its own key set, so one leaked secret can mint only one class:
//   APPROVAL_SIGNING_KEYS  artwork approvals (ticketstub.approval/1, 7-day tokens)
// CONTEXT_SECRET stays a single key, for five-minute context tokens only (context.ts). The format and the rules are in
// keyring.ts and docs/architecture/identity.md "Signing keys".

export const APPROVAL_KEYS_ENV = "APPROVAL_SIGNING_KEYS";

const g = globalThis as unknown as { __ticketstubKeyringFallback?: Map<string, Buffer>; __ticketstubKeyringWarned?: Set<string> };

/** Outside live mode, an unset key set signs with a random key that lives as long as the process (tokens die on restart). */
function fallbackKey(name: string): Buffer {
  const m = (g.__ticketstubKeyringFallback ??= new Map());
  let k = m.get(name);
  if (!k) m.set(name, (k = randomBytes(32)));
  return k;
}

/** Once per process and problem: the variable name and a fixed code, never a value. */
function warn(name: string, problem: KeysetProblem) {
  const seen = (g.__ticketstubKeyringWarned ??= new Set());
  if (seen.has(`${name}:${problem}`)) return;
  seen.add(`${name}:${problem}`);
  console.error(`[signing-keys] ${name} unavailable: ${problem}`);
}

/** CONTEXT_SECRET's bytes as context.ts keys its HMAC, so a key set entry that reuses it is refused. */
function contextSecretBytes(): Buffer[] {
  const s = process.env.CONTEXT_SECRET?.trim();
  return s ? [Buffer.from(s)] : [];
}

function keyringFor(name: string, retentionMs: number, forbidden: Buffer[]): Keyring | null {
  const r = loadKeyring({ name, raw: process.env[name], live: isLiveRuntime(), retentionMs, forbidden, fallback: () => fallbackKey(name) });
  if (r.ok) return r.keyring;
  warn(name, r.problem);
  return null;
}

/** The approval keyring, or null when it is unset in live mode or invalid in any mode (then nothing verifies). */
export function approvalKeyring(): Keyring | null {
  return keyringFor(APPROVAL_KEYS_ENV, APPROVAL_TTL_MS, contextSecretBytes());
}

/** The approval keyring for issuing. Throws 503 signing_unavailable when there is none, before anything is written. */
export function requireApprovalKeyring(): Keyring {
  const k = approvalKeyring();
  if (!k) throw new HttpError(503, "signing_unavailable", "Approvals aren't set up on this server yet.");
  return k;
}
