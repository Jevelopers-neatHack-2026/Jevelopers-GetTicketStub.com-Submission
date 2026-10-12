"use client";
// Tells the server about the two events only the browser can see: a version chosen, a fact corrected.
// Fire and forget: it never throws and never blocks the editor. Only ids and counts are sent; the server
// hashes the ids and drops anything outside the event taxonomy (src/server/events.ts).

export function reportEvent(type: "version_selected" | "fact_corrected", fields: { version?: string; fact?: string; versions?: number }, stubId?: string): void {
  try {
    void fetch("/api/events", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, project: stubId, fields }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* reporting is best effort */
  }
}
