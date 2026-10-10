import { json, notFound, route } from "@/server/http";
import { getStorage } from "@/server/index";
import { parseToken } from "@/server/validate";

export const GET = route(async (_req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  const stub = await getStorage().getShare(parseToken(token));
  if (!stub) throw notFound();
  return json({ stub });
});
