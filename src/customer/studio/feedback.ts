"use client";
// Sound + haptic feedback for the studio.
// NOTE: every sound here is a SYNTHESIZED PLACEHOLDER (WebAudio noise bursts and oscillators).
// Replace them with the licensed cuelume.dev assets (https://cuelume.dev/) per brand-kit
// docs/motion-sound-haptics.md. Keep the same Cue names so call sites do not change.
//
// Rules: sound is ON by default; the muted flag persists in localStorage (guarded). The
// AudioContext is created lazily and only during a user activation, so nothing throws or
// queues before the first gesture. Mix stays quiet (master gain well below full scale).
import { useCallback, useSyncExternalStore } from "react";

export type Cue = "drop" | "print" | "done" | "flick" | "tick" | "flip" | "tear" | "pin" | "stamp";

const MUTE_KEY = "ticketstub.muted";
const MASTER = 0.42;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
let printNodes: { stop: (t: number) => void; gain: GainNode } | null = null;

// ---------- muted state ----------
let muted: boolean = (() => {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
})();
const listeners = new Set<() => void>();

function setMutedState(m: boolean) {
  muted = m;
  try {
    window.localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {
    /* storage unavailable */
  }
  if (m) stopPrint();
  listeners.forEach((l) => l());
}

export function isMuted(): boolean {
  return muted;
}

export function useMuted(): [boolean, (m: boolean) => void] {
  const value = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => muted,
    () => false,
  );
  const set = useCallback((m: boolean) => setMutedState(m), []);
  return [value, set];
}

// ---------- audio graph ----------
function userActive(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean; hasBeenActive: boolean } }).userActivation;
  return ua ? ua.isActive || ua.hasBeenActive : true;
}

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (ctx) return ctx;
  if (!userActive()) return null; // never create before a gesture
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = MASTER;
  // gentle glue so stacked cues never clip
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  const len = Math.floor(ctx.sampleRate * 1.2);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

function noise(c: AudioContext, t: number, dur: number): AudioBufferSourceNode {
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  src.start(t, Math.random() * 0.8);
  src.stop(t + dur + 0.05);
  return src;
}

function env(c: AudioContext, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  return g;
}

