import { route } from "@/server/http";

// Old email-change links land here. They only point the browser at the confirm page: GET never uses a link up.
export const GET = route(async (req: Request) => {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  return new Response(null, {
    status: 303,
    headers: { location: `/signin/confirm?token=${encodeURIComponent(token.slice(0, 200))}`, "cache-control": "no-store" },
  });
});
