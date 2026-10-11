"use client";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { StubView } from "@/customer/studio/stub/StubView";
import { FitBox } from "@/customer/pages/FitBox";
import { play, haptic } from "@/customer/studio/feedback";
import { encodeStub, upsertStub } from "@/customer/studio/store";
import type { Edition } from "@/customer/studio/types";
import { PageShell, FriendlyError, ui } from "@/customer/pages/ui";
import { decodeDesign, designEvent, designStub } from "@/customer/pages/organizer";
import { photoToDataUrl } from "@/customer/pages/storyImage";
import { useMounted } from "@/customer/pages/useMounted";
import { LockIcon } from "../LockIcon";
import s from "./orgclaim.module.css";

const EDITION_LABEL: Record<Edition, string> = {
  researched: "Researched",
  letterpress: "Letterpress",
  risograph: "Risograph",
  minimal: "Minimal",
  classic: "Classic",
};

export default function OrganizerClaimClient({ token }: { token?: string }) {
  const router = useRouter();
  const mounted = useMounted();
  const nameId = useId();
  const noteId = useId();
  const photoId = useId();
  const design = useMemo(() => (mounted ? decodeDesign(token) : null), [mounted, token]);
  const [name, setName] = useState("");
  const [edition, setEdition] = useState<Edition | null>(null);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [claiming, setClaiming] = useState(false);

  const chosen = edition ?? design?.allowed[0] ?? "researched";
  const preview = useMemo(() => (design ? designStub(design, { id: "claim-preview", name: name.trim() || "Your name", edition: chosen }) : null), [design, name, chosen]);

  if (!mounted) return <PageShell>{null}</PageShell>;
  if (!design || !preview) {
    return (
      <PageShell>
        <FriendlyError title="We couldn't open this claim link." body="The link may be cut short. Ask the organizer to send it again." />
      </PageShell>
    );
  }

  const ev = designEvent(design);

  function claim() {
    const n = name.trim();
    if (!n) {
      setError("Add your name so it prints on your stub.");
      return;
    }
    setClaiming(true);
    const st = designStub(design!, { name: n, edition: chosen });
    st.id = Math.random().toString(36).slice(2, 10);
    st.torn = true;
    st.wallAngle = Math.round((Math.random() * 8 - 4) * 10) / 10;
    st.personal = { ...st.personal, note: note.trim() || undefined };
    st.photos = photo ? [photo] : [];
    upsertStub(st);
    play("stamp");
    haptic([20]);
    router.push(`/s/${encodeStub(st)}`);
  }

  return (
    <PageShell>
      <div className={s.layout}>
        <div className={s.preview}>
          <FitBox>
            <StubView stub={preview} size="md" tilt />
          </FitBox>
        </div>

        <form
          className={s.form}
          onSubmit={(e) => {
            e.preventDefault();
            claim();
          }}
        >
          <p className="label">{design.organizer ? `From ${design.organizer}` : "Your event stub"}</p>
          <h1 className={ui.h1}>Claim your stub from {ev.title}.</h1>

          <ul className={s.locked} aria-label="Set by the organizer">
            {design.locks.logo ? (
              <li>
                <LockIcon title="Locked" /> Logo · set by the organizer
              </li>
            ) : null}
            {design.locks.title ? (
              <li>
                <LockIcon title="Locked" /> Title: {ev.title}
              </li>
            ) : null}
          </ul>

          <div className={ui.field}>
            <label htmlFor={nameId} className={ui.fieldLabel}>
              Name on your stub
            </label>
            <input
              id={nameId}
              className={ui.input}
              value={name}
              maxLength={32}
              autoComplete="name"
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
              aria-invalid={!!error}
              aria-describedby={error ? `${nameId}-err` : undefined}
            />
            {error ? (
              <p id={`${nameId}-err`} className={s.err}>
                {error}
              </p>
            ) : null}
          </div>

          <div className={ui.field}>
            <span className={ui.fieldLabel} id="style-l">
              Style
            </span>
            <div className={ui.row} role="group" aria-labelledby="style-l">
              {design.allowed.map((ed) => (
                <button
                  key={ed}
                  type="button"
                  className={`chip ${s.tall}`}
                  aria-pressed={chosen === ed}
                  onClick={() => {
                    setEdition(ed);
                    play("flick");
                  }}
                >
                  {EDITION_LABEL[ed]}
                </button>
              ))}
            </div>
          </div>

          <div className={ui.field}>
            <span className={ui.fieldLabel}>
              Photo <span className={ui.muted}>(optional)</span>
            </span>
            <div className={ui.row}>
              <label htmlFor={photoId} className="btn btn-quiet">
                {photo ? "Change photo" : "Add a photo"}
              </label>
              <input
                id={photoId}
                type="file"
                accept="image/*"
                className="visually-hidden"
                onChange={async (e) => {
                  const f = e.currentTarget.files?.[0];
                  if (f) setPhoto(await photoToDataUrl(f));
                }}
              />
              {photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photo} alt="Your photo" className={s.thumb} />
              ) : null}
            </div>
          </div>

          <div className={ui.field}>
            <label htmlFor={noteId} className={ui.fieldLabel}>
              Note on the back <span className={ui.muted}>(optional)</span>
            </label>
            <textarea id={noteId} className={ui.input} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} />
          </div>

          <button type="submit" className="btn btn-primary btn-block" disabled={claiming}>
            Claim my stub
          </button>
        </form>
      </div>
    </PageShell>
  );
}