function filter(c: AudioContext, type: BiquadFilterType, freq: number, q = 0.8): BiquadFilterNode {
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function tone(c: AudioContext, t: number, type: OscillatorType, f0: number, f1: number, dur: number, peak: number) {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
  const g = env(c, t, peak, 0.004, dur);
  o.connect(g).connect(master!);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function burst(c: AudioContext, t: number, opts: { type: BiquadFilterType; f0: number; f1?: number; q?: number; peak: number; attack: number; decay: number }) {
  const dur = opts.attack + opts.decay;
  const src = noise(c, t, dur);
  const f = filter(c, opts.type, opts.f0, opts.q);
  if (opts.f1) f.frequency.exponentialRampToValueAtTime(opts.f1, t + dur);
  const g = env(c, t, opts.peak, opts.attack, opts.decay);
  src.connect(f).connect(g).connect(master!);
}

function render(c: AudioContext, cue: Cue) {
  const t = c.currentTime + 0.005;
  switch (cue) {
    case "drop": // soft paper slide
      burst(c, t, { type: "bandpass", f0: 3200, f1: 900, q: 0.7, peak: 0.35, attack: 0.03, decay: 0.2 });
      break;
    case "done": // crisp paper snap
      burst(c, t, { type: "highpass", f0: 2200, q: 0.5, peak: 0.7, attack: 0.002, decay: 0.06 });
      burst(c, t + 0.012, { type: "bandpass", f0: 1200, q: 1.2, peak: 0.25, attack: 0.002, decay: 0.09 });
      break;
    case "flick": // card flick
      burst(c, t, { type: "highpass", f0: 3000, q: 0.6, peak: 0.4, attack: 0.002, decay: 0.035 });
      burst(c, t + 0.04, { type: "bandpass", f0: 1800, q: 1, peak: 0.15, attack: 0.004, decay: 0.05 });
      break;
    case "tick": // very soft tick
      burst(c, t, { type: "bandpass", f0: 4200, q: 2, peak: 0.16, attack: 0.001, decay: 0.018 });
      break;
    case "flip": // paper turn
      burst(c, t, { type: "bandpass", f0: 600, f1: 2600, q: 0.9, peak: 0.28, attack: 0.08, decay: 0.16 });
      break;
    case "tear": {
      // granular rip: a train of tiny noise grains, then the release
      const grains = 22;
      for (let i = 0; i < grains; i++) {
        const gt = t + i * 0.014 + Math.random() * 0.006;
        burst(c, gt, { type: "bandpass", f0: 1800 + Math.random() * 2200, q: 1.4, peak: 0.18 + Math.random() * 0.22, attack: 0.001, decay: 0.012 });
      }
      burst(c, t + grains * 0.014, { type: "highpass", f0: 1600, q: 0.6, peak: 0.45, attack: 0.002, decay: 0.08 });
      break;
    }
    case "pin": // pin thunk
      tone(c, t, "sine", 140, 55, 0.14, 0.5);
      burst(c, t, { type: "lowpass", f0: 900, q: 0.7, peak: 0.25, attack: 0.002, decay: 0.05 });
      break;
    case "stamp": // rubber stamp
      tone(c, t, "sine", 95, 48, 0.16, 0.55);
      burst(c, t, { type: "lowpass", f0: 500, q: 0.9, peak: 0.4, attack: 0.003, decay: 0.12 });
      burst(c, t + 0.09, { type: "bandpass", f0: 2400, q: 1.5, peak: 0.08, attack: 0.002, decay: 0.04 });
      break;
    case "print":
      startPrint(c);
      break;
  }
}

function startPrint(c: AudioContext) {
  if (printNodes) return;
  const t = c.currentTime;
  const gain = c.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.22, t + 0.25);
  gain.connect(master!);

  // low motor hum
  const motor = c.createOscillator();
  motor.type = "sawtooth";
  motor.frequency.value = 58;
  const motorF = filter(c, "lowpass", 240, 0.7);
  const motorG = c.createGain();
  motorG.gain.value = 0.35;
  motor.connect(motorF).connect(motorG).connect(gain);

  // thermal head chatter: band noise gated by a fast LFO
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const bf = filter(c, "bandpass", 1400, 1.1);
  const chatter = c.createGain();
  chatter.gain.value = 0.18;
  const lfo = c.createOscillator();
  lfo.frequency.value = 22;
  const lfoDepth = c.createGain();
  lfoDepth.gain.value = 0.14;
  lfo.connect(lfoDepth).connect(chatter.gain);
  src.connect(bf).connect(chatter).connect(gain);

  motor.start(t);
  src.start(t);
  lfo.start(t);
  printNodes = {
    gain,
    stop: (at: number) => {
      try {
        motor.stop(at);
        src.stop(at);
        lfo.stop(at);
      } catch {
        /* already stopped */
      }
    },
  };
}

/** Fade the printer whirr out (no-op when not printing). */
export function stopPrint(): void {
  try {
    if (!ctx || !printNodes) return;
    const t = ctx.currentTime;
    const { gain, stop } = printNodes;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(Math.max(gain.gain.value, 0.0001), t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    stop(t + 0.4);
    printNodes = null;
  } catch {
    printNodes = null;
  }
}

/** Play a cue. Safe to call anywhere, any time: silently does nothing before a gesture or when muted. */
export function play(cue: Cue): void {
  if (muted || typeof window === "undefined") return;
  try {
    const c = getCtx();
    if (!c) return;
    if (c.state === "running") {
      render(c, cue);
      return;
    }
    if (!userActive()) return;
    c.resume()
      .then(() => {
        if (!muted && c.state === "running") render(c, cue);
      })
      .catch(() => {});
  } catch {
    /* audio unavailable */
  }
}

/** navigator.vibrate where supported (Android). iOS Safari has none; the sound carries the feedback. */
export function haptic(pattern: number | number[]): void {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") navigator.vibrate(pattern);
  } catch {
    /* not allowed (no gesture yet) */
  }
}
