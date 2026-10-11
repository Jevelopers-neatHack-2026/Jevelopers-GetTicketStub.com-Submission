import { getRequestContext, requireCapability } from "@/server/context";
import { json, notFound, route } from "@/server/http";
import { getStorage } from "@/server/index";
import { publicStub } from "@/server/project";
import { parseToken } from "@/server/validate";

export const GET = route(async (req: Request, ctx: { params: Promise<{ token: string }> }) => {
  requireCapability(await getRequestContext(req), "wall.public.view");
  const { token } = await ctx.params;
  const stubs = await getStorage().getPublicWall(parseToken(token));
  if (!stubs) throw notFound();
  // The public wall shows what is pinned to it; drafts that were never torn stay private.
  return json({ stubs: stubs.filter((s) => s.torn === true).map(publicStub) });
});
