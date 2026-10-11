"use client";
import type { EventData, Fact } from "@/customer/studio/types";
import s from "./memory.module.css";

function Star({ on }: { on?: boolean }) {
  return on ? (
    <span className={s.star} aria-label="Favorite">
      ★
    </span>
  ) : null;
}

/** Type-specific main block: setlist, score and moments, cast, or programme. */
export function EventContent({ event: e }: { event: EventData }) {
  if (e.type === "concert" && e.setlist?.length) {
    return (
      <section className={s.section} aria-labelledby="ec-h">
        <h2 id="ec-h" className={s.h2}>
          Setlist
        </h2>
        <ol className={s.list}>
          {e.setlist.map((song, i) => (
            <li key={`${song.title}-${i}`} className={song.starred ? s.starred : undefined}>
              <span className={`${s.idx} num`}>{i + 1}</span> {song.title} <Star on={song.starred} />
            </li>
          ))}
        </ol>
      </section>
    );
  }
  if (e.type === "game" && e.score) {
    const sc = e.score;
    return (
      <section className={s.section} aria-labelledby="ec-h">
        <h2 id="ec-h" className={s.h2}>
          Final score
        </h2>
        <div className={s.score}>
          <span className={s.team}>{sc.home}</span>
          <span className={`${s.bigScore} num`} aria-label={`${sc.homeScore} to ${sc.awayScore}`}>
            {sc.homeScore} – {sc.awayScore}
          </span>
          <span className={s.team}>{sc.away}</span>
        </div>
        {sc.moments.length ? (
          <>
            <h3 className={s.h3}>Moments</h3>
            <ol className={s.list}>
              {sc.moments.map((m, i) => (
                <li key={i} className={m.starred ? s.starred : undefined}>
                  <span className={`${s.idx} num`}>{m.minute}</span> {m.text} <Star on={m.starred} />
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </section>
    );
  }
  if (e.type === "show" && e.cast?.length) {
    return (
      <section className={s.section} aria-labelledby="ec-h">
        <h2 id="ec-h" className={s.h2}>
          Cast
        </h2>
        <ul className={s.list}>
          {e.cast.map((c, i) => (
            <li key={`${c.name}-${i}`} className={c.starred ? s.starred : undefined}>
              {c.name} <Star on={c.starred} />
            </li>
          ))}
        </ul>
      </section>
    );
  }
  if (e.programme?.length) {
    return (
      <section className={s.section} aria-labelledby="ec-h">
        <h2 id="ec-h" className={s.h2}>
          Programme
        </h2>
        <ul className={s.list}>
          {e.programme.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      </section>
    );
  }
  return null;
}

const PROV_LABEL: Record<string, string> = {
  live: "live",
  sandbox: "sandbox",
  simulated: "simulated",
  estimated: "estimated",
  pending: "pending",
};

/** Facts with their source and provenance. Unknown facts stay visible as pending. */
export function Facts({ facts }: { facts: Fact[] }) {
  if (!facts?.length) return null;
  return (
    <section className={s.section} aria-labelledby="facts-h">
      <h2 id="facts-h" className={s.h2}>
        Found for this night
      </h2>
      <ul className={s.facts}>
        {facts.map((f) => (
          <li key={f.id} className={s.fact}>
            <span className={s.factLabel}>{f.label}</span>
            <span className={s.factSrc}>
              {f.sourceUrl ? (
                <a href={f.sourceUrl} target="_blank" rel="noopener noreferrer" className="chip">
                  {f.source}
                </a>
              ) : (
                <span className="chip">{f.source}</span>
              )}
              <span className="provenance">{PROV_LABEL[f.provenance] ?? f.provenance}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
