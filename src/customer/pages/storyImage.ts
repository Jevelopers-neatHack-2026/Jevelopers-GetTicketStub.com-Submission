"use client";
// Renders the 9:16 story share image on a canvas: stub art, title, details and the wordmark.
import { currentVersion, type Stub } from "@/customer/studio/types";
import { formatDate } from "./share";

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines.slice(0, 3);
}

export async function renderStoryPng(stub: Stub): Promise<Blob | null> {
  const W = 1080;
  const H = 1920;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  // Night stage background with a soft orange glow.
  ctx.fillStyle = "#17140F";
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H * 0.42, W);
  glow.addColorStop(0, "rgba(228,87,46,0.35)");
  glow.addColorStop(1, "rgba(23,20,15,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // The stub card.
  const cw = 620;
  const ch = 1100;
  const cx = (W - cw) / 2;
  const cy = 260;
  ctx.save();
  ctx.translate(W / 2, cy + ch / 2);
  ctx.rotate((-2 * Math.PI) / 180);
  ctx.translate(-W / 2, -(cy + ch / 2));
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 60;
  ctx.shadowOffsetY = 30;
  roundRect(ctx, cx, cy, cw, ch, 10);
  ctx.fillStyle = "#F4ECDD";
  ctx.fill();
  ctx.shadowColor = "transparent";

  const art = currentVersion(stub)?.art;
  const img = art?.kind === "image" && art.src ? await loadImage(art.src) : null;
  const ax = cx + 28;
  const ay = cy + 28;
  const aw = cw - 56;
  const ah = 640;
  ctx.save();
  roundRect(ctx, ax, ay, aw, ah, 4);
  ctx.clip();
  if (img) {
    const scale = Math.max(aw / img.width, ah / img.height);
    const iw = img.width * scale;
    const ih = img.height * scale;
    ctx.drawImage(img, ax + (aw - iw) / 2, ay + (ah - ih) / 2, iw, ih);
  } else {
    const g = ctx.createLinearGradient(ax, ay, ax + aw, ay + ah);
    g.addColorStop(0, "#B4693E");
    g.addColorStop(0.45, "#E4572E");
    g.addColorStop(1, "#7CC6D2");
    ctx.fillStyle = g;
    ctx.fillRect(ax, ay, aw, ah);
  }
  ctx.restore();

  ctx.fillStyle = "#17140F";
  ctx.font = "600 64px Fraunces, Georgia, serif";
  let ty = ay + ah + 90;
  for (const line of wrap(ctx, stub.event.title, aw)) {
    ctx.fillText(line, ax, ty);
    ty += 72;
  }
  ctx.font = "500 32px 'Inter Tight', system-ui, sans-serif";
  ctx.fillStyle = "rgba(23,20,15,0.7)";
  const meta = [formatDate(stub.event.dateISO), stub.event.venue, stub.event.city].filter(Boolean).join(" · ");
  if (meta) ctx.fillText(meta, ax, ty + 6);

  // Perforation.
  ctx.fillStyle = "#17140F";
  for (let x = cx + 20; x < cx + cw - 10; x += 26) {
    ctx.beginPath();
    ctx.arc(x, cy + ch - 120, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = "600 26px 'Inter Tight', system-ui, sans-serif";
  ctx.fillText("ADMIT ONE MEMORY", ax, cy + ch - 56);
  ctx.restore();

  // Wordmark and link line.
  const mark = await loadImage("/brand/wordmark-cream.svg");
  if (mark) {
    const mw = 360;
    const mh = (mark.height / mark.width) * mw || 80;
    ctx.drawImage(mark, (W - mw) / 2, H - 300, mw, mh);
  } else {
    ctx.fillStyle = "#F4ECDD";
    ctx.font = "600 64px Fraunces, Georgia, serif";
    ctx.textAlign = "center";
    ctx.fillText("TicketStub", W / 2, H - 240);
  }
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(244,236,221,0.75)";
  ctx.font = "500 32px 'Inter Tight', system-ui, sans-serif";
  ctx.fillText("Made with TicketStub · getticketstub.com", W / 2, H - 150);

  return new Promise((resolve) => {
    try {
      canvas.toBlob((b) => resolve(b), "image/png");
    } catch {
      resolve(null); // tainted canvas
    }
  });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Downscale a photo before it goes into local storage (keeps the wall under the quota). */
export function photoToDataUrl(file: File, max = 1200): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve(null);
    reader.onload = async () => {
      const img = await loadImage(String(reader.result));
      if (!img) return resolve(null);
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      const ctx = c.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL("image/jpeg", 0.8));
    };
    reader.readAsDataURL(file);
  });
}
