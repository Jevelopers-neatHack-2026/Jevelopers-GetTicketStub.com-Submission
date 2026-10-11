"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { StubView } from "@/customer/studio/stub/StubView";
import { play, haptic } from "@/customer/studio/feedback";
import { encodeStub, getStub, upsertStub } from "@/customer/studio/store";
import { formatMoney, type Stub } from "@/customer/studio/types";
import { PageShell, CopyField, ui } from "@/customer/pages/ui";
import { addToCart, cartItemFromStub, sizesFor, materialPrice } from "@/customer/pages/commerce";
import { useMounted } from "@/customer/pages/useMounted";
import s from "./friends.module.css";

type Mode = "make" | "claim";

export default function FriendsClient({ id }: { id: string }) {
  const router = useRouter();
  const mounted = useMounted();
  const inputId = useId();
  const [stub, setStub] = useState<Stub | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<Mode>("claim");

  if (mounted && stub === undefined) {
    const st = getStub(id) ?? null;
    setStub(st);
    if (st && st.personal.friends.length > 0 && st.personal.friends.every((f) => f.claimed)) setMode("make");
  }

  if (!mounted || stub === undefined) return <PageShell back={{ href: `/studio/${id}`, label: "Back to your stub" }}>{null}</PageShell>;
  if (stub === null) {
    return (
      <PageShell back={{ href: "/wall", label: "Wall" }}>
        <div className={ui.error}>
          <h1 className={ui.h2}>We couldn&apos;t find this stub on this device.</h1>
          <Link className="btn btn-primary" href="/wall">
            Open your wall
          </Link>
        </div>
      </PageShell>
    );
  }

  const friends = stub.personal.friends;

  function save(nextFriends: Stub["personal"]["friends"], m: Mode = mode) {
    if (!stub) return;
    const renumbered = nextFriends.map((f, i) => ({ ...f, seat: `Seat ${i + 2}`, claimed: m === "make" }));
    const next: Stub = { ...stub, setId: stub.setId ?? stub.id, personal: { ...stub.personal, friends: renumbered } };
    upsertStub(next);
    setStub(next);
  }

  function add() {
    const n = name.trim();
    if (!n) return;
    save([...friends, { name: n, claimed: false }]);
    setName("");
    play("pin");
    haptic([12]);
  }

  function pickMode(m: Mode) {
    setMode(m);
    save(friends, m);
    play("tick");
  }

  const setId = stub.setId ?? stub.id;
  const claimPath = `/claim/${encodeURIComponent(setId)}?from=${encodeStub({ ...stub, setId })}`;
  const seats = friends.length + 1;
  const material = stub.material === "digital" ? "print" : stub.material;

  return (
    <PageShell back={{ href: `/studio/${stub.id}`, label: "Back to your stub" }} narrow>
      <div className={s.wrap}>
        <h1 className={ui.h1}>Send matching stubs</h1>
        <p className={ui.muted}>Send a matching stub to the people you went with. Same design, their own name and seat.</p>

        <div className={s.preview}>
          <StubView stub={stub} size="sm" />
        </div>

        <section aria-labelledby="seats-h" className={ui.stack}>
          <h2 id="seats-h" className="label">
            Seats · {seats}
          </h2>
          <ul className={s.chips}>
            <li>
              <span className={`chip ${s.youChip}`}>
                You · Seat 1
              </span>
            </li>
            {friends.map((f, i) => (
              <li key={`${f.name}-${i}`}>
                <span className={`chip ${s.friendChip}`}>
                  {f.name} · {f.seat ?? `Seat ${i + 2}`}
                  <button
                    type="button"
                    className={s.chipX}
                    aria-label={`Remove ${f.name}`}
                    onClick={() => save(friends.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ul>
          <form
            className={s.addRow}
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <label htmlFor={inputId} className="visually-hidden">
              Add a friend
            </label>
            <input
              id={inputId}
              className={`${ui.input} ${s.addInput}`}
              placeholder="Add a friend"
              value={name}
              maxLength={24}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
            <button type="submit" className="btn" disabled={!name.trim()}>
              Add
            </button>
          </form>
        </section>

        <fieldset className={s.modes}>
          <legend className="label">How they get their stub</legend>
          <label className={s.mode}>
            <input type="radio" name="mode" checked={mode === "make"} onChange={() => pickMode("make")} />
            <strong>I&apos;ll make them all</strong>
            <span>You print the whole set and hand them out.</span>
          </label>
          <label className={s.mode}>
            <input type="radio" name="mode" checked={mode === "claim"} onChange={() => pickMode("claim")} />
            <strong>Send a claim link</strong>
            <span>Each friend claims their seat and adds their name.</span>
          </label>
        </fieldset>

        {mode === "claim" ? (
          <section className={ui.card} aria-labelledby="link-h">
            <h2 id="link-h" className={s.h3}>
              Your claim link
            </h2>
            <CopyField path={claimPath} label="Claim link" />
            <p className={ui.muted}>Anyone with the link can claim a seat in this set.</p>
          </section>
        ) : null}

        {friends.length > 0 ? (
          <button
            type="button"
            className="btn btn-primary btn-block"
            onClick={() => {
              addToCart(cartItemFromStub(stub, material, stub.finish, sizesFor(material)[0]));
              play("pin");
              router.push("/cart");
            }}
          >
            Add the set to your cart · {seats} × {formatMoney(materialPrice(material))}
          </button>
        ) : (
          <p className={ui.muted}>Add the people you went with to build the set.</p>
        )}
      </div>
    </PageShell>
  );
}
