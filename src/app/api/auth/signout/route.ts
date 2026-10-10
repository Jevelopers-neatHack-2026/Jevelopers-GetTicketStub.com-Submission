import { clearedCookie, endSession } from "@/server/auth";
import { checkOrigin, json, route } from "@/server/http";

export const POST = route(async (req: Request) => {
  checkOrigin(req);
  await endSession(req);
  return json({ ok: true }, { headers: { "set-cookie": clearedCookie() } });
});
