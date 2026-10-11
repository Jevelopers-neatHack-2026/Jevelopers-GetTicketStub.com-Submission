import { getRequestContext, issueContextToken } from "@/server/context";
import { json, notFound, route } from "@/server/http";

// The caller's own context, plus a signed five-minute token for a downstream consumer. `?project=stub:<id>` or
// `event:<id>` asks for the context on one project. The id is only a question: a project the caller can't see
// is a 404 whether it exists or not.
export const GET = route(async (req: Request) => {
  const raw = new URL(req.url).searchParams.get("project");
  let project: { id: string; kind: "stub" | "event" } | undefined;
  if (raw !== null) {
    const m = /^(stub|event):([\w.:-]{1,128})$/.exec(raw);
    if (!m) throw notFound();
    project = { kind: m[1] as "stub" | "event", id: m[2] };
  }
  const context = await getRequestContext(req, project);
  if (project && context.role === "none") throw notFound();
  return json({ context, token: context.revoked ? null : issueContextToken(context) });
});
