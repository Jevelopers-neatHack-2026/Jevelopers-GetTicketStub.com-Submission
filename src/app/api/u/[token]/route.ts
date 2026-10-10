import { json, notFound, route } from "@/server/http";
import { getStorage } from "@/server/index";
import { parseToken } from "@/server/validate";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  const stubs = await getStorage().getPublicWall(parseToken(token));
  if (!stubs) throw notFound();
  // The public wall shows what is pinned to it; drafts that were never torn stay private.
  return json({ stubs: stubs.filter((s) => s.torn === true) });
});
