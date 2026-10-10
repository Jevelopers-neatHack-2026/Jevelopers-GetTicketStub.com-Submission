"use client";
import { useId, useMemo, useState } from "react";
import { Field, PaperButton, PunchTabs, Rule, SandboxStrip, Stamp, Stamped, Tag, Tags, TearLink, Tool, Tools } from "@/customer/desk/Desk";
import d from "@/customer/desk/Desk.module.css";
import { FlipIcon } from "@/customer/desk/icons";
import { StubView } from "@/customer/studio/stub/StubView";
import { haptic, play } from "@/customer/studio/feedback";
import { EDITIONS, formatMoney, type Edition } from "@/customer/studio/types";
import { PageShell, CopyField, OnDesk, PaperLink, TearAnchor, ui } from "@/customer/pages/ui";
import { SANDBOX_LABEL, addOrder } from "@/customer/pages/commerce";
import {
  SAMPLE_CSV,
  autoMatch,
  defaultDesign,
  designStub,
  encodeDesign,
  parseCsv,
  type ColumnMap,
  type GuestList,
  type OrganizerDesign,
} from "@/customer/pages/organizer";
import { useMounted } from "@/customer/pages/useMounted";
import { LockSwitch, Padlock } from "./LockSwitch";
import { PrintRun } from "./PrintRun";
import s from "./organizer.module.css";

const STEPS = ["Design", "Guest list", "Check", "Publish"] as const;
const PER_STUB_MINOR = 800;
const SAMPLE_GUEST = { name: "Priya Raman", seat: "A12" };
const PAGE = 12;
const EDITION_LABEL: Record<Edition, string> = {
  researched: "Researched",
  letterpress: "Letterpress",
  risograph: "Risograph",
  minimal: "Minimal",
  classic: "Classic",
};

type Guest = { name: string; seat?: string; extra?: string };

/** Pick which CSV column fills a part of the stub: the columns are paper tags, the chosen one is dark. */
function ColumnTags({ label, headers, value, onChange, optional }: { label: string; headers: string[]; value: number; onChange: (v: number) => void; optional?: boolean }) {
  return (
    <div className={s.colRow}>
      <span className="desk-label">{label}</span>
      <Tags label={`${label} column`}>
        {optional ? (
          <Tag pressed={value === -1} onClick={() => onChange(-1)}>
            None
          </Tag>
        ) : null}
        {headers.map((h, i) => (
          <Tag key={i} pressed={value === i} onClick={() => onChange(i)}>
            {h || `Column ${i + 1}`}
          </Tag>
        ))}
      </Tags>
    </div>
  );
}

