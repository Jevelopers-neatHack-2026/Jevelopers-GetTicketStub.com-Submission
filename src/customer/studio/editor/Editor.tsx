"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Edition, Material, Stub } from "../types";
import { EDITIONS, currentVersion } from "../types";
import { encodeStub, getStub, upsertStub } from "../store";
import { StubView } from "@/customer/studio/stub/StubView";
import { EDITION_META } from "@/customer/studio/stub/editions";
import { haptic, play } from "@/customer/studio/feedback";
import { AgentChat } from "@/customer/studio/agent/AgentChat";
import { AgentNotes } from "@/customer/studio/agent/AgentNotes";
import { Breadcrumbs } from "@/customer/nav/Breadcrumbs";
import { LeavesMark } from "@/customer/pages/ui";
import { HandleIcon } from "@/customer/nav/icons";
import { PathTrack } from "@/customer/wayfinding/PathTrack";
import { PaperButton, PaperSheet, Stamp, Switch, Tag, Tags, Tool, Tools } from "@/customer/desk/Desk";
import { AskIcon, FlipIcon, FriendsIcon, RemixIcon } from "@/customer/desk/icons";
import { formatDate, hiddenLabel, setEdition, setHidden, stepEdition, type Selectable } from "./ops";
import { FloatingToolbar } from "./FloatingToolbar";
import { DockedToolbar } from "./Dock";
import { ChipPopover } from "./ChipPopover";
import { StyleGrid, StyleGridItems } from "./StyleGrid";
import { RemixSheet } from "./RemixSheet";
import { MaterialFrame } from "./MaterialFrame";
import { Inspector } from "./Inspector";
import { Tray } from "./Tray";
import { FinishSheet, TearStage } from "./TearFlow";
import { useIsClient, useMediaQuery } from "./useClient";
import { useCamera } from "./useCamera";
import { usePinchLook } from "./usePinchLook";
import styles from "./Editor.module.css";

const HINT_KEY = "ticketstub.hint.swipe.v1";
const PANELS_KEY = "ticketstub.studio.panels.v1";
/** Print preview comes on by itself past this zoom. */
const AUTO_PREVIEW = 1.5;
type SheetName = null | "styles" | "remix" | "agent" | "finish";

/** Width / height of each style, so the stage can be sized to the stub before it renders. */
const ASPECT: Record<Edition, number> = { researched: 2 / 3, risograph: 2 / 3, minimal: 2 / 3, letterpress: 1.9, classic: 2.4 };
/** What each stock adds around the stub, in px (see MaterialFrame). */
const MAT: Record<Material, number> = { digital: 0, card: 12, print: 36, framed: 80 };
/** The stub's printed size in inches: width, height. The cutting mat's grid is drawn from this. */
const INCHES: Record<Edition, [number, number]> = {
  researched: [2, 3],
  risograph: [2, 3],
  minimal: [2, 3],
  letterpress: [5.5, 2.9],
  classic: [5.5, 2.3],
};

const DEAL_MS = 460;
const LONG_PRESS_MS = 450;
const SWIPE_PX = 64;

interface Dealing {
  from: Stub;
  dir: 1 | -1;
  fromX: number;
  n: number;
}

function hintSeen(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === "1";
  } catch {
    return true;
  }
}

