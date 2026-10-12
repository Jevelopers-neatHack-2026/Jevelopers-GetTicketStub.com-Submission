// Diagnostic evidence only. The caller owns the original screenshot and comparison result.
// No helper here decodes an image, draws a canvas, changes the DOM, or retries an assertion.
import { createHash } from "node:crypto";

const OFFSETS_MS = [100, 500];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clock = () => performance.now();
const elapsed = (start, now) => Math.round((now - start) * 100) / 100;

async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("capture diagnostic unavailable")), 2000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

export async function browserProvenance(conn) {
  try {
    const version = await bounded(conn.send("Browser.getVersion"));
    const formats = { protocolVersion: /^\d+\.\d+$/, product: /^(HeadlessChrome|Chrome|Chromium|Edg)\/\d+(\.\d+){1,4}$/,
      revision: /^@?[a-f\d]{7,64}$/i, jsVersion: /^\d+(\.\d+){1,5}$/ };
    const fields = Object.fromEntries(Object.entries(formats).map(([key, format]) => [key,
      typeof version[key] === "string" && version[key].length <= 128 && format.test(version[key]) ? version[key] : "omitted_unrecognized_format"]));
    // A custom user agent may contain private text. Keep only its bounded digest, never the raw value.
    const userAgent = typeof version.userAgent === "string" && version.userAgent.length <= 4096
      ? { status: "hashed", sha256: createHash("sha256").update(version.userAgent).digest("hex") } : { status: "omitted" };
    return { status: "recorded", method: "Browser.getVersion", ...fields, userAgent };
  } catch {
    return { status: "unavailable", method: "Browser.getVersion" };
  }
}

// This function is serialized into an ALREADY EXISTING page eval. Before the first screenshot,
// sample() reads only bounded identity/source/readiness properties: no style/layout reads or awaits.
function installCaptureProvenance() {
  const MAX_IMAGES = 8, MAX_SNAPSHOTS = 6, MAX_SOURCE_CHARS = 65536, MAX_ANCESTORS = 6;
  const nodes = new WeakMap();
  const snapshots = [];
  let nextId = 1;
  let snapshotsOmitted = 0;
  const id = (node) => {
    if (!node) return null;
    if (!nodes.has(node)) nodes.set(node, nextId++);
    return nodes.get(node);
  };
  const finite = (n) => Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  const rect = (node) => {
    const r = node.getBoundingClientRect();
    return Object.fromEntries(["x", "y", "width", "height"].map((key) => [key, finite(r[key])]));
  };
  // No arbitrary CSS text, URLs, class names, element IDs, animation names or text content.
  const styles = (node) => {
    const s = getComputedStyle(node);
    const choice = (value, allowed) => allowed.includes(value) ? value : "other";
    const matrix = /^(none|matrix(3d)?\([-+\d., eE]+\))$/;
    return {
      display: choice(s.display, ["none", "block", "inline", "inline-block", "flex", "grid", "contents"]),
      visibility: choice(s.visibility, ["visible", "hidden", "collapse"]),
      opacity: finite(Number(s.opacity)),
      transform: matrix.test(s.transform) && s.transform.length <= 512 ? s.transform : "other",
      transformStyle: choice(s.transformStyle, ["flat", "preserve-3d"]),
      perspective: s.perspective === "none" ? "none" : finite(Number.parseFloat(s.perspective)),
      backfaceVisibility: choice(s.backfaceVisibility, ["visible", "hidden"]),
      hasFilter: s.filter !== "none", hasMask: s.maskImage !== "none", hasClipPath: s.clipPath !== "none",
      contentVisibility: choice(s.contentVisibility, ["visible", "hidden", "auto"]),
      objectFit: choice(s.objectFit, ["fill", "contain", "cover", "none", "scale-down"]),
      animationCount: node.getAnimations().length,
      animations: node.getAnimations().slice(0, 4).map((a) => ({
        playState: choice(a.playState, ["idle", "running", "paused", "finished"]),
        currentTime: finite(a.currentTime),
      })),
    };
  };
  const source = async (value) => {
    const chars = value.length;
    if (chars > MAX_SOURCE_CHARS) return { status: "omitted_too_long", chars };
    try {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
      return { status: "hashed", chars, sha256: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("") };
    } catch {
      return { status: "digest_unavailable", chars };
    }
  };
  const retainSource = (value) => {
    const raw = String(value ?? "");
    return raw.length > MAX_SOURCE_CHARS ? { status: "omitted_too_long", chars: raw.length } : { status: "pending_digest", raw };
  };
  const collector = {
    sample(phase, figure, images, afterCapture = false) {
      if (snapshots.length >= MAX_SNAPSHOTS) { snapshotsOmitted++; return; }
      const snapshot = { phase, at: finite(performance.now()), figureId: id(figure), imageCount: images.length, imagesTruncated: images.length > MAX_IMAGES };
      snapshots.push(snapshot);
      try {
        snapshot.status = figure ? "recorded" : "figure_unavailable";
        snapshot.fonts = document.fonts.status === "loaded" ? "loaded" : "loading";
        snapshot.visibility = ["visible", "hidden"].includes(document.visibilityState) ? document.visibilityState : "other";
        snapshot.images = images.slice(0, MAX_IMAGES).map((img) => {
          const image = { nodeId: id(img), connected: img.isConnected === true, complete: img.complete === true,
            naturalWidth: finite(img.naturalWidth), naturalHeight: finite(img.naturalHeight),
            src: retainSource(img.src), currentSrc: retainSource(img.currentSrc) };
          if (afterCapture) {
            image.rect = rect(img);
            image.styles = styles(img);
            image.ancestors = [];
            for (let p = img.parentElement, n = 0; p && n < MAX_ANCESTORS; p = p.parentElement, n += 1) {
              image.ancestors.push({ nodeId: id(p), rect: rect(p), styles: styles(p) });
              if (p === figure) break;
            }
          }
          return image;
        });
        if (afterCapture && figure) snapshot.figureRect = rect(figure);
      } catch {
        snapshot.status = "unavailable";
      }
    },
    async read() {
      // Hash after the original screenshot. Raw sources never cross the CDP return boundary.
      for (const snapshot of snapshots) for (const image of snapshot.images ?? []) {
        for (const key of ["src", "currentSrc"]) if (image[key].status === "pending_digest") {
          const held = image[key];
          image[key] = await source(held.raw);
          delete held.raw;
        }
      }
      return { status: "recorded", schema: "ticketstub.capture-provenance.v1", timeOrigin: finite(performance.timeOrigin),
        limits: { images: MAX_IMAGES, snapshots: MAX_SNAPSHOTS, sourceCharacters: MAX_SOURCE_CHARS, ancestors: MAX_ANCESTORS },
        sampledStylesOnlyAfterCapture: true, instrumentationMayAffectLaterScheduling: true,
        snapshotsTruncated: snapshotsOmitted > 0, snapshotsOmitted, snapshots };
    },
  };
  window.__ticketstubCaptureProvenance = collector;
  return collector;
}

