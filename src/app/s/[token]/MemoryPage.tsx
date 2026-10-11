"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/customer/account/api";
import { sharePath } from "@/customer/account/share";
import d from "@/customer/desk/Desk.module.css";
import { PaperButton, Rule, Stamp, Stamped, Tool, Tools } from "@/customer/desk/Desk";
import { FlipIcon } from "@/customer/desk/icons";
import { StubView } from "@/customer/studio/stub/StubView";
import { play, haptic } from "@/customer/studio/feedback";
import { decodeStub, getStub, upsertStub } from "@/customer/studio/store";
import { formatMoney, type Stub } from "@/customer/studio/types";
import { FINISHES, materialPrice } from "@/customer/pages/commerce";
import { PageShell, FriendlyError, OnDesk, PaperLink, StampLink, TearAnchor, ui } from "@/customer/pages/ui";
import { TearLink } from "@/customer/desk/Desk";
import { absoluteUrl, copyText, formatDate, isStub } from "@/customer/pages/share";
import { renderStoryPng, downloadBlob, photoToDataUrl } from "@/customer/pages/storyImage";
import { useMounted } from "@/customer/pages/useMounted";
import { EventContent, Facts } from "./EventContent";
import s from "./memory.module.css";

/** What printing costs: the stock plus the finish add-on, the same sum checkout shows. */
function printMinor(st: Stub): number {
  const physical = st.material !== "digital";
  return materialPrice(st.material) + (physical ? (FINISHES.find((f) => f.id === st.finish)?.upchargeMinor ?? 0) : 0);
}

