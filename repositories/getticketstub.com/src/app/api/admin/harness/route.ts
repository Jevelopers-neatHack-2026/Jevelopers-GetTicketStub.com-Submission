import { getRequestContext, requireCapability } from "@/server/context";
import { drainHarnessExport, harnessExportStatus } from "@/server/harness-export";
import { checkOrigin, json, limit, route } from "@/server/http";

// Staff only (admin.view, from ADMIN_EMAILS); anyone else gets the same 404 as a path that isn't there.
// GET: whether the agent-harness hand-off is on, its outbox counts (queued, sent and awaiting readback, verified,
// failed) and the newest trace ids with their status codes. Never event content, settings values or keys.
// POST: runs one delivery and readback pass now instead of waiting for the background drain.

export const GET = route(async (req: Request) => {
  requireCapability(await getRequestContext(req), "admin.view");
  return json({ harness: harnessExportStatus() });
});

export const POST = route(async (req: Request) => {
  checkOrigin(req);
  const ctx = await getRequestContext(req);
  requireCapability(ctx, "admin.view");
  limit(`harness-drain:${ctx.actor.kind === "account" ? ctx.actor.id : "x"}`, 20, 60 * 60_000);
  const drain = await drainHarnessExport();
  return json({ drain, harness: harnessExportStatus() });
});
