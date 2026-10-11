"use client";
import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { StubView } from "@/customer/studio/stub/StubView";
import { FitBox } from "@/customer/pages/FitBox";
import { play, haptic } from "@/customer/studio/feedback";
import { EDITIONS, formatMoney, type Edition } from "@/customer/studio/types";
import { PageShell, CopyField, SandboxBadge, ui } from "@/customer/pages/ui";
import { addOrder } from "@/customer/pages/commerce";
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
import { LockIcon } from "./LockIcon";
import s from "./organizer.module.css";

const STEPS = ["Design", "Guest list", "Check", "Publish"] as const;
const PER_STUB_MINOR = 800;
const EDITION_LABEL: Record<Edition, string> = {
  researched: "Researched",
  letterpress: "Letterpress",
  risograph: "Risograph",
  minimal: "Minimal",
  classic: "Classic",
};

export default function OrganizerClient() {
  const mounted = useMounted();
  const ids = { org: useId(), file: useId(), title: useId(), name: useId(), seat: useId(), extra: useId() };
  const [step, setStep] = useState(0);
  const [design, setDesign] = useState<OrganizerDesign>(() => defaultDesign());
  const [list, setList] = useState<GuestList | null>(null);
  const [fileName, setFileName] = useState("");
  const [map, setMap] = useState<ColumnMap>({ name: 0, seat: -1, extra: -1 });
  const [page, setPage] = useState(0);
  const [publish, setPublish] = useState<"print" | "claim" | null>(null);
  const [ordered, setOrdered] = useState<string | null>(null);
  const [fileError, setFileError] = useState("");

  const guests = useMemo(
    () =>
      (list?.rows ?? [])
        .map((r) => ({ name: r[map.name] ?? "", seat: map.seat >= 0 ? r[map.seat] : undefined, extra: map.extra >= 0 ? r[map.extra] : undefined }))
        .filter((g) => g.name),
    [list, map],
  );
  const n = guests.length;
  const current = guests[Math.min(page, Math.max(0, n - 1))];

  const preview = useMemo(() => {
    if (step === 2 && current) return designStub(design, { id: "org-preview", name: current.name, seat: current.seat ? `Seat ${current.seat}` : undefined });
    return designStub(design, { id: "org-preview" });
  }, [design, step, current]);

  function patch(p: Partial<OrganizerDesign>) {
    setDesign((d) => ({ ...d, ...p }));
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
    play("drop");
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
    play("tick");
  }

  const canNext = step === 0 || (step === 1 && n > 0) || step === 2;
  const claimPath = `/organizer/claim?d=${encodeDesign(design)}`;

  const colSelect = (id: string, label: string, value: number, onChange: (v: number) => void, optional = false) => (
    <div className={ui.field}>
      <label htmlFor={id} className={ui.fieldLabel}>
        {label}
      </label>
      <select id={id} className={ui.input} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {optional ? <option value={-1}>None</option> : null}
        {list?.headers.map((h, i) => (
          <option key={i} value={i}>
            {h || `Column ${i + 1}`}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <PageShell title="Organizer" right={<SandboxBadge text="Sandbox · no real charge" />}>
      <div className={s.intro}>
        <h1 className={ui.h1}>Upload your guest list. Every guest gets their own stub.</h1>
      </div>

      <nav aria-label="Steps" className={s.steps}>
        <ol>
          {STEPS.map((label, i) => (
            <li key={label}>
              <button
                type="button"
                className={s.stepBtn}
                aria-current={step === i ? "step" : undefined}
                disabled={i > 1 && n === 0}
                onClick={() => go(i)}
              >
                <span className={`${s.stepNo} num`}>{i + 1}</span> {label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <div className={s.layout}>
        <section className={s.panel} aria-labelledby="step-h">
          <h2 id="step-h" className={ui.h2}>
            {step + 1}. {STEPS[step]}
          </h2>

          {step === 0 ? (
            <div className={ui.stack}>
              <div className={ui.field}>
                <label htmlFor={ids.org} className={ui.fieldLabel}>
                  Organizer name
                </label>
                <input id={ids.org} className={ui.input} value={design.organizer} maxLength={40} onChange={(e) => patch({ organizer: e.target.value })} placeholder="Your organization" />
              </div>
              <div className={ui.field}>
                <label htmlFor={ids.title} className={ui.fieldLabel}>
                  Event title
                </label>
                <input id={ids.title} className={ui.input} value={design.title} maxLength={48} onChange={(e) => patch({ title: e.target.value })} />
              </div>
              <div className={ui.field}>
                <span className={ui.fieldLabel} id="ed-l">
                  Style
                </span>
                <div className={ui.row} role="group" aria-labelledby="ed-l">
                  {EDITIONS.map((ed) => (
                    <button
                      key={ed}
                      type="button"
                      className={`chip ${s.tall}`}
                      aria-pressed={design.edition === ed}
                      onClick={() => {
                        const second = design.allowed[1] === ed ? design.allowed[0] : design.allowed[1];
                        patch({ edition: ed, allowed: [ed, second === ed ? (ed === "minimal" ? "classic" : "minimal") : second] });
                        play("flick");
                      }}
                    >
                      {EDITION_LABEL[ed]}
                    </button>
                  ))}
                </div>
              </div>
              <div className={ui.field}>
                <span className={ui.fieldLabel} id="ed2-l">
                  Guests can also pick
                </span>
                <div className={ui.row} role="group" aria-labelledby="ed2-l">
                  {EDITIONS.filter((e) => e !== design.edition).map((ed) => (
                    <button key={ed} type="button" className={`chip ${s.tall}`} aria-pressed={design.allowed[1] === ed} onClick={() => patch({ allowed: [design.edition, ed] })}>
                      {EDITION_LABEL[ed]}
                    </button>
                  ))}
                </div>
              </div>
              <fieldset className={s.locks}>
                <legend className={ui.fieldLabel}>Lock for guests</legend>
                {(["logo", "title"] as const).map((k) => (
                  <label key={k} className={s.lockRow}>
                    <input type="checkbox" checked={design.locks[k]} onChange={(e) => patch({ locks: { ...design.locks, [k]: e.target.checked } })} />
                    <LockIcon open={!design.locks[k]} />
                    <span>{k === "logo" ? "Logo" : "Title"}</span>
                    <span className={ui.muted}>{design.locks[k] ? "Locked" : "Guests can change it"}</span>
                  </label>
                ))}
              </fieldset>
            </div>
          ) : null}

          {step === 1 ? (
            <div className={ui.stack}>
              <div className={s.drop}>
                <label htmlFor={ids.file} className="btn btn-primary">
                  Choose a CSV file
                </label>
                <input id={ids.file} type="file" accept=".csv,text/csv" className="visually-hidden" onChange={(e) => onFile(e.currentTarget.files?.[0])} />
                <button type="button" className="btn btn-quiet" onClick={() => loadText(SAMPLE_CSV, "sample-guests.csv")}>
                  Use a sample list
                </button>
                <p className={ui.muted}>A header row and one guest per line. We read it on this device; nothing is uploaded.</p>
              </div>
              {fileError ? (
                <p className={s.err} role="alert">
                  {fileError}
                </p>
              ) : null}
              {list ? (
                <>
                  <p>
                    <strong>{fileName}</strong> · <span className="num">{n}</span> {n === 1 ? "guest" : "guests"}
                  </p>
                  <div className={s.mapGrid}>
                    {colSelect(ids.name, "Name chip", map.name, (v) => setMap((m) => ({ ...m, name: v })))}
                    {colSelect(ids.seat, "Seat chip", map.seat, (v) => setMap((m) => ({ ...m, seat: v })), true)}
                    {colSelect(ids.extra, "Extra chip", map.extra, (v) => setMap((m) => ({ ...m, extra: v })), true)}
                  </div>
                  <div className={s.tableWrap}>
                    <table className={s.table}>
                      <caption className="visually-hidden">First guests in the list</caption>
                      <thead>
                        <tr>
                          <th scope="col">Name</th>
                          <th scope="col">Seat</th>
                          <th scope="col">Extra</th>
                        </tr>
                      </thead>
                      <tbody>
                        {guests.slice(0, 5).map((g, i) => (
                          <tr key={i}>
                            <td>{g.name}</td>
                            <td>{g.seat ?? "—"}</td>
                            <td>{g.extra ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {n > 5 ? <p className={ui.muted}>And {n - 5} more.</p> : null}
                </>
              ) : null}
            </div>
          ) : null}

          {step === 2 && current ? (
            <div className={ui.stack}>
              <p>Check each guest&apos;s stub before you publish.</p>
              <div className={s.pager}>
                <button type="button" className="btn" aria-label="Previous guest" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))}>
                  ‹
                </button>
                <p className="num" aria-live="polite">
                  {current.seat ? `Seat ${current.seat} — ` : ""}
                  {current.name}, {page + 1} / {n}
                </p>
                <button type="button" className="btn" aria-label="Next guest" disabled={page >= n - 1} onClick={() => setPage((p) => Math.min(n - 1, p + 1))}>
                  ›
                </button>
              </div>
              {current.extra ? <span className="chip">{current.extra}</span> : null}
            </div>
          ) : null}

          {step === 3 ? (
            <div className={ui.stack}>
              <button type="button" className={s.choice} aria-pressed={publish === "print"} onClick={() => setPublish("print")}>
                <strong>
                  Print all {n} · {formatMoney(PER_STUB_MINOR)} each
                </strong>
                <span>We print every guest&apos;s stub with their name and seat.</span>
              </button>
              <button type="button" className={s.choice} aria-pressed={publish === "claim"} onClick={() => setPublish("claim")}>
                <strong>Share a claim link</strong>
                <span>Each guest claims their stub and personalizes it within your locks.</span>
              </button>

              {publish === "print" ? (
                <div className={ui.card}>
                  <p className={s.totalLine}>
                    <span>
                      {n} × {formatMoney(PER_STUB_MINOR)}
                    </span>
                    <strong className="num">{formatMoney(PER_STUB_MINOR * n)}</strong>
                  </p>
                  <SandboxBadge />
                  {ordered ? (
                    <p role="status">
                      Sandbox order {ordered} created. No real charge and nothing was sent to a printer.
                    </p>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-primary btn-block"
                      onClick={() => {
                        const o = addOrder({
                          stubIds: guests.map((_, i) => `${design.setId}-${i}`),
                          lines: [{ title: `${design.title} · ${n} guest stubs`, material: "print", finish: "matte", size: "classic", totalMinor: PER_STUB_MINOR * n }],
                          totalMinor: PER_STUB_MINOR * n,
                          method: "organizer-print",
                        });
                        setOrdered(o.id);
                        play("stamp");
                        haptic([18, 40, 28]);
                      }}
                    >
                      Print all {n} for {formatMoney(PER_STUB_MINOR * n)}
                    </button>
                  )}
                </div>
              ) : null}
              {publish === "claim" ? (
                <div className={ui.card}>
                  <CopyField path={claimPath} label="Guest claim link" />
                  <Link className="btn" href={claimPath}>
                    Preview the guest page
                  </Link>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className={s.nav}>
            {step > 0 ? (
              <button type="button" className="btn btn-quiet" onClick={() => go(step - 1)}>
                Back
              </button>
            ) : (
              <span />
            )}
            {step < 3 ? (
              <button type="button" className="btn btn-primary" disabled={!canNext} onClick={() => go(step + 1)}>
                {step === 0 ? "Add your guest list" : step === 1 ? "Check the stubs" : "Publish"}
              </button>
            ) : null}
          </div>
        </section>

        <aside className={s.previewCol} aria-label="Stub preview">
          {mounted ? (
            <FitBox>
              <StubView stub={preview} size="lg" tilt />
            </FitBox>
          ) : null}
          <ul className={s.lockList}>
            <li>
              <LockIcon open={!design.locks.logo} /> Logo {design.locks.logo ? "locked" : "open"}
            </li>
            <li>
              <LockIcon open={!design.locks.title} /> Title {design.locks.title ? "locked" : "open"}
            </li>
            <li>Styles: {design.allowed.map((e) => EDITION_LABEL[e]).join(" or ")}</li>
          </ul>
        </aside>
      </div>
    </PageShell>
  );
}
