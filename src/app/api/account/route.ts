import { clearedCookie } from "@/server/auth";
import { accountOf, getRequestContext, requireCapability } from "@/server/context";
import { safeEqual } from "@/server/crypto";
import { HttpError, checkOrigin, isObject, json, readJson, route } from "@/server/http";
import { removeStoredFiles } from "@/server/files";
import { getStorage } from "@/server/index";

// Deleting is permanent, so the caller must type the account's own email back.
export const DELETE = route(async (req: Request) => {
  checkOrigin(req);
  const ctx = await getRequestContext(req);
  requireCapability(ctx, "account.delete");
  const account = await accountOf(ctx);
  const body = await readJson(req, 1024);
  const confirm = isObject(body) && typeof body.confirm === "string" ? body.confirm.trim().toLowerCase() : "";
  if (!confirm || !safeEqual(confirm, account.email)) throw new HttpError(400, "confirm_mismatch", "Type your email exactly to delete your account.");
  const orphaned = await getStorage().deleteAccount(account.id, account.email);
  removeStoredFiles(orphaned); // art nothing else references; files shared by hash with other stubs stay
  return json({ ok: true }, { headers: { "set-cookie": clearedCookie() } });
});
