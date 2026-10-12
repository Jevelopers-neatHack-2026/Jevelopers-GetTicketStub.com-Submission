import { getSession } from "@/server/auth";
import { json, route } from "@/server/http";
import { storageAvailable } from "@/server/index";

export const GET = route(async (req: Request) => {
  const account = await getSession(req);
  // 200 even with storage off: the page asks on every load, and "saving is off" is an answer, not an error.
  return json({ account: account ? { id: account.id, email: account.email } : null, storage: storageAvailable() ? "ok" : "unavailable" });
});
