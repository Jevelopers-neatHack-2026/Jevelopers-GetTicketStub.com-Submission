import pkg from "../../../../package.json";
import { json, route } from "@/server/http";

/** Deploy-time revision, from the first variable the platform sets; the package version is the fallback. */
const REVISION = [process.env.GIT_SHA, process.env.GITHUB_SHA, process.env.VERCEL_GIT_COMMIT_SHA, process.env.SOURCE_VERSION]
  .map((v) => v?.trim())
  .find((v) => v && /^[0-9a-f]{7,40}$/i.test(v));

/** Liveness for the platform and for verify:product. Nothing here reads the database, a key or a header. */
export const GET = route(async () =>
  json({
    ok: true,
    version: REVISION ?? pkg.version,
    mode: process.env.TICKETSTUB_RUNTIME_MODE === "live" ? "live" : "demo",
    time: new Date().toISOString(),
  }),
);