/** Which side panels are open on the desktop editor. Remembered across visits; storage can throw. */
interface Panels {
  rail: boolean;
  insp: boolean;
}
function readPanels(): Panels {
  try {
    const v = JSON.parse(localStorage.getItem(PANELS_KEY) ?? "null") as Partial<Panels> | null;
    return { rail: v?.rail !== false, insp: v?.insp !== false };
  } catch {
    return { rail: true, insp: true };
  }
}
function writePanels(p: Panels) {
  try {
    localStorage.setItem(PANELS_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: the choice lasts for this visit */
  }
}

function editionLabel(ed: Edition): string {
  return EDITION_META[ed]?.label ?? ed;
}

/** The stub's printed width in inches, for the camera's grid and rulers. */
function inchesWide(ed: string): number {
  return INCHES[ed as Edition]?.[0] ?? 2;
}

function fmtIn(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** The studio editor: one stub, edited in place. Every change is saved to the wall right away. */
export function Editor({ id }: { id: string }) {
  const client = useIsClient();
  if (!client) return <div className={`${styles.loading} desk-surface`} aria-busy="true" aria-label="Opening your stub" />;
  return <EditorLoaded key={id} id={id} />;
}

function EditorLoaded({ id }: { id: string }) {
  const router = useRouter();
  const [stub, setStub] = useState<Stub | null>(() => getStub(id) ?? null);
  const status = stub ? "ready" : "missing";
  const [selected, setSelected] = useState<Selectable | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [chipFact, setChipFact] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [tearing, setTearing] = useState(false);
  const [hint, setHint] = useState(() => !!stub && !hintSeen());
  const [dealing, setDealing] = useState<Dealing | null>(null);
  const [pressing, setPressing] = useState(false);
  const [agentSeed, setAgentSeed] = useState<{ text: string; n: number } | undefined>();
  const [preview, setPreview] = useState(false);
  const [camAway, setCamAway] = useState(false);
  const [peek, setPeek] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [panels, setPanels] = useState<Panels>(readPanels);
  const desktop = useMediaQuery("(min-width: 960px)");

  const areaRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<HTMLDivElement>(null);
  const matRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<((r: DOMRect) => void) | null>(null);
  const dealN = useRef(0);
  const timers = useRef<number[]>([]);
  const later = useCallback((fn: () => void, ms: number) => {
    const t = window.setTimeout(fn, ms);
    timers.current.push(t);
  }, []);
  useEffect(() => {
    const list = timers.current;
    return () => list.forEach((t) => window.clearTimeout(t));
  }, []);

  // One-time swipe hint on the first visit to the studio: the stub wiggles once.
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

  /** Deal another style: the old stub slides off, the new one is set down with a thunk and a buzz. */
  const deal = useCallback(
    (next: Stub, dir: 1 | -1, fromX = 0) => {
      if (!stub) return;
      setDealing({ from: stub, dir, fromX, n: ++dealN.current });
      setHint(false);
      setSelected(null);
      setFlipped(false);
      update(next);
      later(() => {
        play("drop");
        haptic([10]);
      }, 250);
      later(() => setDealing(null), DEAL_MS + 80);
    },
    [stub, update, later],
  );

  const dealStep = useCallback((dir: 1 | -1, fromX = 0) => stub && deal(stepEdition(stub, dir), dir, fromX), [stub, deal]);

  const dealTo = useCallback(
    (ed: Edition) => {
      if (!stub) return;
      const from = EDITIONS.indexOf(currentVersion(stub).edition);
      const to = EDITIONS.indexOf(ed);
      if (from === to) return;
      deal(setEdition(stub, ed), to > from ? 1 : -1);
    },
    [stub, deal],
  );

  const flip = useCallback(() => {
    setFlipped((f) => !f);
    setSelected(null);
    play("flip");
  }, []);

  const showBack = useCallback(() => {
    setFlipped(true);
    setSelected(null);
    play("flip");
  }, []);

  const ask = useCallback((text?: string) => {
    setAgentSeed(text ? { text, n: Date.now() } : undefined);
    setSheet("agent");
  }, []);

  const setPanelState = useCallback((next: Panels) => {
    setPanels(next);
    writePanels(next);
  }, []);
  const togglePanel = useCallback(
    (which: keyof Panels) => {
      play("toggle", { emphasis: "subtle", direction: panels[which] ? "back" : "forward" });
      setPanelState({ ...panels, [which]: !panels[which] });
    },
    [panels, setPanelState],
  );
  /** Focus: fold both panels, or unfold them again. */
  const toggleFocus = useCallback(() => {
    const open = panels.rail || panels.insp;
    play("toggle", { emphasis: "subtle", direction: open ? "back" : "forward" });
    setPanelState({ rail: !open, insp: !open });
  }, [panels, setPanelState]);

  const zoomToSelection = useCallback(() => {
    const el = areaRef.current?.querySelector<HTMLElement>("figure[data-edition] button[aria-pressed='true']");
    if (!el) return;
    play("tap", { emphasis: "subtle" });
    cameraRef.current?.(el.getBoundingClientRect());
  }, []);

  // Keyboard: ← → deal another style, F flips, Z zooms to the selection, \ folds the side panels, Esc deselects.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheet || tearing || chipFact || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable='true'], [role='radio'], [role='tab']") || t.isContentEditable)) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        dealStep(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        dealStep(-1);
      } else if (e.key === "f" || e.key === "F") {
        flip();
      } else if ((e.key === "z" || e.key === "Z") && desktop && selected && !flipped) {
        zoomToSelection();
      } else if (e.key === "\\" && desktop) {
        e.preventDefault();
        toggleFocus();
      } else if (e.key === "Escape") {
        setSelected(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheet, tearing, chipFact, dealStep, flip, desktop, selected, flipped, zoomToSelection, toggleFocus]);

  /* ---- Gestures on the stage. Touch and mouse alike: the stub follows the pointer, a swipe past
     64px deals the next or previous style, a still press of 450ms opens All styles. Taps on stub
     elements still reach StubView, because the pointer is only captured once a drag has begun. ---- */
  const g = useRef({ x: 0, y: 0, id: -1, dragging: false, cancelled: false, suppress: false, press: 0, long: 0 });

  const clearPress = () => {
    const s = g.current;
    window.clearTimeout(s.press);
    window.clearTimeout(s.long);
    setPressing(false);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || camera.panning.current || pinch.active.current) return;
    if ((e.target as HTMLElement).closest("[role='toolbar'], [role='radiogroup'], [data-note], [data-cam-mini], a, input, textarea")) return;
    const s = g.current;
    clearPress();
    s.x = e.clientX;
    s.y = e.clientY;
    s.id = e.pointerId;
    s.dragging = false;
    s.cancelled = false;
    s.suppress = false;
    // The press-in shows after a beat, so a quick tap on the stub never flinches.
    s.press = window.setTimeout(() => setPressing(true), 140);
    s.long = window.setTimeout(() => {
      if (s.dragging || s.cancelled) return;
      s.suppress = true;
      setPressing(false);
      haptic([12]);
      setSheet("styles");
    }, LONG_PRESS_MS);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = g.current;
    if (e.pointerId !== s.id || s.cancelled) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.dragging) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        s.dragging = true;
        clearPress();
        try {
          areaRef.current?.setPointerCapture(e.pointerId);
        } catch {
          /* the pointer is already gone */
        }
        if (dragRef.current) dragRef.current.dataset.dragging = "true";
      } else if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        s.cancelled = true;
        clearPress();
      }
    }
    if (s.dragging && dragRef.current) {
      dragRef.current.style.transform = `translateX(${dx}px) rotate(${dx / 28}deg)`;
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const s = g.current;
    if (e.pointerId !== s.id) return;
    s.id = -1;
    clearPress();
    const node = dragRef.current;
    if (!s.dragging) return;
    s.dragging = false;
    s.suppress = true;
    const dx = e.clientX - s.x;
    if (node) delete node.dataset.dragging;
    if (Math.abs(dx) > SWIPE_PX) {
      // The old stub carries on from where the pointer let go; the new one starts from rest.
      if (node) {
        node.style.transition = "none";
        node.style.transform = "";
        requestAnimationFrame(() => {
          node.style.transition = "";
        });
      }
      dealStep(dx < 0 ? 1 : -1, dx);
    } else if (node) {
      node.style.transform = "";
    }
  };
  const onPointerCancel = () => {
    const s = g.current;
    s.id = -1;
    clearPress();
    if (s.dragging && dragRef.current) {
      delete dragRef.current.dataset.dragging;
      dragRef.current.style.transform = "";
    }
    s.dragging = false;
  };
  const onClickCapture = (e: React.MouseEvent) => {
    if (g.current.suppress) {
      g.current.suppress = false;
      e.stopPropagation();
      e.preventDefault();
    }
  };
  const onStageClick = (e: React.MouseEvent) => {
    if (!(e.target as HTMLElement).closest("[data-stub-area]")) setSelected(null);
  };
  const stageHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onClickCapture,
    onClick: onStageClick,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onDragStart: (e: React.DragEvent) => e.preventDefault(),
  };

  // Desktop: the camera owns the mat. It reads the stub's real size off the screen so the grid and rulers are in inches.
  const camera = useCamera({
    enabled: desktop,
    matRef,
    areaRef,
    layoutKey: `${stub?.currentVersionId}|${stub?.material}`,
    inchesWide,
    numClass: styles.num,
    onCancelGesture: () => onPointerCancel(),
  });

  const frameCam = camera.frame;
  useEffect(() => {
    cameraRef.current = frameCam;
  }, [frameCam]);
  const readCam = camera.read;
  // The note card folds and the print guides show according to where the camera is.
  useEffect(() => {
    if (!desktop) return;
    let away = false;
    const on = () => {
      const c = readCam();
      if (c.away !== away) {
        away = c.away;
        setCamAway(c.away);
        setPeek(false);
      }
      setZoomed(c.s > AUTO_PREVIEW);
    };
    window.addEventListener("ts-camera", on);
    return () => window.removeEventListener("ts-camera", on);
  }, [desktop, readCam]);

  // Phone: pinch the stub to look closer; it springs back on release.
  const pinch = usePinchLook({ enabled: !desktop, areaRef, onStart: () => onPointerCancel() });

  const shareToken = useMemo(() => (stub ? encodeStub(stub) : ""), [stub]);

  const onTorn = () => {
    if (!stub) return;
    update({ ...stub, torn: true });
    play("pin");
    haptic([30, 30, 60]);
    setTearing(false);
    setSheet("finish");
  };

  if (status === "missing" || !stub) {
    return (
      <main className={`${styles.missing} desk-surface`}>
        <h1>We couldn&apos;t find that stub on this device.</h1>
        <p>Stubs are saved in this browser. Make a new one from your ticket, or open your wall.</p>
        <div className={styles.missingActions}>
          <Stamp onClick={() => window.setTimeout(() => router.push("/make"), 200)}>
            Paste a new link
            <LeavesMark />
          </Stamp>
          <PaperButton onClick={() => router.push("/wall")}>
            Open your wall
            <LeavesMark />
          </PaperButton>
        </div>
      </main>
    );
  }

  const version = currentVersion(stub);
  const edition = version.edition;
  const ev = stub.event;
  const crumb = [ev.subtitle, ev.venue, formatDate(ev.dateISO)].filter(Boolean).join(" · ");
  const [inW, inH] = INCHES[edition];
  const sizeLabel = `${fmtIn(inW)} × ${fmtIn(inH)} in`;
  const index = EDITIONS.indexOf(edition);

  const stageVars = { "--ar": ASPECT[edition], "--mat": `${MAT[stub.material]}px` } as CSSProperties;

  /** The stub on its stock, with the one being dealt off sliding away beside it. */
  const deck = (size: "md" | "lg") => (
    <div className={styles.deck} data-stub-area data-deck>
      {dealing && (
        <div
          key={`out-${dealing.n}`}
          className={styles.leaving}
          aria-hidden="true"
          style={{ "--dir": dealing.dir, "--from-x": `${dealing.fromX}px`, "--from-r": dealing.fromX / 28 } as CSSProperties}
        >
          <MaterialFrame material={dealing.from.material} finish={dealing.from.finish}>
            <StubView stub={dealing.from} size={size} />
          </MaterialFrame>
        </div>
      )}
      <div ref={dragRef} className={styles.drag} data-wiggle={hint && !desktop ? "true" : undefined}>
        <div key={version.id} className={styles.card} data-card style={{ "--dir": dealing?.dir ?? 1 } as CSSProperties}>
          <MaterialFrame material={stub.material} finish={stub.finish}>
            <div className={styles.guided}>
              <StubView
                stub={stub}
                flipped={flipped}
                tilt
                size={size}
                selected={selected}
                onSelect={(el) => {
                  setSelected(el);
                  play("select");
                }}
                onChipTap={(factId) => {
                  setChipFact(factId);
                  play("tap", { emphasis: "subtle" });
                }}
              />
              {desktop && <div className={styles.safety} data-on={preview || zoomed || undefined} aria-hidden="true" />}
              {desktop && <div className={styles.bleed} data-on={preview || zoomed || undefined} aria-hidden="true" />}
            </div>
          </MaterialFrame>
        </div>
      </div>
    </div>
  );

  const toolbar = (
    <DockedToolbar container={areaRef} clip={desktop} active={!!selected && !flipped} track={`${version.id}|${selected}|${stub.material}|${desktop}`}>
      {selected && <FloatingToolbar stub={stub} selected={selected} onChange={update} onDone={() => setSelected(null)} onRemix={() => setSheet("remix")} onZoom={desktop ? zoomToSelection : undefined} />}
    </DockedToolbar>
  );

  const hiddenRow = stub.personal.hiddenFields.length > 0 && (
    <div className={styles.hiddenRow}>
      <Tags label="Hidden on the stub">
        {stub.personal.hiddenFields.map((f) => (
          <Tag key={f} onClick={() => update(setHidden(stub, f, false))}>
            Show {hiddenLabel(stub, f)}
          </Tag>
        ))}
      </Tags>
    </div>
  );

  const tools = (
    <Tools label="Stub tools">
      <Tool icon={<RemixIcon />} active={sheet === "remix"} onClick={() => setSheet("remix")}>
        Remix
      </Tool>
      <Tool icon={<FlipIcon />} active={flipped} onClick={flip}>
        Flip
      </Tool>
      <Tool icon={<FriendsIcon />} onClick={() => router.push(`/friends/${stub.id}`)}>
        <span className={styles.toolGo}>
          Friends
          <LeavesMark />
        </span>
      </Tool>
      <Tool icon={<AskIcon />} active={sheet === "agent"} onClick={() => ask()}>
        Ask
      </Tool>
    </Tools>
  );

  const onTear = () => {
    if (stub.torn) {
      setSheet("finish");
    } else {
      setSelected(null);
      setFlipped(false);
      setTearing(true);
    }
  };

  const overlays = (
    <>
      <ChipPopover stub={stub} factId={chipFact} onChange={update} onClose={() => setChipFact(null)} />
      <StyleGrid open={sheet === "styles"} onClose={() => setSheet(null)} stub={stub} onPick={(ed) => dealTo(ed)} />
      <RemixSheet open={sheet === "remix"} onClose={() => setSheet(null)} stub={stub} onChange={update} onDescribe={() => ask()} />
      <PaperSheet title="Ask the agent" open={sheet === "agent"} onClose={() => setSheet(null)}>
        <div className={styles.agentSheet}>
          <AgentChat key={agentSeed?.n ?? 0} stub={stub} onChange={update} initial={agentSeed?.text} />
        </div>
      </PaperSheet>
      <FinishSheet stub={stub} open={sheet === "finish"} onClose={() => setSheet(null)} />
      {tearing && <TearStage stub={stub} onTorn={onTorn} onCancel={() => setTearing(false)} />}
    </>
  );

  /* ---------------- Desktop ---------------- */
  if (desktop) {
    return (
      <div className={`${styles.root} desk-surface`}>
        <div className={styles.desk}>
          <header className={styles.deskHeader}>
            <div className={styles.crumb}>
              <Breadcrumbs className={styles.crumbs} />
              <h1 className={styles.crumbTitle}>{ev.title}</h1>
              {crumb && <p className={styles.crumbSub}>{crumb}</p>}
            </div>
            <PathTrack current="style" stubId={stub.id} className={styles.track} />
            <div className={styles.headerActions}>
              <PaperButton onClick={() => router.push(`/s/${shareToken}`)}>
                Share page
                <LeavesMark />
              </PaperButton>
            </div>
          </header>

          <div className={styles.deskGrid} data-rail={panels.rail ? "open" : "folded"} data-insp={panels.insp ? "open" : "folded"}>
            <aside className={styles.rail} data-folded={!panels.rail || undefined} aria-label="Styles">
              <div className={styles.panelHead}>
                <h2 className={styles.railTitle}>Styles</h2>
                <button
                  type="button"
                  className={styles.fold}
                  aria-label={panels.rail ? "Fold the styles column" : "Open the styles column"}
                  title={panels.rail ? "Fold the styles column (\\)" : "Open the styles column (\\)"}
                  aria-expanded={panels.rail}
                  onClick={() => togglePanel("rail")}
                >
                  <HandleIcon open={panels.rail} />
                </button>
              </div>
              <div className={styles.railBody} inert={!panels.rail}>
                <StyleGridItems stub={stub} onPick={dealTo} variant="rail" />
              </div>
            </aside>

            <main className={styles.deskCentre}>
              <div className={styles.matBar}>
                <div className={styles.matSwitch}>
                  <Switch
                    checked={preview}
                    onChange={setPreview}
                    hint={preview ? "Safe area and bleed stay on" : zoomed ? "Comes on by itself while zoomed in" : "Shows the safe area and the bleed"}
                  >
                    Print preview
                    <span className={styles.auto} data-on={(zoomed && !preview) || undefined}>
                      Auto
                    </span>
                  </Switch>
                </div>
                <span className={`desk-label ${styles.size}`}>
                  {editionLabel(edition)} · {sizeLabel}
                </span>
              </div>

              <div ref={matRef} className={styles.mat}>
                <div className={styles.rulerTop} data-cam-top aria-hidden="true">
                  <span className={styles.band} data-cam-band-t />
                  <span className={styles.hairX} data-cam-hx data-on="false" />
                </div>
                <div className={styles.rulerLeft} data-cam-left aria-hidden="true">
                  <span className={styles.band} data-cam-band-l />
                  <span className={styles.hairY} data-cam-hy data-on="false" />
                </div>
                <div className={styles.matBody} data-cam-body>
                  <div
                    ref={areaRef}
                    className={styles.area}
                    data-pressing={pressing || undefined}
                    style={stageVars}
                    tabIndex={0}
                    role="group"
                    aria-label="Cutting mat. Scroll to zoom, middle-drag or hold space to pan, 0 to fit."
                    {...stageHandlers}
                  >
                    <div className={styles.view}>
                      <div className={styles.world} data-cam-world>
                        <div className={styles.stageBox}>{deck("lg")}</div>
                      </div>
                      <AgentNotes
                        stub={stub}
                        onChange={update}
                        onAsk={ask}
                        onShowBack={showBack}
                        variant="pin"
                        folded={camAway && !peek}
                        onUnfold={() => {
                          play("open", { emphasis: "subtle" });
                          setPeek(true);
                        }}
                      />
                      <div className={styles.mini} data-cam-mini data-on="false" data-stub-area aria-hidden="true">
                        <span className={styles.miniStub} data-cam-mini-stub />
                        <span className={styles.miniView} data-cam-mini-view />
                      </div>
                    </div>
                    {toolbar}
                  </div>
                  <span className={styles.read} data-cam-read data-on="false" aria-hidden="true" />
                </div>
              </div>

              <div className={styles.deskFooter}>
                <div className={styles.footTools}>{tools}</div>
                <div className={styles.zoom} role="group" aria-label="Zoom">
                  <PaperButton aria-label="Zoom out" onClick={() => camera.zoomBy(1 / 1.25)}>
                    −
                  </PaperButton>
                  <span className={styles.zoomValue} data-cam-pct>
                    100%
                  </span>
                  <PaperButton aria-label="Zoom in" onClick={() => camera.zoomBy(1.25)}>
                    +
                  </PaperButton>
                  <PaperButton aria-label="Fit the stub to the mat" data-cam-fit className={styles.fit} onClick={camera.fit}>
                    Fit
                  </PaperButton>
                </div>
                <p className={styles.keys}>
                  Scroll to zoom · drag to pan · <kbd>0</kbd> fit · <kbd>Z</kbd> zoom to it · <kbd>←</kbd> <kbd>→</kbd> style · <kbd>F</kbd> flip · <kbd>{"\\"}</kbd> focus
                </p>
              </div>
            </main>

            <aside className={styles.inspector} data-folded={!panels.insp || undefined} aria-label="Inspector">
              <div className={styles.panelHead}>
                <button
                  type="button"
                  className={styles.fold}
                  aria-label={panels.insp ? "Fold the inspector" : "Open the inspector"}
                  title={panels.insp ? "Fold the inspector (\\)" : "Open the inspector (\\)"}
                  aria-expanded={panels.insp}
                  onClick={() => togglePanel("insp")}
                >
                  <HandleIcon open={!panels.insp} />
                </button>
                <h2 className={styles.railTitle}>Inspector</h2>
              </div>
              <div className={styles.inspBody} inert={!panels.insp}>
                <div className={styles.inspectorScroll}>
                  <Inspector stub={stub} selected={selected} onChange={update} onDeselect={() => setSelected(null)} onRemix={() => setSheet("remix")} onFixFact={setChipFact} />
                </div>
                <div className={styles.inspectorTray}>
                  <Tray stub={stub} onChange={update} onTear={onTear} compact />
                </div>
              </div>
            </aside>
          </div>
        </div>
        {overlays}
      </div>
    );
  }

  /* ---------------- Phone ---------------- */
  return (
    <div className={`${styles.root} desk-surface`}>
      <div className={styles.phone}>
        <header className={styles.topBar}>
          <Breadcrumbs className={styles.crumbs} />
          <h1 className={styles.title}>{ev.title}</h1>
        </header>
        <PathTrack current="style" stubId={stub.id} className={styles.track} />

        <section
          ref={areaRef}
          className={styles.stage}
          data-pressing={pressing || undefined}
          style={stageVars}
          aria-label={`Your stub, ${editionLabel(edition)} style. Swipe for another style, hold for all styles.`}
          {...stageHandlers}
        >
          {deck("lg")}
          {toolbar}
        </section>

        <div className={styles.caption}>
          <div className={styles.dots} role="group" aria-label="Styles">
            {EDITIONS.map((ed, i) => (
              <button key={ed} type="button" className={styles.dot} aria-label={`${editionLabel(ed)} style`} aria-current={i === index} onClick={() => dealTo(ed)} />
            ))}
          </div>
          <p className={styles.styleName}>
            {editionLabel(edition)}
            <span> · swipe for more</span>
          </p>
        </div>
        {hiddenRow}

        <AgentNotes stub={stub} onChange={update} onAsk={ask} onShowBack={showBack} variant="card" />

        <div className={styles.toolsWrap}>{tools}</div>

        <div className={styles.trayWrap}>
          <Tray stub={stub} onChange={update} onTear={onTear} />
        </div>
      </div>
      {overlays}
    </div>
  );
}
