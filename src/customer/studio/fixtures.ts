import type { EventData, Stub } from "./types";

// Demo fixtures. Fictional band and teams; neatHack is the real demo event, facts marked pending where unknown.

export const PALE_HOURS: EventData = {
  type: "concert",
  title: "The Pale Hours",
  subtitle: "Night 2 of 3",
  venue: "Rosewood Hall",
  city: "Glasgow",
  dateISO: "2024-10-12",
  seat: "Sec 104 · Row G · Seat 9",
  setlist: [
    { title: "Lamplight" },
    { title: "Kelvin Way" },
    { title: "Rain on Sauchiehall", starred: true },
    { title: "Second Night" },
    { title: "Low Tide Choir" },
    { title: "Encore: Northern Lines" },
  ],
  facts: [
    { id: "run", label: "Night 2 of 3", value: "Night 2 of 3", source: "setlist.fm", confidence: 0.95, provenance: "simulated", kept: true },
    { id: "weather", label: "7°C · rain", value: "7°C, light rain", source: "Open-Meteo", confidence: 0.9, provenance: "simulated", kept: true },
    { id: "opener", label: "Opener: Velvet Coast", value: "Velvet Coast", source: "setlist.fm", confidence: 0.85, provenance: "simulated" },
    { id: "date", label: "12 Oct", value: "2024-10-12", source: "ticket", confidence: 0.62, alternatives: ["2024-10-12", "2024-10-11", "2024-10-13"], provenance: "simulated" },
  ],
};

export const NEATHACK: EventData = {
  type: "generic",
  title: "neatHack 2026",
  subtitle: "48-hour hackathon",
  city: "Online",
  dateISO: "2026-10-10",
  programme: ["Kickoff · 10 Oct, 12:30 IST", "Build · 48 hours", "Submissions close · 12 Oct, 23:55 IST"],
  facts: [
    { id: "teams", label: "Teams: pending", value: "pending", source: "event page", confidence: 0.4, provenance: "pending" },
    { id: "window", label: "48 hours", value: "10–12 Oct 2026", source: "event page", confidence: 0.95, provenance: "live", kept: true },
    { id: "winners", label: "Winners: pending", value: "pending", source: "event page", confidence: 0.3, provenance: "pending" },
  ],
};

export const HARBOUR_GAME: EventData = {
  type: "game",
  title: "Harbour FC v Northgate United",
  venue: "Kelvin Park",
  city: "Glasgow",
  dateISO: "2024-09-14",
  seat: "Section C · Row 12",
  score: {
    home: "Harbour FC",
    away: "Northgate United",
    homeScore: 2,
    awayScore: 1,
    moments: [
      { minute: "23'", text: "Goal · [SCORER]" },
      { minute: "58'", text: "Goal · [SCORER] (Northgate)" },
      { minute: "89'", text: "Winner · [SCORER]", starred: true },
    ],
  },
  facts: [{ id: "final", label: "2 – 1", value: "2–1", source: "[SPORTS DATA API]", confidence: 0.9, provenance: "simulated", kept: true }],
};

export function newStub(event: EventData, id = Math.random().toString(36).slice(2, 10)): Stub {
  const v = { id: `v1-${id}`, edition: "researched" as const, art: { kind: "image" as const, src: "/brand/mockup-art-glasgow.webp", seed: 1, provenance: "simulated" as const }, createdAt: new Date().toISOString() };
  return {
    id,
    createdAt: new Date().toISOString(),
    event,
    versions: [v],
    currentVersionId: v.id,
    personal: { titleFont: 0, titleColor: "", foilTitle: true, hiddenFields: [], friends: [] },
    material: "print",
    finish: "foil",
    torn: false,
    wallAngle: Math.round((Math.random() * 8 - 4) * 10) / 10,
    photos: [],
  };
}
