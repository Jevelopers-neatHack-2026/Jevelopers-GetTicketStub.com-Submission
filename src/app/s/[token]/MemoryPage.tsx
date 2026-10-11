"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { StubView } from "@/customer/studio/stub/StubView";
import { FitBox } from "@/customer/pages/FitBox";
import { play, haptic } from "@/customer/studio/feedback";
import { decodeStub, getStub, upsertStub } from "@/customer/studio/store";
import type { Stub } from "@/customer/studio/types";
import { PageShell, FriendlyError, ui } from "@/customer/pages/ui";
import { absoluteUrl, copyText, formatDate, isStub } from "@/customer/pages/share";
import { renderStoryPng, downloadBlob, photoToDataUrl } from "@/customer/pages/storyImage";
import { useMounted } from "@/customer/pages/useMounted";
import { EventContent, Facts } from "./EventContent";
import s from "./memory.module.css";

export default function MemoryPage({ token, gift, giftTo }: { token: string; gift: boolean; giftTo?: string }) {
  const mounted = useMounted();
  const decoded = useMemo(() => {
    if (!mounted) return undefined;
    const d = decodeStub(token);
    return isStub(d) ? d : null;
  }, [mounted, token]);
  const [ownedState, setOwnedState] = useState<{ id: string; stub?: Stub } | null>(null);
  if (decoded && ownedState?.id !== decoded.id) setOwnedState({ id: decoded.id, stub: getStub(decoded.id) });
  const owned = ownedState?.stub;
  const setOwned = (next: Stub) => setOwnedState({ id: next.id, stub: next });
  const [flipped, setFlipped] = useState(false);
  const [wrapped, setWrapped] = useState(gift);
  const [opening, setOpening] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);


  if (!mounted) return <PageShell>{null}</PageShell>;
  if (!decoded) {
    return (
      <PageShell>
        <FriendlyError title="We couldn't open this stub." body="The link may be cut short. Ask the sender for the link again, or make a stub of your own." />
      </PageShell>
    );
  }

  const stub = owned ?? decoded;
  const isOwner = !!owned;
  const e = stub.event;
  const meta = [formatDate(e.dateISO), e.venue, e.city].filter(Boolean).join(" · ");
  const shareUrl = absoluteUrl(`/s/${token}`);
  const claimHref = `/claim/${encodeURIComponent(stub.setId ?? stub.id)}?from=${token}`;

  function flip() {
    setFlipped((f) => !f);
    play("flip");
    haptic([10]);
  }

  async function share() {
    const data = { title: `${e.title} · TicketStub`, text: "My stub from that night.", url: shareUrl };
    try {
      if (typeof navigator.share === "function") {
        await navigator.share(data);
        return;
      }
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
    }
    setStatus((await copyText(shareUrl)) ? "Link copied. Anyone with the link can see this page." : "Couldn't copy the link. Copy it from the address bar.");
  }

  async function downloadStory() {
    setBusy(true);
    setStatus("Building your story image…");
    const blob = await renderStoryPng(stub);
    setBusy(false);
    if (!blob) {
      setStatus("We couldn't build the image. Try again, or take a screenshot of the preview.");
      return;
    }
    const slug = e.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "stub";
    downloadBlob(blob, `ticketstub-${slug}-story.png`);
    setStatus("Story image saved.");
  }

  async function addPhotos(files: FileList | null) {
    if (!files || !owned) return;
    setStatus("Adding photos…");
    const urls = (await Promise.all(Array.from(files).slice(0, 6).map((f) => photoToDataUrl(f)))).filter((u): u is string => !!u);
    const next = { ...owned, photos: [...owned.photos, ...urls].slice(-12) };
    upsertStub(next);
    setOwned(next);
    setStatus(urls.length ? `Added ${urls.length} ${urls.length === 1 ? "photo" : "photos"}. Photos stay on this device.` : "We couldn't read those photos. Try a JPG or PNG.");
  }

  function removePhoto(i: number) {
    if (!owned) return;
    const next = { ...owned, photos: owned.photos.filter((_, j) => j !== i) };
    upsertStub(next);
    setOwned(next);
  }

  function tearOpen() {
    setOpening(true);
    play("tear");
    haptic([4, 30, 4, 30, 18]);
    setTimeout(() => {
      setWrapped(false);
      play("drop");
    }, 650);
  }

  if (wrapped) {
    return (
      <div className={`ts-night ${s.giftStage}`}>
        <div className={`${s.giftBox} ${opening ? s.giftOpening : ""}`}>
          <p className="label">{giftTo ? `For ${giftTo}` : "A gift for you"}</p>
          <h1 className={s.giftTitle}>Someone made you a stub.</h1>
          <p className={s.giftSub}>{e.title}</p>
          <div className={s.giftWrapArt} aria-hidden="true">
            <span className={s.ribbonV} />
            <span className={s.ribbonH} />
          </div>
          <button type="button" className="btn btn-primary" onClick={tearOpen} disabled={opening}>
            Tear it open
          </button>
        </div>
      </div>
    );
  }

  return (
    <PageShell
      right={
        isOwner ? (
          <Link className="btn btn-quiet" href="/wall">
            Your wall
          </Link>
        ) : (
          <Link className="btn btn-primary" href="/">
            Make yours
          </Link>
        )
      }
      className={isOwner ? undefined : s.withCta}
    >
      <div className={s.layout}>
        <div className={s.stage}>
          <button type="button" className={s.stubBtn} onClick={flip} aria-label={flipped ? "Show the front of the stub" : "Flip the stub to the back"}>
            <FitBox>
              <StubView stub={stub} size="lg" tilt flipped={flipped} />
            </FitBox>
          </button>
          <p className={`${ui.muted} ${s.center}`}>Tap the stub to flip it.</p>
          {isOwner ? (
            <div className={s.ownerActions}>
              <button type="button" className="btn btn-primary" onClick={share}>
                Share your stub
              </button>
              <Link className="btn" href={`/checkout/${stub.id}`}>
                Print it
              </Link>
              <Link className="btn btn-quiet" href={`/wallet/${stub.id}`}>
                Add to Wallet
              </Link>
              <Link className="btn btn-quiet" href={`/friends/${stub.id}`}>
                Send matching stubs
              </Link>
            </div>
          ) : null}
          <p className={ui.status} aria-live="polite">
            {status}
          </p>
        </div>

        <article className={s.content}>
          <header className={s.titleBlock}>
            {e.subtitle ? <p className="label">{e.subtitle}</p> : null}
            <h1 className={s.title}>{e.title}</h1>
            {meta ? <p className={ui.muted}>{meta}</p> : null}
            {e.seat ? <span className="chip">{e.seat}</span> : null}
          </header>

          <EventContent event={e} />
          <Facts facts={e.facts} />

          {stub.personal.friends.length > 0 ? (
            <section className={s.section} aria-labelledby="who-h">
              <h2 id="who-h" className={s.h2}>
                Who was there
              </h2>
              <ul className={s.friends}>
                {stub.personal.friends.map((f, i) => (
                  <li key={`${f.name}-${i}`} className={s.friend}>
                    <span className={s.avatar} aria-hidden="true">
                      {f.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span>
                      <strong>{f.name}</strong>
                      <span className={s.friendMeta}>{[f.seat, f.claimed ? "has their stub" : "seat not claimed yet"].filter(Boolean).join(" · ")}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {stub.personal.note ? (
            <section className={s.section} aria-labelledby="note-h">
              <h2 id="note-h" className={s.h2}>
                Note
              </h2>
              <p className={s.note}>{stub.personal.note}</p>
            </section>
          ) : null}

          {isOwner || stub.photos.length > 0 ? (
            <section className={s.section} aria-labelledby="photos-h">
              <h2 id="photos-h" className={s.h2}>
                Photos
              </h2>
              {stub.photos.length > 0 ? (
                <ul className={s.photos}>
                  {stub.photos.map((p, i) => (
                    <li key={i} className={s.photo}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p} alt={`Photo ${i + 1} from ${e.title}`} />
                      {isOwner ? (
                        <button type="button" className={s.photoRemove} onClick={() => removePhoto(i)} aria-label={`Remove photo ${i + 1}`}>
                          ×
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              {isOwner ? (
                <>
                  <label className="btn btn-quiet">
                    Add photos
                    <input type="file" accept="image/*" multiple className="visually-hidden" onChange={(ev) => addPhotos(ev.currentTarget.files)} />
                  </label>
                  <p className={ui.muted}>Photos stay on this device. They aren&apos;t in the share link.</p>
                </>
              ) : null}
            </section>
          ) : null}

          {isOwner ? (
            <section className={s.section} aria-labelledby="share-h">
              <h2 id="share-h" className={s.h2}>
                Share your stub
              </h2>
              <p className={ui.muted}>A still image with a link to this page. Anyone with the link can see this page.</p>
              <div className={s.previews}>
                <figure className={s.previewFig}>
                  <div className={`ts-night ${s.story}`} aria-hidden="true">
                    <FitBox className={s.storyStub}>
                      <StubView stub={stub} size="sm" />
                    </FitBox>
                    <p className={s.storyTitle}>{e.title}</p>
                    <p className={s.storyMeta}>{meta}</p>
                    <p className={s.madeWith}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src="/brand/favicon.svg" alt="" width={16} height={16} /> Made with TicketStub
                    </p>
                  </div>
                  <figcaption className={ui.muted}>Story · 9:16</figcaption>
                </figure>
                <figure className={s.previewFig}>
                  <div className={s.og} aria-hidden="true">
                    <div className={s.ogArt}>
                      <StubView stub={stub} size="sm" />
                    </div>
                    <div className={s.ogText}>
                      <p className={s.ogTitle}>{e.title}</p>
                      <p className={s.ogMeta}>{meta}</p>
                      <p className={s.madeWithDark}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/brand/favicon.svg" alt="" width={16} height={16} /> Made with TicketStub
                      </p>
                    </div>
                  </div>
                  <figcaption className={ui.muted}>Link preview · 1200 × 630</figcaption>
                </figure>
              </div>
              <div className={ui.row}>
                <button type="button" className="btn btn-primary" onClick={downloadStory} disabled={busy}>
                  Download story image
                </button>
                <button type="button" className="btn" onClick={share}>
                  Share the link
                </button>
              </div>
            </section>
          ) : null}

          <p className={`${ui.muted} ${s.unlisted}`}>Anyone with the link can see this page. It isn&apos;t listed or searchable.</p>
        </article>
      </div>

      {!isOwner ? (
        <div className={s.ctaBar} role="region" aria-label="Make your own stub">
          <Link className="btn btn-primary" href="/">
            Make yours
          </Link>
          <Link className={`btn ${s.claimBtn}`} href={claimHref}>
            Were you there too? Claim a matching stub
          </Link>
        </div>
      ) : null}
    </PageShell>
  );
}
