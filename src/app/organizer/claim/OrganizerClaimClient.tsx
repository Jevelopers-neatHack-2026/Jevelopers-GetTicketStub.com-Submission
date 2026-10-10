"use client";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import d from "@/customer/desk/Desk.module.css";
import { Field, PunchTabs, Rule, Stamp, TearLink } from "@/customer/desk/Desk";
import { StubView } from "@/customer/studio/stub/StubView";
import { haptic, play } from "@/customer/studio/feedback";
import { encodeStub, upsertStub } from "@/customer/studio/store";
import { withGuestName, type Edition } from "@/customer/studio/types";
import { PageShell, FriendlyError, OnDesk, ui } from "@/customer/pages/ui";
import { decodeDesign, designEvent, designStub } from "@/customer/pages/organizer";
import { photoToDataUrl } from "@/customer/pages/storyImage";
import { useMounted } from "@/customer/pages/useMounted";
import { Padlock } from "../LockSwitch";
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
  const preview = useMemo(() => (design ? withGuestName(designStub(design, { id: "claim-preview", edition: chosen }), name.trim() || "Your name") : null), [design, name, chosen]);

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
    const st = withGuestName(designStub(design!, { edition: chosen }), n);
    st.id = Math.random().toString(36).slice(2, 10);
    st.torn = true;
    st.wallAngle = Math.round((Math.random() * 8 - 4) * 10) / 10;
    st.personal = { ...st.personal, note: note.trim() || undefined };
    st.photos = photo ? [photo] : [];
    upsertStub(st);
    haptic([20]);
    router.push(`/s/${encodeStub(st)}`);
  }

  const locked = [design.locks.logo ? "Logo" : null, design.locks.title ? "Title" : null].filter(Boolean) as string[];

  return (
    <PageShell right={design.organizer ? <span className="desk-label">{design.organizer}</span> : undefined}>
      <div className={s.layout}>
        <div className={s.desk}>
          <OnDesk>
            <StubView stub={preview} size="md" tilt />
          </OnDesk>
          {locked.length ? (
            <ul className={s.locked} aria-label="Set by the organizer">
              {design.locks.logo ? (
                <li>
                  <Padlock locked />
                  Logo set by the organizer
                </li>
              ) : null}
              {design.locks.title ? (
                <li>
                  <Padlock locked />
                  Title: {ev.title}
                </li>
              ) : null}
            </ul>
          ) : null}
        </div>

        <form
          className={s.form}
          onSubmit={(e) => {
            e.preventDefault();
            claim();
          }}
        >
          <header className={s.head}>
            <p className="desk-label">{design.organizer ? `From ${design.organizer}` : "Your event stub"}</p>
            <h1 className={s.title}>Claim your stub.</h1>
            <p className={s.lede}>{ev.title}</p>
          </header>

          <Field
            id="claim-name"
            label="Name on your stub"
            placeholder="Your name"
            value={name}
            maxLength={32}
            autoComplete="name"
            onChange={(e) => {
              setName(e.target.value);
              setError("");
            }}
            aria-invalid={!!error}
            hint={error || undefined}
          />

          {design.allowed.length > 1 ? (
            <div className={s.group}>
              <span className="desk-label">Style</span>
              <PunchTabs label="Style" options={design.allowed.map((ed) => ({ value: ed, label: EDITION_LABEL[ed] }))} value={chosen} onChange={(ed) => setEdition(ed)} />
            </div>
          ) : null}

          <Rule kind="perf" />

          <div className={s.group}>
            <span className="desk-label">Photo, if you like</span>
            <div className={ui.row}>
              <label className={`${d.paper} ${s.filePick}`}>
                {photo ? "Change photo" : "Add a photo"}
                <input
                  id={photoId}
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const f = e.currentTarget.files?.[0];
                    if (f) {
                      setPhoto(await photoToDataUrl(f));
                      play("drop");
                    }
                  }}
                />
              </label>
              {photo ? (
                <>
                  <span className={s.thumbFrame}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo} alt="Your photo" className={s.thumb} />
                  </span>
                  <TearLink type="button" onClick={() => setPhoto(null)}>
                    Remove
                  </TearLink>
                </>
              ) : null}
            </div>
          </div>

          <div className={s.group}>
            <label htmlFor={noteId} className="desk-label">
              Note on the back, if you like
            </label>
            <textarea id={noteId} className={`${ui.input} ${s.note}`} value={note} maxLength={200} placeholder="Who you were with, what you remember." onChange={(e) => setNote(e.target.value)} />
          </div>

          <Stamp type="submit" block disabled={claiming}>
            Claim my stub
          </Stamp>
        </form>
      </div>
    </PageShell>
  );
}
