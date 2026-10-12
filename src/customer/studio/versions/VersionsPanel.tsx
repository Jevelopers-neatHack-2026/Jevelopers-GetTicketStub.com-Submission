"use client";
// The version history (GT-06A): every version with its thumbnail, short id, parent, how it was made and when; pick any two
// to compare in words and side by side (switchable on the phone); restore one without changing or generating anything.
// The selected version is the one checkout and the wall use, and it is named at the top so nothing is ambiguous.
import { useId, useState } from "react";
import type { DesignVersion, Stub } from "../types";
import { StubView } from "@/customer/studio/stub/StubView";
import { play } from "@/customer/studio/feedback";
import { PunchTabs, Tag, Tags, TearLink } from "@/customer/desk/Desk";
import { atVersion } from "../editor/ops";
import { whenLabel } from "../facts/FactsReview";
import { artUnavailable } from "./retention";
import { artLabel, compareVersions, howMade, listVersions, restoreVersion, selectedSummary, versionHash } from "./versions";
import styles from "./Versions.module.css";

interface Props {
  stub: Stub;
  onChange: (s: Stub) => void;
  /** "side" shows two compared versions next to each other (desktop); "switch" shows one at a time with a switch (phone). */
  layout: "side" | "switch";
}

function Thumb({ stub, v }: { stub: Stub; v: DesignVersion }) {
  return (
    <span className={styles.thumb} aria-hidden="true">
      <StubView stub={atVersion(stub, v.id)} size="sm" />
    </span>
  );
}

function Identity({ stub, v }: { stub: Stub; v: DesignVersion }) {
  const made = howMade(stub, v);
  const art = artLabel(v.art);
  const parent = v.parentId ? stub.versions.find((x) => x.id === v.parentId) : undefined;
  return (
    <span className={styles.meta}>
      <span className={styles.hash}>#{versionHash(v)}</span>
      <span className={styles.line}>{made.text}</span>
      <span className={styles.line} data-sample={art.sample || undefined}>
        {art.text}
      </span>
      <span className={styles.line}>
        {parent ? `Made from #${versionHash(parent)}` : v.parentId ? "Made from a version no longer kept" : "No parent"} · {whenLabel(v.createdAt)}
      </span>
    </span>
  );
}

export function VersionsPanel({ stub, onChange, layout }: Props) {
  const [picks, setPicks] = useState<string[]>([]);
  const [side, setSide] = useState<"a" | "b">("a");
  const [said, setSaid] = useState("");
  const id = useId();
  const versions = listVersions(stub);
  const selected = selectedSummary(stub);
  const [a, b] = picks.map((p) => stub.versions.find((v) => v.id === p));
  const changes = a && b ? compareVersions(stub, a.id, b.id) : [];

  const togglePick = (vid: string) => {
    play("select", { emphasis: "subtle" });
    setPicks((p) => (p.includes(vid) ? p.filter((x) => x !== vid) : [...p, vid].slice(-2)));
  };
  const restore = (v: DesignVersion) => {
    onChange(restoreVersion(stub, v.id));
    play("stamp");
    setSaid(
      artUnavailable(v.art)
        ? `Selected #${versionHash(v)}, but its image is not kept on this device, so a sample is shown. Nothing was overwritten and nothing was made again.`
        : `Selected #${versionHash(v)}. Nothing was overwritten and nothing was made again.`,
    );
  };

  return (
    <div className={styles.versions}>
      <section className={styles.selected} aria-label="Selected version">
        <span className="desk-label">Selected for print</span>
        <p className={styles.selectedLine}>
          <span className={styles.hash}>#{selected.hash}</span> {selected.text}
        </p>
        <p className={styles.note}>Checkout and your wall use this version. Pick another below to switch. Nothing is made again.</p>
      </section>

      <ul className={styles.list} aria-label="Design versions, newest first">
        {versions.map((v) => {
          const current = v.id === stub.currentVersionId;
          return (
            <li key={v.id} className={styles.row} aria-current={current || undefined} data-current={current || undefined}>
              <Thumb stub={stub} v={v} />
              <div className={styles.body}>
                <Identity stub={stub} v={v} />
                <Tags label={`Version ${versionHash(v)}`}>
                  <Tag disabled={current} onClick={() => restore(v)} aria-label={current ? `Version ${versionHash(v)} is selected` : `Select version ${versionHash(v)}`}>
                    {current ? "Selected" : "Select"}
                  </Tag>
                  <Tag pressed={picks.includes(v.id)} onClick={() => togglePick(v.id)} aria-label={`Compare version ${versionHash(v)}`}>
                    Compare
                  </Tag>
                </Tags>
              </div>
            </li>
          );
        })}
      </ul>

      <p className={styles.note} data-announce="change">
        {said || (picks.length === 1 ? "Pick one more version to compare." : versions.length < 2 ? "Remix the art or try another style and the history builds here." : "Pick two versions to compare them.")}
      </p>

      {a && b && (
        <section className={styles.compare} aria-label={`Comparing ${versionHash(a)} and ${versionHash(b)}`}>
          <span className="desk-label">Comparing</span>
          {layout === "switch" && (
            <PunchTabs
              label="Version to show"
              options={[
                { value: "a", label: `#${versionHash(a)}` },
                { value: "b", label: `#${versionHash(b)}` },
              ]}
              value={side}
              onChange={setSide}
            />
          )}
          <div className={styles.pair} data-layout={layout}>
            {[a, b].map((v, i) =>
              layout === "side" || side === (i === 0 ? "a" : "b") ? (
                <figure key={v.id} className={styles.fig}>
                  <Thumb stub={stub} v={v} />
                  <figcaption>
                    <Identity stub={stub} v={v} />
                    {v.id === stub.currentVersionId && <span className={styles.flag}>Selected</span>}
                  </figcaption>
                </figure>
              ) : null,
            )}
          </div>
          <h4 className={styles.changesHead} id={`${id}-c`}>
            What changed from #{versionHash(a)} to #{versionHash(b)}
          </h4>
          <ul className={styles.changes} aria-labelledby={`${id}-c`}>
            {changes.map((c) => (
              <li key={c.field + c.text}>{c.text}</li>
            ))}
          </ul>
          <p className={styles.note}>Selected versions show the stub as it is now. Others show the settings kept when they were made.</p>
          <TearLink onClick={() => setPicks([])}>Clear the comparison</TearLink>
        </section>
      )}
    </div>
  );
}
