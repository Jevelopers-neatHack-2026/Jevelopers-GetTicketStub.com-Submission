import { readStoredFile } from "@/server/files";
import { notFound, route } from "@/server/http";

// Art files by content hash. The name is checked against a strict pattern before it touches the disk,
// so there is no path to traverse. The bytes under a hash never change, hence the immutable cache.
export const GET = route(async (_req: Request, ctx: { params: Promise<{ name: string }> }) => {
  const file = readStoredFile((await ctx.params).name);
  if (!file) throw notFound();
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "content-type": file.type,
      "content-length": String(file.bytes.length),
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
});
