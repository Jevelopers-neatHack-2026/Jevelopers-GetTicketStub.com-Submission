"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Edition, Stub } from "../types";
import { currentVersion } from "../types";
import { encodeStub, getStub, upsertStub } from "../store";
import { StubView } from "@/customer/studio/stub/StubView";
import { EDITION_META } from "@/customer/studio/stub/editions";
import { play, haptic } from "@/customer/studio/feedback";
import { AgentChat } from "@/customer/studio/agent/AgentChat";
import { atVersion, canHide, cycleFont, hiddenLabel, hideSelection, fontName, formatDate, setEdition, setHidden, stepEdition, swatchLabel, TITLE_SWATCHES, toggleFoil, toggleKept, type Selectable } from "./ops";
import { FloatingToolbar } from "./FloatingToolbar";
import { ChipPopover } from "./ChipPopover";
import { StyleGrid, StyleGridItems } from "./StyleGrid";
import { RemixPanel, RemixSheet } from "./RemixSheet";
import { MaterialPicker, ctaLabel } from "./MaterialPicker";
import { MaterialFrame } from "./MaterialFrame";
import { Memories } from "./Memories";
import { FinishSheet, TearStage } from "./TearFlow";
import { MuteToggle } from "./MuteToggle";
import { Sheet } from "./Sheet";
import { useIsClient, useMediaQuery } from "./useClient";
import styles from "./Editor.module.css";

const HINT_KEY = "ticketstub.hint.swipe.v1";
const ZOOMS = [0.75, 1, 1.25, 1.5];
type SheetName = null | "styles" | "remix" | "agent" | "finish";

function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return true;
  }
}

function artProvenanceLabel(stub: Stub): string {
  const art = currentVersion(stub).art;
  if (art.vibe === "photo") return "Your photo";
  switch (art.provenance) {
    case "live":
      return "Generated art";
    case "sandbox":
      return "Sandbox art";
    case "simulated":
      return "Sample art";
    default:
      return "Art pending";
  }
}

function editionLabel(ed: Edition): string {
  return EDITION_META[ed]?.label ?? ed;
}

/** The studio editor: one stub, edited in place. Every change is saved to the wall right away. */
export function Editor({ id }: { id: string }) {
  const client = useIsClient();
  if (!client) return <div className={styles.loading} aria-busy="true" aria-label="Opening your stub" />;
  return <EditorLoaded key={id} id={id} />;
}

