"use client";
import { useEffect, useId, useMemo, useState } from "react";
import { FinishSwatches, Field, PaperButton, PunchTabs, Rule, SandboxStrip, SourceMark, Stamp, Stamped, Tag, Tags, TearLink, type FinishValue } from "@/customer/desk/Desk";
import d from "@/customer/desk/Desk.module.css";
import { StubView } from "@/customer/studio/stub/StubView";
import { haptic, play } from "@/customer/studio/feedback";
import { holoAllowed } from "@/customer/studio/editor/ops";
import { EDITIONS, MATERIALS, formatMoney, withGuestName, type Edition, type Finish, type Material, type Stub } from "@/customer/studio/types";
import { ApiError, api, type OrganizerEventReply } from "@/customer/account/api";
import { placeOrder } from "@/customer/account/orders";
import { openSignIn } from "@/customer/account/signin";
import { useAccount } from "@/customer/account/useAccount";
import { absoluteUrl, copyText } from "@/customer/pages/share";
import { PageShell, CopyField, OnDesk, PaperLink, TearAnchor, ui } from "@/customer/pages/ui";
import { FINISHES, SANDBOX_LABEL, SIZE_LABEL, defaultSize, quote, sizesFor, type PrintSize } from "@/customer/pages/commerce";
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
const MATERIAL_OPTIONS = MATERIALS.map((m) => ({ value: m.id, label: m.label, sub: formatMoney(m.priceMinor) }));

/** "Classic stub · 2 × 5.5 in" becomes a tab ("Classic stub") with its dimensions beneath, as at checkout. */
const sizeOption = (sz: PrintSize) => {
  const [label, sub] = SIZE_LABEL[sz].split(" · ");
  return { value: sz, label, sub };
};
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

/** Signing in leaves the page, so the work in progress waits in the browser for the trip. It is used once. */
const DRAFT_KEY = "ticketstub.organizer.draft.v1";
const DRAFT_MAX_AGE = 30 * 60_000;
interface Draft {
  at: number;
  design: OrganizerDesign;
  list: GuestList | null;
  fileName: string;
  map: ColumnMap;
  material: Material;
  finish: Finish;
  sizePick: PrintSize | null;
  publish: "print" | "claim";
}
function takeDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    localStorage.removeItem(DRAFT_KEY);
    const d = raw ? (JSON.parse(raw) as Draft) : null;
    return d && Date.now() - d.at < DRAFT_MAX_AGE && d.design ? d : null;
  } catch {
    return null;
  }
}