export const BEGIN_CAPTURE_PROVENANCE = `(${installCaptureProvenance.toString()})()`;

export async function readCaptureProvenance(page, figure, phase = "after_original_capture") {
  try {
    return await bounded(page.eval(`(async () => {
      const collector = window.__ticketstubCaptureProvenance;
      if (!collector) return { status: "unavailable" };
      const f = ${figure};
      collector.sample(${JSON.stringify(phase)}, f, f ? [...f.querySelectorAll("img")] : [], true);
      return await collector.read();
    })()`));
  } catch {
    // Diagnostic errors must not expose exception text (which can contain source URLs) or replace a required result.
    return { status: "unavailable" };
  }
}

export async function captureFailureFrames({ matched, page, figure, clip, originalCapturedAt, save, now = clock, wait = sleep }) {
  if (matched) return null;
  const failedAt = now();
  const evidence = { originalComparison: "failed", authoritativeFrame: "original", offsetOrigin: "failed_comparison_completed",
    instrumentationMayAffectLaterScheduling: true, frames: [] };
  // Exactly two diagnostic attempts. Never examine later pixels, retry until they match, or return a replacement image.
  for (const offsetMs of OFFSETS_MS) {
    await wait(Math.max(0, failedAt + offsetMs - now()));
    const frame = { requestedOffsetMs: offsetMs, startedAfterFailureMs: elapsed(failedAt, now()), startedAfterOriginalMs: elapsed(originalCapturedAt, now()) };
    evidence.frames.push(frame);
    try {
      const { data } = await bounded(page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, clip }));
      const png = Buffer.from(data, "base64");
      frame.completedAfterFailureMs = elapsed(failedAt, now());
      frame.sha256 = createHash("sha256").update(png).digest("hex");
      frame.file = await bounded(Promise.resolve().then(() => save(offsetMs, png)));
      frame.provenance = await readCaptureProvenance(page, figure, `after_diagnostic_${offsetMs}ms`);
      frame.status = "recorded";
    } catch {
      frame.status = "unavailable";
    }
  }
  return evidence;
}