function EditorLoaded({ id }: { id: string }) {
  const [stub, setStub] = useState<Stub | null>(() => getStub(id) ?? null);
  const status = stub ? "ready" : "missing";
  const [selected, setSelected] = useState<Selectable | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [chipFact, setChipFact] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [tearing, setTearing] = useState(false);
  const [hint, setHint] = useState(() => !!stub && !hintSeen());
  const [deal, setDeal] = useState<"left" | "right" | null>(null);
  const [tab, setTab] = useState<"edit" | "agent">("edit");
  const [zoom, setZoom] = useState(1);
  const [safety, setSafety] = useState(false);
  const [bleed, setBleed] = useState(false);
  const desktop = useMediaQuery("(min-width: 960px)");

  // One-time swipe hint on the first visit to the studio.
  const hintShown = useRef(hint);
  useEffect(() => {
    if (!hintShown.current) return;
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* storage unavailable */
    }
    const t = window.setTimeout(() => setHint(false), 4500);
    return () => window.clearTimeout(t);
  }, []);

  const update = useCallback((s: Stub) => {
    setStub(s);
    upsertStub(s);
  }, []);

  const dealEdition = useCallback(
    (dir: 1 | -1) => {
      if (!stub) return;
      update(stepEdition(stub, dir));
      setDeal(dir === 1 ? "left" : "right");
      setHint(false);
      setSelected(null);
      play("flick");
      haptic([8]);
    },
    [stub, update],
  );

  const pickEdition = useCallback(
    (ed: Edition) => {
      if (!stub) return;
      update(setEdition(stub, ed));
      setDeal(null);
      play("flick");
    },
    [stub, update],
  );

  const flip = useCallback(() => {
    setFlipped((f) => !f);
    setSelected(null);
    play("flip");
  }, []);

  // Keyboard: ← → change style, F flips, Esc deselects.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheet || tearing || chipFact || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable='true'], [role='radio'], [role='tab']") || t.isContentEditable)) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        dealEdition(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        dealEdition(-1);
      } else if (e.key === "f" || e.key === "F") {
        flip();
      } else if (e.key === "Escape") {
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, tearing, chipFact, dealEdition, flip]);

  // Swipe and long-press on the stage. Taps on stub elements still reach StubView.
  const gesture = useRef<{ x: number; y: number; timer: number | null; moved: boolean; suppress: boolean }>({
    x: 0,
    y: 0,
    timer: null,
    moved: false,
    suppress: false,
  });

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("[role='toolbar'], a")) return;
    const g = gesture.current;
    g.x = e.clientX;
    g.y = e.clientY;
    g.moved = false;
    g.suppress = false;
    if (g.timer) window.clearTimeout(g.timer);
    g.timer = window.setTimeout(() => {
      g.timer = null;
      if (g.moved) return;
      g.suppress = true;
      haptic([12]);
      play("tick");
      setSheet("styles");
    }, 500);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (Math.abs(e.clientX - g.x) > 10 || Math.abs(e.clientY - g.y) > 10) {
      g.moved = true;
      if (g.timer) {
        window.clearTimeout(g.timer);
        g.timer = null;
      }
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (g.timer) {
      window.clearTimeout(g.timer);
      g.timer = null;
    }
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      g.suppress = true;
      dealEdition(dx < 0 ? 1 : -1);
    }
  };
  const onPointerCancel = () => {
    const g = gesture.current;
    if (g.timer) window.clearTimeout(g.timer);
    g.timer = null;
  };
  const onClickCapture = (e: React.MouseEvent) => {
    if (gesture.current.suppress) {
      gesture.current.suppress = false;
      e.stopPropagation();
      e.preventDefault();
    }
  };
  const onStageClick = (e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest("[data-stub-area]")) setSelected(null);
  };

  const shareToken = useMemo(() => (stub ? encodeStub(stub) : ""), [stub]);

  const onTorn = () => {
    if (!stub) return;
    const s = { ...stub, torn: true };
    update(s);
    play("pin");
    haptic([30, 30, 60]);
    setTearing(false);
    setSheet("finish");
  };

  if (status === "missing" || !stub) {
    return (
      <main className={styles.missing}>
        <h1>We couldn&apos;t find that stub on this device.</h1>
        <p>Stubs are saved in this browser. Make a new one from your ticket, or open your wall.</p>
        <div className={styles.missingActions}>
          <Link className="btn btn-primary" href="/">
            Make a new stub
          </Link>
          <Link className="btn" href="/wall">
            See your wall
          </Link>
        </div>
      </main>
    );
  }

  const version = currentVersion(stub);
  const meta = EDITION_META[version.edition];
  const ev = stub.event;
  const crumb = [ev.subtitle, ev.venue, formatDate(ev.dateISO)].filter(Boolean).join(" · ");
  const portrait = meta?.orientation === "portrait";
  const sizeLabel = version.edition === "researched" ? "2 × 3 in" : "2 × 5.5 in";
  const [shortSide, longSide] = version.edition === "researched" ? ["2 in", "3 in"] : ["2 in", "5.5 in"];

  const stubNode = (size: "md" | "lg") => (
    <div className={styles.stubWrap} data-stub-area>
      <MaterialFrame material={stub.material} finish={stub.finish}>
        <div
          key={version.id}
          className={`${styles.dealCard} ${deal === "left" ? styles.dealLeft : deal === "right" ? styles.dealRight : ""} ${hint ? styles.wiggle : ""}`}
        >
          <StubView
            stub={stub}
            flipped={flipped}
            tilt
            size={size}
            selected={selected}
            onSelect={(el) => {
              setSelected(el);
              play("tick");
            }}
            onChipTap={(factId) => {
              setChipFact(factId);
              play("tick");
            }}
          />
          {safety && <div className={styles.safety} aria-hidden="true" />}
          {bleed && <div className={styles.bleed} aria-hidden="true" />}
        </div>
      </MaterialFrame>
    </div>
  );

  const toolbar = selected && !flipped && (
    <FloatingToolbar stub={stub} selected={selected} onChange={update} onDone={() => setSelected(null)} onRemix={() => setSheet("remix")} />
  );

  const hiddenRow = stub.personal.hiddenFields.length > 0 && (
    <div className={styles.hiddenRow} role="group" aria-label="Hidden on the stub">
      <span className={styles.muted}>Hidden:</span>
      {stub.personal.hiddenFields.map((f) => (
        <button key={f} type="button" className="chip" onClick={() => update(setHidden(stub, f, false))}>
          + Show {hiddenLabel(stub, f)}
        </button>
      ))}
    </div>
  );

  const historyStrip = (
    <div className={styles.history} role="group" aria-label="Styles you've tried">
      {stub.versions.map((v, i) => (
        <button
          key={v.id}
          type="button"
          className={styles.historyThumb}
          aria-pressed={v.id === stub.currentVersionId}
          aria-label={`${editionLabel(v.edition)}${v.art.vibe ? `, ${v.art.vibe}` : ""}, style ${i + 1}`}
          onClick={() => {
            if (v.id === stub.currentVersionId) return;
            update(atVersion(stub, v.id));
            setDeal(null);
            play("tick");
          }}
        >
          <span aria-hidden="true" className={styles.historyInner}>
            <StubView stub={atVersion(stub, v.id)} size="sm" />
          </span>
        </button>
      ))}
    </div>
  );

  const tearBar = (
    <button
      type="button"
      className={`${styles.tearBar} ${stub.torn ? styles.tearDone : ""}`}
      onClick={() => {
        if (stub.torn) {
          setSheet("finish");
        } else {
          setSelected(null);
          setFlipped(false);
          setTearing(true);
          play("tear");
        }
      }}
    >
      <span className={styles.perf} aria-hidden="true" />
      <span>{stub.torn ? "On your wall · Share or print" : "Tear to finish"}</span>
      <span className={styles.perf} aria-hidden="true" />
    </button>
  );

  const cta = (
    <Link className="btn btn-primary" href={`/checkout/${stub.id}`}>
      {ctaLabel(stub.material)}
    </Link>
  );

  const overlays = (
    <>
      <ChipPopover stub={stub} factId={chipFact} onChange={update} onClose={() => setChipFact(null)} />
      <StyleGrid
        open={sheet === "styles"}
        onClose={() => setSheet(null)}
        stub={stub}
        onPick={pickEdition}
      />
      <RemixSheet open={sheet === "remix"} onClose={() => setSheet(null)} stub={stub} onChange={update} onDescribe={() => (desktop ? (setSheet(null), setTab("agent")) : setSheet("agent"))} />
      <Sheet title="Agent" open={sheet === "agent"} onClose={() => setSheet(null)} hideTitle>
        <div className={styles.agentSheet}>
          <AgentChat stub={stub} onChange={update} onClose={() => setSheet(null)} />
        </div>
      </Sheet>
      <FinishSheet stub={stub} open={sheet === "finish"} onClose={() => setSheet(null)} />
      {tearing && <TearStage stub={stub} onTorn={onTorn} onCancel={() => setTearing(false)} />}
    </>
  );

  const stageHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClickCapture,
    onClick: onStageClick,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  };

  /* ---------------- Desktop ---------------- */
  if (desktop) {
    const sel = selected;
    return (
      <div className={styles.desk}>
        <header className={styles.deskHeader}>
          <Link className={styles.backLink} href="/wall">
            <span aria-hidden="true">←</span> Your wall
          </Link>
          <div className={styles.crumb}>
            <h1 className={styles.crumbTitle}>{ev.title}</h1>
            {crumb && <p className={styles.muted}>{crumb}</p>}
          </div>
          <div className={styles.headerActions}>
            <MuteToggle />
            <Link className="btn" href={`/s/${shareToken}`}>
              Share
            </Link>
            {cta}
          </div>
        </header>

        <div className={styles.deskGrid}>
          <aside className={styles.rail} aria-label="Styles and remix">
            <section className={styles.panel}>
              <h2 className={styles.panelTitle}>Styles</h2>
              <StyleGridItems stub={stub} onPick={pickEdition} compact />
            </section>
            <section className={styles.panel}>
              <h2 className={styles.panelTitle}>Remix</h2>
              <RemixPanel stub={stub} onChange={update} onDescribe={() => setTab("agent")} compact />
            </section>
            {stub.versions.length > 1 && (
              <section className={styles.panel}>
                <h2 className={styles.panelTitle}>Your versions</h2>
                {historyStrip}
              </section>
            )}
          </aside>

          <main className={styles.deskCentre}>
            <div className={styles.deskTools}>
              <div className={styles.chipRowInline} role="group" aria-label="Print guides">
                <button type="button" className="chip" aria-pressed={safety} onClick={() => setSafety((v) => !v)}>
                  Safety
                </button>
                <button type="button" className="chip" aria-pressed={bleed} onClick={() => setBleed((v) => !v)}>
                  Bleed
                </button>
              </div>
              <span className="label">
                {editionLabel(version.edition)} · {sizeLabel}
              </span>
              <span className="provenance">{artProvenanceLabel(stub)}</span>
            </div>

            <div className={styles.deskSurface} {...stageHandlers}>
              <div className={styles.measure} style={{ transform: `scale(${zoom})` }}>
                <div className={styles.rulerTop} aria-hidden="true">
                  <span>{portrait ? shortSide : longSide}</span>
                </div>
                <div className={styles.rulerLeft} aria-hidden="true">
                  <span>{portrait ? longSide : shortSide}</span>
                </div>
                {toolbar && <div className={styles.toolbarSlot} data-stub-area>{toolbar}</div>}
                {stubNode("lg")}
              </div>
              {hint && <p className={styles.hintPill}>Use ← → for another style</p>}
            </div>

            <div className={styles.deskFooter}>
              <div className={styles.sides} role="group" aria-label="Side">
                {[false, true].map((back) => (
                  <button
                    key={String(back)}
                    type="button"
                    className={styles.sideThumb}
                    aria-pressed={flipped === back}
                    onClick={() => flipped !== back && flip()}
                  >
                    <span aria-hidden="true" className={styles.sideInner}>
                      <StubView stub={stub} flipped={back} size="sm" />
                    </span>
                    <span>{back ? "Back" : "Front"}</span>
                  </button>
                ))}
              </div>
              <div className={styles.zoomPill} role="group" aria-label="Zoom">
                <button type="button" aria-label="Zoom out" disabled={zoom <= ZOOMS[0]} onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)])}>
                  −
                </button>
                <span className="num" aria-live="polite">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  aria-label="Zoom in"
                  disabled={zoom >= ZOOMS[ZOOMS.length - 1]}
                  onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)])}
                >
                  +
                </button>
              </div>
              <p className={styles.keys}>
                <kbd>←</kbd> <kbd>→</kbd> style · <kbd>F</kbd> flip · <kbd>Esc</kbd> deselect · hold for all styles
              </p>
            </div>
          </main>

          <aside className={styles.inspector} aria-label="Inspector">
            <div className={styles.tabs} role="tablist" aria-label="Inspector mode">
              <button type="button" role="tab" id="tab-edit" aria-controls="panel-edit" aria-selected={tab === "edit"} className={styles.tab} onClick={() => setTab("edit")}>
                Edit
              </button>
              <button type="button" role="tab" id="tab-agent" aria-controls="panel-agent" aria-selected={tab === "agent"} className={styles.tab} onClick={() => setTab("agent")}>
                Agent
              </button>
            </div>

            {tab === "edit" ? (
              <div className={styles.inspectorBody} role="tabpanel" id="panel-edit" aria-labelledby="tab-edit">
                <section className={styles.panel}>
                  <h2 className={styles.panelTitle}>Selected</h2>
                  {!sel && <p className={styles.muted}>Click the title, subtitle, facts or art on the stub to edit it.</p>}
                  {(sel === "title" || sel === "subtitle") && (
                    <div className={styles.stackSm}>
                      <p className="label">{sel === "title" ? "Title" : "Subtitle"}</p>
                      <button type="button" className="btn btn-quiet" onClick={() => update(cycleFont(stub))}>
                        Font: {fontName(meta?.fontPairs?.[stub.personal.titleFont], `Font ${stub.personal.titleFont + 1}`)}
                      </button>
                      <div className={styles.chipRowInline} role="radiogroup" aria-label="Title colour">
                        {TITLE_SWATCHES.map((sw) => (
                          <button
                            key={sw.label}
                            type="button"
                            role="radio"
                            aria-checked={stub.personal.titleColor === sw.value}
                            className={styles.swatchBtn}
                            title={sw.label}
                            onClick={() => update({ ...stub, personal: { ...stub.personal, titleColor: sw.value } })}
                          >
                            <span className={styles.swatchDot} style={{ background: sw.value || "var(--ts-foil)" }} aria-hidden="true" />
                            <span className="visually-hidden">{sw.label}</span>
                          </button>
                        ))}
                        <span className={styles.muted}>{swatchLabel(stub.personal.titleColor)}</span>
                      </div>
                      <div className={styles.chipRowInline}>
                        <button type="button" className="chip" aria-pressed={stub.personal.foilTitle} onClick={() => update(toggleFoil(stub))}>
                          Foil title
                        </button>
                        {canHide(sel) && (
                          <button
                            type="button"
                            className="chip"
                            onClick={() => {
                              update(hideSelection(stub, sel));
                              setSelected(null);
                            }}
                          >
                            Hide subtitle
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                  {sel === "art" && (
                    <div className={styles.stackSm}>
                      <p className={styles.muted}>Art changes are saved as a new style, so you can always go back.</p>
                      <button type="button" className="btn btn-quiet" onClick={() => setSheet("remix")}>
                        Remix the art
                      </button>
                    </div>
                  )}
                  {sel === "facts" && (
                    <button
                      type="button"
                      className="chip"
                      onClick={() => {
                        update(hideSelection(stub, "facts"));
                        setSelected(null);
                      }}
                    >
                      Hide the fact line
                    </button>
                  )}
                  {hiddenRow}
                </section>

                <section className={styles.panel}>
                  <h2 className={styles.panelTitle}>Facts</h2>
                  <ul className={styles.factList}>
                    {ev.facts.map((f) => (
                      <li key={f.id} className={styles.factItem}>
                        <div>
                          <p>{f.label}</p>
                          <p className={styles.muted}>
                            {f.source}
                            {f.confidence < 0.8 && " · not sure yet"}
                          </p>
                        </div>
                        <div className={styles.chipRowInline}>
                          {f.confidence < 0.8 && (
                            <button type="button" className="chip" onClick={() => setChipFact(f.id)}>
                              Fix
                            </button>
                          )}
                          <button type="button" className="chip" aria-pressed={!!f.kept} onClick={() => update(toggleKept(stub, f.id))}>
                            {f.kept ? "On stub" : "Keep"}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className={styles.panel}>
                  <h2 className={styles.panelTitle}>Material and finish</h2>
                  <MaterialPicker stub={stub} onChange={update} />
                </section>

                <section className={styles.panel}>
                  <h2 className={styles.panelTitle}>Memories</h2>
                  <Memories stub={stub} onChange={update} />
                </section>

                {tearBar}
              </div>
            ) : (
              <div className={styles.inspectorBody} role="tabpanel" id="panel-agent" aria-labelledby="tab-agent">
                <AgentChat stub={stub} onChange={update} onClose={() => setTab("edit")} />
              </div>
            )}
          </aside>
        </div>
        {overlays}
      </div>
    );
  }

  /* ---------------- Phone ---------------- */
  return (
    <div className={styles.phone}>
      <header className={styles.topBar}>
        <Link className={styles.iconLink} href="/wall" aria-label="Back to your wall">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Link>
        <div className={styles.crumb}>
          <h1 className={styles.crumbTitle}>{ev.title}</h1>
          {crumb && <p className={styles.crumbSub}>{crumb}</p>}
        </div>
        <MuteToggle />
      </header>

      {historyStrip}

      <section
        className={styles.stage}
        aria-label={`Your stub, ${editionLabel(version.edition)} style. Swipe for another style, hold for all styles.`}
        {...stageHandlers}
      >
        {toolbar && <div className={styles.toolbarSlot} data-stub-area>{toolbar}</div>}
        {stubNode("md")}
        {hint && (
          <p className={styles.hintPill} role="status">
            Swipe for another style
          </p>
        )}
      </section>

      <div className={styles.metaRow}>
        <span className="label">{editionLabel(version.edition)}</span>
        <span className="provenance">{artProvenanceLabel(stub)}</span>
      </div>
      {hiddenRow}

      <div className={styles.actions}>
        <button type="button" className={styles.actionBtn} onClick={() => setSheet("remix")}>
          <span aria-hidden="true">✦</span>Remix
        </button>
        <button type="button" className={styles.actionBtn} aria-pressed={flipped} onClick={flip}>
          <span aria-hidden="true">⟲</span>Flip
        </button>
        <Link className={styles.actionBtn} href={`/friends/${stub.id}`}>
          <span aria-hidden="true">☺</span>Friends
        </Link>
        <button type="button" className={styles.actionBtn} onClick={() => setSheet("agent")}>
          <span aria-hidden="true">✎</span>Agent
        </button>
      </div>

      <div className={styles.commerce}>
        <MaterialPicker stub={stub} onChange={update} />
        {cta}
      </div>

      <div className={styles.tearDock}>{tearBar}</div>
      {overlays}
    </div>
  );
}