/** Pick which CSV column fills a part of the stub: the columns are paper tags, the chosen one is dark. */
/** One claim link per guest, each with its own copy button, and one button for the whole list. */
function GuestLinks({ claims }: { claims: OrganizerEventReply["claims"] }) {
  const [all, setAll] = useState(false);
  const [status, setStatus] = useState("");
  const shown = all ? claims : claims.slice(0, 5);
  const url = (token: string) => absoluteUrl(`/claim/g/${token}`);
  const note = async (text: string, ok: boolean) => setStatus(ok ? text : "Couldn't copy. Select the link and copy it.");
  return (
    <div className={s.links}>
      <ul className={s.linkList}>
        {shown.map((c) => (
          <li key={c.token} className={s.linkRow}>
            <span className={s.linkName}>
              {c.name}
              {c.seat ? <span className={s.linkSeat}> · {c.seat}</span> : null}
            </span>
            <TearLink type="button" aria-label={`Copy ${c.name}'s link`} onClick={async () => note(`Copied ${c.name}'s link.`, await copyText(url(c.token)))}>
              Copy link
            </TearLink>
          </li>
        ))}
      </ul>
      {claims.length > 5 && !all ? (
        <TearLink type="button" onClick={() => setAll(true)}>
          Show all {claims.length}
        </TearLink>
      ) : null}
      <PaperButton
        type="button"
        onClick={async () => note(`Copied ${claims.length} links as name, seat, link.`, await copyText(claims.map((c) => [c.name, c.seat ?? "", url(c.token)].join(",")).join("\n")))}
      >
        Copy all {claims.length} as a list
      </PaperButton>
      <p className={ui.status} aria-live="polite">
        {status}
      </p>
    </div>
  );
}

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
  // Material, finish and size are chosen the way a fan chooses them at checkout, and priced by the same quote().
  const [material, setMaterial] = useState<Material>("print");
  const [finish, setFinish] = useState<Finish>("foil");
  const [sizePick, setSizePick] = useState<PrintSize | null>(null);
  const { status: acct, account } = useAccount();
  const [events, setEvents] = useState<OrganizerEventReply | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const [resumed, setResumed] = useState(false);

  // Back from the emailed link: put the design, the guest list and the choices back as they were.
  useEffect(() => {
    const d = takeDraft();
    if (!d) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setDesign(d.design);
    setList(d.list);
    setFileName(d.fileName);
    setMap(d.map);
    setMaterial(d.material);
    setFinish(d.finish);
    setSizePick(d.sizePick);
    setPublish(d.publish);
    setStep(3);
    setResumed(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

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
  // Each one carries the guest's name (printed "Admit · name" on the front) and the material and finish being priced.
  const issue = (st: Stub, name: string): Stub => ({ ...withGuestName(st, name), material, finish });
  const guestStubs = useMemo(
    () => guests.map((g, i) => issue(designStub(design, { id: `${design.setId}-${i}`, seat: seatLabel(g) }), g.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [guests, design, material, finish],
  );

  const sampleGuest = guests[0] ?? SAMPLE_GUEST;
  const inspect = step === 2 && guestStubs.length ? Math.min(page, guestStubs.length - 1) : -1;
  const preview = useMemo(
    () => (inspect >= 0 ? guestStubs[inspect] : issue(designStub(design, { id: "org-preview", seat: seatLabel(sampleGuest) }), sampleGuest.name)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [inspect, guestStubs, design, sampleGuest, material, finish],
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
  const physical = material !== "digital";
  const sizes = sizesFor(material);
  const size: PrintSize = sizePick && sizes.includes(sizePick) ? sizePick : defaultSize(preview, material);
  const each = quote(material, finish, size);
  const run = quote(material, finish, size, n);
  const total = run.totalMinor;
  const prices = Object.fromEntries(FINISHES.map((f) => [f.id, !physical || f.upchargeMinor === 0 ? "Included" : `+${formatMoney(f.upchargeMinor)}`])) as Record<FinishValue, string>;
  const materialLabel = MATERIALS.find((m) => m.id === material)?.label ?? material;
  const finishLabel = FINISHES.find((f) => f.id === finish)?.label ?? finish;
  const verb = physical ? "Print" : "Send";

  function startRun() {
    if (!ordered) {
      void placeOrder({
        stubIds: guests.map((_, i) => `${design.setId}-${i}`),
        lines: [{ title: `${design.title} · ${n} guest stubs`, material, finish, size, totalMinor: total }],
        totalMinor: total,
        quoteId: run.quoteId,
        method: "organizer-print",
        email: account?.email,
      }).then((p) => setOrdered(p.order.id));
    }
    setRunning(true);
  }

  /** Publishing keeps the guest links on the server, so it needs an account. Signed out, the sheet opens first. */
  async function publishClaims() {
    if (acct !== "in") {
      try {
        const draft: Draft = { at: Date.now(), design, list, fileName, map, material, finish, sizePick, publish };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch {
        /* storage full: the sign-in still works, the design just starts over */
      }
      openSignIn({
        reason: "claim",
        returnTo: "/organizer",
        title: "Sign in to publish",
        lede: "Guest links live in your account, so you can find them again. We'll email you a link.",
      });
      return;
    }
    setPublishing(true);
    setPublishError("");
    try {
      const base = { ...designStub(design, { id: `${design.setId}-base` }), material, finish };
      const res = await api.publishEvent(
        design.title,
        base,
        guests.map((g) => ({ name: g.name, seat: g.seat })),
      );
      setEvents(res);
      setPublished(true);
      play("success");
      haptic([18, 40, 28]);
    } catch (e) {
      const err = e as ApiError;
      setPublishError(err.status === 401 ? "Your session ran out. Sign in again to publish." : "We couldn't publish just now. Your design and guest list are still here. Try again in a moment.");
    } finally {
      setPublishing(false);
    }
  }

  // Back from sign-in with the draft restored: publish without asking twice.
  const [autoDone, setAutoDone] = useState(false);
  useEffect(() => {
    if (!resumed || autoDone || acct !== "in" || publish !== "claim" || n === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAutoDone(true);
    void publishClaims();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumed, autoDone, acct, publish, n]);

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
                  { value: "print" as const, label: `${verb} all ${n}`, sub: `${formatMoney(each.itemMinor + each.finishMinor)} each` },
                  { value: "claim" as const, label: "Claim link", sub: "Free" },
                ]}
                value={publish}
                onChange={setPublish}
              />

              {publish === "print" ? (
                <div className={s.publish}>
                  <p className={ui.muted}>
                    {physical ? "We print every guest's stub with their name and seat, one after another." : "Every guest gets their stub on screen and as a wallet pass, with their name and seat."}
                  </p>

                  <div className={s.group}>
                    <span className="desk-label">Material</span>
                    <PunchTabs
                      label="Material"
                      options={MATERIAL_OPTIONS}
                      value={material}
                      onChange={(m: Material) => {
                        setMaterial(m);
                        if (finish === "holo" && !holoAllowed(m)) setFinish("foil");
                        setOrdered(null);
                      }}
                    />
                  </div>
                  <div className={s.group}>
                    <span className="desk-label">Finish</span>
                    <FinishSwatches
                      value={finish}
                      prices={prices}
                      onChange={(f) => {
                        // Holo only exists on Print and Framed, so choosing it moves the stock up and the price shows it.
                        if (f === "holo" && !holoAllowed(material)) setMaterial("print");
                        setFinish(f);
                        setOrdered(null);
                      }}
                    />
                    <p className={ui.status} aria-live="polite">
                      {!physical ? "On screen and on the wallet pass, every finish is included." : holoAllowed(material) ? "Holo is on Print and Framed." : "Holo comes on Print and Framed. Choosing it moves you to Print."}
                    </p>
                  </div>
                  {sizes.length > 1 ? (
                    <div className={s.group}>
                      <span className="desk-label">Size</span>
                      <PunchTabs label="Size" options={sizes.map(sizeOption)} value={size} onChange={(v) => (setSizePick(v), setOrdered(null))} />
                    </div>
                  ) : null}

                  <Rule kind="perf" />
                  <dl className={s.receipt}>
                    <div className={s.runLine}>
                      <dt>
                        {n} × {materialLabel}, per guest
                      </dt>
                      <dd>{formatMoney(run.itemMinor)}</dd>
                    </div>
                    {run.finishMinor ? (
                      <div className={s.runLine}>
                        <dt>
                          {n} × {finishLabel} finish
                        </dt>
                        <dd>{formatMoney(run.finishMinor)}</dd>
                      </div>
                    ) : null}
                    {physical ? (
                      <div className={s.runLine}>
                        <dt>Shipping, once</dt>
                        <dd>
                          {formatMoney(run.shippingMinor)}
                          <SourceMark p="estimated" />
                        </dd>
                      </div>
                    ) : null}
                    <div className={`${s.runLine} ${s.runTotal}`}>
                      <dt>
                        Total for {n} {n === 1 ? "guest" : "guests"}
                      </dt>
                      <dd>{formatMoney(total)}</dd>
                    </div>
                  </dl>
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
                      {verb} all {n}
                    </Stamp>
                  )}
                </div>
              ) : (
                <div className={s.publish}>
                  <p className={ui.muted}>Each guest gets their own link. It signs them in with their email and puts their named stub on their wall. Links last 30 days.</p>
                  {published && events ? (
                    <div className={s.done}>
                      <Stamped>Published</Stamped>
                      <GuestLinks claims={events.claims} />
                    </div>
                  ) : published ? (
                    <div className={s.done}>
                      <Stamped>Published</Stamped>
                      <CopyField path={claimPath} label="Guest claim link" />
                      <PaperLink href={claimPath}>Preview the guest page</PaperLink>
                    </div>
                  ) : (
                    <>
                      <Stamp block disabled={publishing || n === 0} onClick={() => void publishClaims()}>
                        {publishing ? "Publishing" : acct === "in" ? `Publish ${n} guest ${n === 1 ? "link" : "links"}` : "Sign in to publish"}
                      </Stamp>
                      {publishError ? (
                        <p className={ui.err} role="alert">
                          {publishError}
                        </p>
                      ) : null}
                      <TearLink type="button" onClick={() => setPublished(true)}>
                        Share one link without guest names
                      </TearLink>
                    </>
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
              <StubView stub={preview} size="lg" tilt />
            </OnDesk>
          ) : null}
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
