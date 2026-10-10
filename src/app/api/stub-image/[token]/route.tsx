import { ImageResponse } from "next/og";
import { currentVersion, type Stub } from "@/customer/studio/types";
import { readStoredFile } from "@/server/files";
import { getStorage } from "@/server/index";
import { parseToken } from "@/server/validate";
import { notFound, route } from "@/server/http";

// A picture of a stub for email, which can't run our React stub. Rendered from the stored share snapshot,
// so it only ever shows something its owner already shared. "brand" is the generic card.
const W = 960;
const H = 400;
const CREAM = "#F4ECDD";
const INK = "#17140F";
const ORANGE = "#E4572E";
const COPPER = "#B4693E";
const MUTED = "#625D55";

const clip = (s: string | undefined, n: number) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : (s ?? ""));

/** Our own stored art, read from disk and inlined. Never a fetch, so a stored URL can't point this server anywhere. */
function artSrc(stub: Stub | null): string | undefined {
  const src = stub ? currentVersion(stub)?.art?.src : undefined;
  const m = src ? /^\/api\/files\/([a-f0-9]{64}\.(?:png|jpg))$/.exec(src) : null;
  const file = m ? readStoredFile(m[1]) : null;
  if (file && file.bytes.length < 6 * 1024 * 1024) return `data:${file.type};base64,${file.bytes.toString("base64")}`;
  // Art that is still embedded (a snapshot from before files existed).
  return src && /^data:image\/(png|jpe?g);base64,/.test(src) && src.length < 1_500_000 ? src : undefined;
}

function card(stub: Stub | null, withArt: boolean) {
  const title = clip(stub?.event.title, 44) || "Your stub";
  const sub = clip([stub?.event.venue, stub?.event.city].filter(Boolean).join(" · "), 60);
  const date = stub?.event.dateISO ?? "";
  const guest = stub?.personal.guestName ? `Admit · ${clip(stub.personal.guestName, 30)}` : "";
  const src = withArt ? artSrc(stub) : undefined;
  return (
    <div style={{ width: W, height: H, display: "flex", background: CREAM, border: `4px dashed ${COPPER}`, boxSizing: "border-box" }}>
      <div style={{ width: 300, height: "100%", display: "flex", background: `linear-gradient(135deg, ${COPPER} 0%, ${ORANGE} 60%, #7CC6D2 100%)` }}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
          <img src={src} width={300} height={H - 8} style={{ objectFit: "cover" }} />
        ) : null}
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "40px 44px", color: INK }}>
        <div style={{ display: "flex", fontSize: 22, letterSpacing: 6, color: ORANGE, fontWeight: 700 }}>TICKETSTUB</div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 58, lineHeight: 1.05, fontWeight: 700 }}>{title}</div>
          {sub ? <div style={{ display: "flex", fontSize: 28, marginTop: 14, color: MUTED }}>{sub}</div> : null}
          {date ? <div style={{ display: "flex", fontSize: 28, marginTop: 6, color: MUTED }}>{date}</div> : null}
        </div>
        <div style={{ display: "flex", fontSize: 24, color: MUTED }}>{guest || (stub ? "Kept on your wall" : "Turn your ticket into a stub worth keeping.")}</div>
      </div>
    </div>
  );
}

const headers = { "cache-control": "public, max-age=3600, s-maxage=3600" };

export const GET = route(async (_req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const token = (await ctx.params).token;
  const stub = token === "brand" ? null : await getStorage().getShare(parseToken(token));
  if (token !== "brand" && !stub) throw notFound();
  try {
    return new ImageResponse(card(stub, true), { width: W, height: H, headers });
  } catch {
    // A remote art image that won't load shouldn't cost the email its picture.
    return new ImageResponse(card(stub, false), { width: W, height: H, headers });
  }
});