export default function MemoryPage({ token, gift, giftTo }: { token: string; gift: boolean; giftTo?: string }) {
  const mounted = useMounted();
  // A short token is a snapshot on the server; anything else (every older link) carries the stub itself.
  const [remote, setRemote] = useState<{ token: string; stub: Stub | null } | null>(null);
  useEffect(() => {
    if (!mounted) return;
    let live = true;
    api
      .sharedStub(token)
      .then((r) => live && setRemote({ token, stub: isStub(r.stub) ? r.stub : null }))
      .catch(() => live && setRemote({ token, stub: null }));
    return () => {
      live = false;
    };
  }, [mounted, token]);
  const decoded = useMemo(() => {
    if (!mounted) return undefined;
    if (remote?.token === token && remote.stub) return remote.stub;
    if (remote?.token !== token) return undefined; // still asking the server
    const dec = decodeStub(token);
    return isStub(dec) ? dec : null;
  }, [mounted, token, remote]);
  const [ownedState, setOwnedState] = useState<{ id: string; stub?: Stub } | null>(null);
  if (decoded && ownedState?.id !== decoded.id) setOwnedState({ id: decoded.id, stub: getStub(decoded.id) });
  const owned = ownedState?.stub;
  const setOwned = (next: Stub) => setOwnedState({ id: next.id, stub: next });
  const [flipped, setFlipped] = useState(false);
  const [wrapped, setWrapped] = useState(gift);
  const [opening, setOpening] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [status, setStatus] = useState<{ text: string; ok?: boolean }>({ text: "" });
  const [stampKey, setStampKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [stopped, setStopped] = useState(false);

  if (!mounted) return <PageShell>{null}</PageShell>;
  if (decoded === undefined) return <PageShell>{null}</PageShell>;
  if (!decoded) {
    return (
      <PageShell>
        <FriendlyError title="We couldn't open this stub." body="The link may be cut short. Ask the sender for the link again, or make a stub of your own." />
      </PageShell>
    );
  }

  // A link that carries the stub itself (not a server token) is untrusted data: it can be read, never owned.
  const legacy = !(remote?.token === token && remote.stub);
  const stub = owned ?? decoded;
  const isOwner = !!owned && !legacy;
  const e = stub.event;
  const meta = [formatDate(e.dateISO), e.venue, e.city].filter(Boolean).join(" · ");
  const shareUrl = absoluteUrl(`/s/${token}`);
  const claimHref = `/claim/${encodeURIComponent(stub.setId ?? stub.id)}?from=${token}`;

  function say(text: string, ok = false) {
    setStatus({ text, ok });
    setStampKey((k) => k + 1);
  }

  function flip() {
    setFlipped((f) => !f);
    play("flip");
    haptic([10]);
  }

  async function share() {
    // The owner's link becomes a short server link when there is a server; everyone else re-shares the link they opened.
    const url = isOwner ? absoluteUrl(await sharePath(stub)) : shareUrl;
    const data = { title: `${e.title} · TicketStub`, text: "My stub from that night.", url };
    try {
      if (typeof navigator.share === "function") {
        await navigator.share(data);
        return;
      }
    } catch (err) {
      if ((err as DOMException)?.name === "AbortError") return;
    }
    if (await copyText(url)) say("Link copied", true);
    else say("Couldn't copy the link. Copy it from the address bar.");
  }

  async function stopSharing() {
    try {
      await api.stopSharing(stub.id);
      setStopped(true);
      setConfirmStop(false);
      say("Sharing stopped. The old link no longer works.", true);
    } catch {
      say("We couldn't stop sharing just now. Try again in a moment.");
    }
  }

  async function downloadStory() {
    setBusy(true);
    say("Building your story image…");
    const blob = await renderStoryPng(stub);
    setBusy(false);
    if (!blob) {
      say("We couldn't build the image. Try again, or take a screenshot of the preview.");
      return;
    }
    const slug = e.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "stub";
    downloadBlob(blob, `ticketstub-${slug}-story.png`);
    say("Story saved", true);
  }

  async function addPhotos(files: FileList | null) {
    if (!files || !owned) return;
    say("Adding photos…");
    const urls = (await Promise.all(Array.from(files).slice(0, 6).map((f) => photoToDataUrl(f)))).filter((u): u is string => !!u);
    const next = { ...owned, photos: [...owned.photos, ...urls].slice(-12) };
    upsertStub(next);
    setOwned(next);
    play("drop");
    if (urls.length) say(`${urls.length} ${urls.length === 1 ? "photo" : "photos"} added`, true);
    else say("We couldn't read those photos. Try a JPG or PNG.");
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
      setLeaving(true);
      play("drop");
      setTimeout(() => setWrapped(false), 600);
    }, 650);
  }

  const noPhotos = stub.photos.length === 0;

  return (
    <>
      <PageShell>
        <div className={s.layout} inert={wrapped}>
          <div className={s.desk}>
            <OnDesk>
              <button type="button" className={s.stubBtn} onClick={flip} aria-label={flipped ? "Show the front of the stub" : "Flip the stub to the back"}>
                <StubView stub={stub} size="lg" tilt flipped={flipped} />
              </button>
            </OnDesk>
            <div className={s.toolsRow}>
              <Tools label="Stub">
                <Tool icon={<FlipIcon />} active={flipped} onClick={() => setFlipped((f) => !f)}>
                  {flipped ? "Front" : "Back"}
                </Tool>
              </Tools>
            </div>
            {isOwner ? (
              <div className={s.actions}>
                <Stamp block onClick={share}>
                  Share your stub
                </Stamp>
                <div className={s.actionsPair}>
                  <PaperLink href={`/checkout/${stub.id}`}>{stub.material === "digital" ? "Get the file" : "Print it"} · {formatMoney(printMinor(stub))}</PaperLink>
                  <PaperLink href={`/wallet/${stub.id}`}>Add to Wallet</PaperLink>
                </div>
                <div className={s.tearHolder}>
                  <TearAnchor href={`/friends/${stub.id}`}>Send matching stubs to friends</TearAnchor>
                </div>
              </div>
            ) : null}
            <div className={`${ui.status} ${s.status}`} aria-live="polite">
              {status.ok ? <Stamped key={stampKey}>{status.text}</Stamped> : status.text}
            </div>
          </div>

          <article className={s.content}>
            <header className={s.titleBlock}>
              {e.subtitle ? <p className="desk-label">{e.subtitle}</p> : null}
              <h1 className={s.title}>{e.title}</h1>
              {meta ? <p className={s.meta}>{meta}</p> : null}
              {e.seat ? (
                <p className={s.seatLine}>
                  <span className="desk-label">Seat</span>
                  {e.seat}
                </p>
              ) : null}
            </header>

            <EventContent event={e} />
            <Facts facts={e.facts} />

            {stub.personal.friends.length > 0 ? (
              <section className={s.section} aria-labelledby="who-h">
                <header className={s.secHead}>
                  <h2 id="who-h" className={s.secTitle}>
                    Who was there
                  </h2>
                  <Rule kind="double" />
                </header>
                <ul className={s.friends}>
                  {stub.personal.friends.map((f, i) => (
                    <li key={`${f.name}-${i}`} className={s.friend}>
                      <span className={s.avatar} aria-hidden="true">
                        {f.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className={s.friendName}>
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
                <header className={s.secHead}>
                  <h2 id="note-h" className={s.secTitle}>
                    Note
                  </h2>
                  <Rule kind="double" />
                </header>
                <p className={s.note}>{stub.personal.note}</p>
              </section>
            ) : null}

            {isOwner || !noPhotos ? (
              <section className={s.section} aria-labelledby="photos-h">
                <header className={s.secHead}>
                  <h2 id="photos-h" className={s.secTitle}>
                    Photos
                  </h2>
                  <Rule kind="double" />
                </header>
                {!noPhotos ? (
                  <ul className={s.photos}>
                    {stub.photos.map((p, i) => (
                      <li key={i} className={s.photo}>
                        <div className={s.photoFrame}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p} alt={`Photo ${i + 1} from ${e.title}`} />
                        </div>
                        {isOwner ? (
                          <button type="button" className={d.tearLink} onClick={() => removePhoto(i)} aria-label={`Remove photo ${i + 1}`}>
                            Remove
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {isOwner ? (
                  <div className={s.emptyPhotos}>
                    <p className={ui.muted}>
                      {noPhotos ? "Add the photos from that night. They'll sit beside the stub." : "Photos stay on this device. They aren't in the share link."}
                    </p>
                    <label className={`${d.paper} ${s.filePick}`}>
                      {noPhotos ? "Add photos" : "Add more photos"}
                      <input type="file" accept="image/*" multiple onChange={(ev) => addPhotos(ev.currentTarget.files)} />
                    </label>
                    {noPhotos ? <p className={ui.status}>Photos stay on this device. They aren&apos;t in the share link.</p> : null}
                  </div>
                ) : null}
              </section>
            ) : null}

            {isOwner ? (
              <section className={s.section} aria-labelledby="share-h">
                <header className={s.secHead}>
                  <h2 id="share-h" className={s.secTitle}>
                    What your friends see
                  </h2>
                  <Rule kind="double" />
                </header>
                <p className={ui.muted}>Your stub as a still image and as a link preview. Anyone with the link can open this page.</p>
                <div className={s.previews}>
                  <figure className={s.previewFig}>
                    <div className={`desk-surface ${s.story}`} aria-hidden="true">
                      <StubView stub={stub} size="sm" />
                      <p className={s.storyTitle}>{e.title}</p>
                      <p className={s.storyMeta}>{meta}</p>
                      <p className={s.madeWith}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src="/brand/favicon.svg" alt="" width={16} height={16} /> Made with TicketStub
                      </p>
                    </div>
                    <figcaption>Story · 9:16</figcaption>
                  </figure>
                  <figure className={s.previewFig}>
                    <div className={s.og} aria-hidden="true">
                      <StubView stub={stub} size="sm" />
                      <div className={s.ogText}>
                        <p className={s.ogTitle}>{e.title}</p>
                        <p className={s.storyMeta}>{meta}</p>
                        <p className={s.madeWith}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src="/brand/favicon.svg" alt="" width={16} height={16} /> Made with TicketStub
                        </p>
                      </div>
                    </div>
                    <figcaption>Link preview · 1200 × 630</figcaption>
                  </figure>
                </div>
                <div className={ui.row}>
                  <PaperButton type="button" onClick={downloadStory} disabled={busy}>
                    Download story image
                  </PaperButton>
                  {confirmStop ? (
                    <span role="group" aria-label="Stop sharing this stub">
                      <span className={ui.muted}>This link stops working for everyone who has it. </span>
                      <TearLink type="button" onClick={stopSharing}>
                        Stop sharing
                      </TearLink>{" "}
                      <TearLink type="button" onClick={() => setConfirmStop(false)}>
                        Keep sharing
                      </TearLink>
                    </span>
                  ) : stopped ? null : (
                    <TearLink type="button" onClick={() => setConfirmStop(true)}>
                      Stop sharing
                    </TearLink>
                  )}
                </div>
              </section>
            ) : null}

            {!isOwner ? (
              <section className={s.make} aria-labelledby="make-h">
                <Rule kind="perf" />
                <h2 id="make-h" className={s.makeHead}>
                  Your night deserves a stub too.
                </h2>
                <p className={ui.muted}>Paste your ticket and get a stub with the setlist, the weather and the story of the night.</p>
                <StampLink href="/">Paste your ticket link</StampLink>
                {legacy ? null : <TearAnchor href={claimHref}>Were you there too? Claim a matching stub</TearAnchor>}
              </section>
            ) : null}

            <p className={s.unlisted}>
              Anyone with the link can see this page. It isn&apos;t listed or searchable.
              {legacy ? " Old share link." : ""}
            </p>
          </article>
        </div>
      </PageShell>

      {wrapped ? (
        <div className={`desk-surface ${s.giftStage}`} data-leaving={leaving ? "" : undefined} role="dialog" aria-modal="true" aria-label="A gift for you">
          <div className={`${s.giftBox} ${opening ? s.giftOpening : ""}`}>
            <p className="desk-label">{giftTo ? `For ${giftTo}` : "A gift for you"}</p>
            <h1 className={s.giftTitle}>Someone made you a stub.</h1>
            <p className={s.giftSub}>{e.title}</p>
            <div className={s.giftWrapArt} aria-hidden="true">
              <span className={s.ribbonV} />
              <span className={s.ribbonH} />
            </div>
            <Stamp onClick={tearOpen} disabled={opening}>
              Tear it open
            </Stamp>
          </div>
        </div>
      ) : null}
    </>
  );
}
