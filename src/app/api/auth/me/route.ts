import { getSession } from "@/server/auth";
import { json, route } from "@/server/http";

export const GET = route(async (req: Request) => {
  const account = await getSession(req);
  return json({ account: account ? { id: account.id, email: account.email } : null });
});
