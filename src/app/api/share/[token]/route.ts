import { getRequestContext, requireCapability } from "@/server/context";
import { json, notFound, route } from "@/server/http";
import { getStorage, requireStorage } from "@/server/index";
import { publicStub } from "@/server/project";
import { parseToken } from "@/server/validate";

export const GET = route(async (req: Request, ctx: { params: Promise<{ token: string }> }) => {
  requireStorage();
  requireCapability(await getRequestContext(req), "share.view");
  const { token } = await ctx.params;
  const stub = await getStorage().getShare(parseToken(token));
  if (!stub) throw notFound();
  return json({ stub: publicStub(stub) }); // projected again on the way out: older rows were stored whole
});