export default function OrganizerClient() {
  const mounted = useMounted();
  const fileId = useId();
  const [step, setStep] = useState(0);
  const [design, setDesign] = useState<OrganizerDesign>(() => defaultDesign());
  const [list, setList] = useState<GuestList | null>(null);
  const [fileName, setFileName] = useState("");
  const [map, setMap] = useState<ColumnMap>({ name: 0, seat: -1, extra: -1 });
  const [page, setPage] = useState(0);
  const [shown, setShown] = useState(PAGE);
  const [publish, setPublish] = useState<"print" | "claim">("print");
  const [ordered, setOrdered] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [published, setPublished] = useState(false);
  const [fileError, setFileError] = useState("");
  const [over, setOver] = useState(false);
  const [flipped, setFlipped] = useState(false);

  const guests = useMemo<Guest[]>(
    () =>
      (list?.rows ?? [])
        .map((r) => ({ name: r[map.name] ?? "", seat: map.seat >= 0 ? r[map.seat] : undefined, extra: map.extra >= 0 ? r[map.extra] : undefined }))
        .filter((g) => g.name),
    [list, map],
  );
  const n = guests.length;
  const seatLabel = (g: Guest) => (g.seat ? `Seat ${g.seat}` : undefined);

  // One stub per guest: the contact sheet, the preview and the print run all draw from these.
  const guestStubs = useMemo(() => guests.map((g, i) => designStub(design, { id: `${design.setId}-${i}`, name: g.name, seat: seatLabel(g) })), [guests, design]);

  const sampleGuest = guests[0] ?? SAMPLE_GUEST;
  const inspect = step === 2 && guestStubs.length ? Math.min(page, guestStubs.length - 1) : -1;
  const preview = useMemo(
    () => (inspect >= 0 ? guestStubs[inspect] : designStub(design, { id: "org-preview", name: sampleGuest.name, seat: seatLabel(sampleGuest) })),
    [inspect, guestStubs, design, sampleGuest],
  );
  const previewCaption = inspect >= 0 ? `${guests[inspect].name}, guest ${inspect + 1} of ${n}` : guests.length ? `Shown with ${sampleGuest.name}, your first guest.` : `Shown with a sample guest, ${sampleGuest.name}.`;

  function patch(p: Partial<OrganizerDesign>) {
    setDesign((x) => ({ ...x, ...p }));
  }

  function loadText(text: string, name: string) {
    const parsed = parseCsv(text);
    if (parsed.headers.length === 0 || parsed.rows.length === 0) {
      setFileError("We couldn't find any guests in that file. Use a CSV with a header row, like name,seat.");
      return;
    }
    setFileError("");
    setList(parsed);
    setFileName(name);
    setMap(autoMatch(parsed.headers));
    setPage(0);
    setShown(PAGE);
    setOrdered(null);
    setPublished(false);
    play("drop");
    haptic(10);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    try {
      loadText(await file.text(), file.name);
    } catch {
      setFileError("We couldn't read that file. Try saving it as CSV.");
    }
  }

  function go(i: number) {
    setStep(i);
    play("select", { direction: i > step ? "forward" : "back" });
  }

  const canNext = step === 0 || (step === 1 && n > 0) || step === 2;
  const claimPath = `/organizer/claim?d=${encodeDesign(design)}`;
  const total = PER_STUB_MINOR * n;

  function startRun() {
    if (!ordered) {
      const o = addOrder({
        stubIds: guests.map((_, i) => `${design.setId}-${i}`),
        lines: [{ title: `${design.title} · ${n} guest stubs`, material: "print", finish: "matte", size: "classic", totalMinor: total }],
        totalMinor: total,
        method: "organizer-print",
      });
      setOrdered(o.id);
    }
    setRunning(true);
  }

  const stepNav = (
    <nav aria-label="Steps" className={s.steps}>
      <ol>
        {STEPS.map((label, i) => {
          const locked = i > 1 && n === 0;
          return (
            <li key={label} data-state={i < step ? "done" : i === step ? "now" : "next"}>
              <button type="button" className={s.stepBtn} aria-current={step === i ? "step" : undefined} disabled={locked} onClick={() => i !== step && go(i)}>
                <span className={s.stepNo}>{i < step ? <Tick /> : i + 1}</span>
                <span className={s.stepLabel}>{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );

  return (
    <PageShell title="Organizer">
      <header className={s.intro}>
        <h1 className={s.title}>
          <span className={s.line}>Upload your guest list.</span> <span className={s.line}>Every guest gets their own stub.</span>
        </h1>
        <p className={ui.lede}>Design one stub, drop in the guest list, then print every guest&apos;s or share a link they claim from.</p>
      </header>

      {stepNav}

      <div className={s.layout} data-step={step}>
        <section className={s.panel} aria-labelledby="step-h">
          <h2 id="step-h" className={s.stepTitle}>
            <span className={s.stepTitleNo}>{step + 1}</span>
            {STEPS[step]}
          </h2>

          {step === 0 ? (
            <div className={s.body}>
              <Field id="org-name" label="Organizer name" value={design.organizer} maxLength={40} onChange={(e) => patch({ organizer: e.target.value })} placeholder="Your organization" />
              <Field id="org-title" label="Event title" value={design.title} maxLength={48} onChange={(e) => patch({ title: e.target.value })} />

              <div className={s.group}>
                <span className="desk-label" id="ed-l">
                  Style
                </span>
                <Tags label="Style">
                  {EDITIONS.map((ed) => (
                    <Tag
                      key={ed}
                      pressed={design.edition === ed}
                      onClick={() => {
                        const second = design.allowed[1] === ed ? design.allowed[0] : design.allowed[1];
                        patch({ edition: ed, allowed: [ed, second === ed ? (ed === "minimal" ? "classic" : "minimal") : second] });
                      }}
                    >
                      {EDITION_LABEL[ed]}
                    </Tag>
                  ))}
                </Tags>
              </div>

              <div className={s.group}>
                <span className="desk-label">Guests can also pick</span>
                <Tags label="Second style guests can pick">
                  {EDITIONS.filter((e) => e !== design.edition).map((ed) => (
                    <Tag key={ed} pressed={design.allowed[1] === ed} onClick={() => patch({ allowed: [design.edition, ed] })}>
                      {EDITION_LABEL[ed]}
                    </Tag>
                  ))}
                </Tags>
              </div>

              <Rule kind="perf" />

              <div className={s.locks}>
                <LockSwitch locked={design.locks.logo} onChange={(v) => patch({ locks: { ...design.locks, logo: v } })} hint={design.locks.logo ? "Guests can't change it" : "Guests can change it"}>
                  Lock the logo
                </LockSwitch>
                <LockSwitch locked={design.locks.title} onChange={(v) => patch({ locks: { ...design.locks, title: v } })} hint={design.locks.title ? "Guests can't change it" : "Guests can change it"}>
                  Lock the title
                </LockSwitch>
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className={s.body}>
              <div
                className={s.tray}
                data-over={over ? "" : undefined}
                data-filled={list ? "" : undefined}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(true);
                }}
                onDragLeave={() => setOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(false);
                  void onFile(e.dataTransfer.files?.[0]);
                }}
              >
                <div className={s.trayBack} aria-hidden>
                  <span className={s.trayPaper}>
                    <span className={s.trayLines} />
                    <span className={s.trayTag}>CSV</span>
                  </span>
                </div>
                <div className={s.trayLip}>
                  {list ? (
                    <p className={s.trayName} role="status">
                      <Stamped key={fileName}>Loaded</Stamped>
                      <span>
                        {fileName} · <span className={ui.num}>{n}</span> {n === 1 ? "guest" : "guests"}
                      </span>
                    </p>
                  ) : (
                    <p className={s.trayHint}>{over ? "Let go to drop it in the tray." : "Drop your guest list here."}</p>
                  )}
                </div>
              </div>
              <div className={s.trayActions}>
                <label className={`${d.paper} ${s.filePick}`}>
                  Choose a CSV file
                  <input id={fileId} type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.currentTarget.files?.[0])} />
                </label>
                <TearLink type="button" onClick={() => loadText(SAMPLE_CSV, "sample-guests.csv")}>
                  Use a sample list
                </TearLink>
              </div>
              <p className={ui.status}>A header row, then one guest per line. We read it on this device; nothing is uploaded.</p>
              {fileError ? (
                <p className={ui.err} role="alert">
                  {fileError}
                </p>
              ) : null}

              {list ? (
                <>
                  <Rule kind="perf" />
                  <div className={s.match}>
                    <p className={ui.muted}>Match your columns to the stub. The dark tag is the one in use.</p>
                    <ColumnTags label="Name" headers={list.headers} value={map.name} onChange={(v) => setMap((m) => ({ ...m, name: v }))} />
                    <ColumnTags label="Seat" headers={list.headers} value={map.seat} onChange={(v) => setMap((m) => ({ ...m, seat: v }))} optional />
                    <ColumnTags label="Extra" headers={list.headers} value={map.extra} onChange={(v) => setMap((m) => ({ ...m, extra: v }))} optional />
                  </div>
                  <div>
                    <p className="desk-label">First guests</p>
                    <ul className={s.firstGuests}>
                      {guests.slice(0, 3).map((g, i) => (
                        <li key={i}>
                          <span className={s.gName}>{g.name}</span>
                          <span className={s.gMeta}>{[g.seat, g.extra].filter(Boolean).join(" · ") || "No seat"}</span>
                        </li>
                      ))}
                    </ul>
                    {n > 3 ? <p className={ui.status}>And {n - 3} more.</p> : null}
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          {step === 2 && n > 0 ? (
            <div className={s.body}>
              <p className={ui.muted}>Every guest&apos;s stub, laid out. Tap one to look closer before you publish.</p>
              <div className={s.contact} role="group" aria-label="Contact sheet of every guest's stub">
                <p className={`desk-label ${s.contactHead}`}>
                  <span>Contact sheet</span>
                  <span className={ui.num}>
                    {n} {n === 1 ? "stub" : "stubs"}
                  </span>
                </p>
                <ul className={s.grid}>
                  {guestStubs.slice(0, shown).map((st, i) => (
                    <li key={st.id} style={{ ["--i" as string]: Math.min(i, 12) }}>
                      <button type="button" className={s.cell} aria-pressed={i === inspect} onClick={() => (setPage(i), play("select", { emphasis: "subtle" }))}>
                        <StubView stub={st} size="sm" />
                        <span className={s.gName}>{guests[i].name}</span>
                        {guests[i].seat ? <span className={s.gMeta}>Seat {guests[i].seat}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
                {shown < n ? (
                  <PaperButton type="button" onClick={() => setShown((v) => v + PAGE * 2)}>
                    Show {Math.min(PAGE * 2, n - shown)} more
                  </PaperButton>
                ) : null}
              </div>
            </div>
          ) : null}

          {step === 3 ? (
            <div className={s.body}>
              <SandboxStrip>{SANDBOX_LABEL}</SandboxStrip>
              <PunchTabs
                label="How to publish"
                options={[
                  { value: "print" as const, label: `Print all ${n}`, sub: `${formatMoney(PER_STUB_MINOR)} each` },
                  { value: "claim" as const, label: "Claim link", sub: "Free" },
                ]}
                value={publish}
                onChange={setPublish}
              />

              {publish === "print" ? (
                <div className={s.publish}>
                  <p className={ui.muted}>We print every guest&apos;s stub with their name and seat, one after another.</p>
                  <p className={s.runLine}>
                    <span>
                      {n} × {formatMoney(PER_STUB_MINOR)}
                    </span>
                    <strong>{formatMoney(total)}</strong>
                  </p>
                  {ordered ? (
                    <div className={s.done} role="status">
                      <Stamped>Published</Stamped>
                      <p className={ui.muted}>
                        Sandbox order <span className={ui.num}>{ordered}</span>. No real charge, and nothing went to a printer.
                      </p>
                      <TearLink type="button" onClick={() => setRunning(true)}>
                        Watch the run again
                      </TearLink>
                    </div>
                  ) : (
                    <Stamp block price={formatMoney(total)} onClick={startRun}>
                      Print all {n}
                    </Stamp>
                  )}
                </div>
              ) : (
                <div className={s.publish}>
                  <p className={ui.muted}>Each guest claims their own stub and personalizes it within your locks.</p>
                  {published ? (
                    <div className={s.done}>
                      <Stamped>Published</Stamped>
                      <CopyField path={claimPath} label="Guest claim link" />
                      <PaperLink href={claimPath}>Preview the guest page</PaperLink>
                    </div>
                  ) : (
                    <Stamp block onClick={() => setPublished(true)}>
                      Publish the claim link
                    </Stamp>
                  )}
                </div>
              )}
            </div>
          ) : null}

          <div className={s.nav}>
            {step > 0 ? (
              <TearLink type="button" onClick={() => go(step - 1)}>
                Back
              </TearLink>
            ) : (
              <TearAnchor href="/">Leave the organizer</TearAnchor>
            )}
            {step < 3 ? (
              <Stamp disabled={!canNext} onClick={() => go(step + 1)}>
                {step === 0 ? "Add your guest list" : step === 1 ? "Check the stubs" : "Publish"}
              </Stamp>
            ) : null}
          </div>
        </section>

        <aside className={s.previewCol} aria-label="Stub preview">
          {mounted ? (
            <OnDesk>
              <StubView stub={preview} size="lg" tilt flipped={flipped} />
            </OnDesk>
          ) : null}
          <div className={s.flipTool}>
            <Tools label="Preview">
              <Tool icon={<FlipIcon />} active={flipped} onClick={() => setFlipped((f) => !f)}>
                {flipped ? "Front" : "Guest name"}
              </Tool>
            </Tools>
          </div>
          <p className={s.caption}>{previewCaption}</p>
          <ul className={s.lockList}>
            <li>
              <Padlock locked={design.locks.logo} />
              Logo {design.locks.logo ? "locked" : "open"}
            </li>
            <li>
              <Padlock locked={design.locks.title} />
              Title {design.locks.title ? "locked" : "open"}
            </li>
          </ul>
          <p className={s.styles}>
            Styles: {design.allowed.map((e) => EDITION_LABEL[e]).join(" or ")}
          </p>
        </aside>
      </div>

      {running && ordered ? (
        <PrintRun
          stubs={guestStubs}
          names={guests.map((g) => g.name)}
          orderId={ordered}
          onClose={() => setRunning(false)}
          onClaim={() => {
            setRunning(false);
            setPublish("claim");
          }}
        />
      ) : null}
    </PageShell>
  );
}

function Tick() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m3.5 8.5 3 3 6-7" />
    </svg>
  );
}
