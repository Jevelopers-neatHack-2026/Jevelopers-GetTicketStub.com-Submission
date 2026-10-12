"use client";
// Review board for the desk parts. Each part is shown on the cream paper desk, live: press,
// pick and toggle them to hear and feel them. Nothing here is a product screen.
import { useState } from "react";
import {
  FinishSwatches,
  Field,
  MarkLegend,
  PaperButton,
  PaperSheet,
  PunchTabs,
  Rule,
  SandboxStrip,
  SourceMark,
  Stamp,
  Stamped,
  Switch,
  Tag,
  Tags,
  TearLink,
  Tool,
  Tools,
  type FinishValue,
} from "@/customer/desk/Desk";
import { AskIcon, FlipIcon, FriendsIcon, RemixIcon } from "@/customer/desk/icons";
import { getPrintVoice, play, setPrintVoice, stopPrint, type Cue, type Emphasis, type PrintBurst, type PrintVoice } from "@/customer/studio/feedback";
import { PALE_HOURS, newStub } from "@/customer/studio/fixtures";
import { MaterialFrame } from "@/customer/studio/editor/MaterialFrame";
import { StubView } from "@/customer/studio/stub/StubView";
import type { Edition, Finish, Material, Stub } from "@/customer/studio/types";
import { useMounted } from "@/customer/pages/useMounted";
import s from "./parts.module.css";

const MATERIALS: { value: Material; label: string; sub: string }[] = [
  { value: "digital", label: "Digital", sub: "$9" },
  { value: "card", label: "Card", sub: "$29" },
  { value: "print", label: "Print", sub: "$49" },
  { value: "framed", label: "Framed", sub: "$89" },
];

function Specimen() {
  const [material, setMaterial] = useState<Material>("print");
  const [finish, setFinish] = useState<FinishValue>("foil");
  const [filter, setFilter] = useState("all");
  const [tool, setTool] = useState<string | null>(null);
  const [isPublic, setPublic] = useState(false);
  const [locked, setLocked] = useState(true);
  const [stamped, setStamped] = useState(0);
  const price = MATERIALS.find((m) => m.value === material)!.sub;

  return (
    <div className={`${s.col} desk-surface`}>
      <p className={s.colName}>Paper · every screen, every moment</p>

      <Part name="Stamp" job="The one main action on a screen. It presses down with a stamp thunk. The price rides on its own perforated stub.">
        <Stamp block price={price} onClick={() => setStamped((n) => n + 1)}>
          Print it
        </Stamp>
        <div className={s.row}>
          <Stamp>Make my stub</Stamp>
          {stamped ? <Stamped key={stamped}>Ordered</Stamped> : null}
        </div>
      </Part>

      <Part name="Paper button and tear link" job="Second and third actions. Card stock that sinks a little, and a dotted tear line.">
        <div className={s.row}>
          <PaperButton>Share your stub</PaperButton>
          <PaperButton>Add to wallet</PaperButton>
        </div>
        <TearLink>See your wall</TearLink>
      </Part>

      <Part name="Tools" job="Small labelled tools beside the stub. They never compete with it. The open one sits on a raised card.">
        <Tools label="Stub tools">
          <Tool icon={<RemixIcon />} active={tool === "remix"} onClick={() => setTool(tool === "remix" ? null : "remix")}>
            Remix
          </Tool>
          <Tool icon={<FlipIcon />} active={tool === "flip"} onClick={() => setTool(tool === "flip" ? null : "flip")}>
            Flip
          </Tool>
          <Tool icon={<FriendsIcon />} active={tool === "friends"} onClick={() => setTool(tool === "friends" ? null : "friends")}>
            Friends
          </Tool>
          <Tool icon={<AskIcon />} active={tool === "ask"} onClick={() => setTool(tool === "ask" ? null : "ask")}>
            Ask
          </Tool>
        </Tools>
      </Part>

      <Part name="Punched tabs" job="One choice from a few. The card slides over and gets punched. Arrow keys work.">
        <PunchTabs label="Material" options={MATERIALS} value={material} onChange={setMaterial} />
      </Part>

      <Part name="Finish swatches" job="You choose a finish by how it looks, not by its name. Hover makes the light sweep across.">
        <FinishSwatches value={finish} onChange={setFinish} prices={{ matte: "Included", foil: "+$6", holo: "+$9" }} />
      </Part>

      <Part name="Paper tags" job="Filters and suggestions, shaped like luggage tags with an eyelet. Filters with no results are hidden.">
        <Tags label="Filter">
          {[
            ["all", "All", 8],
            ["concerts", "Concerts", 4],
            ["games", "Games", 2],
          ].map(([v, l, n]) => (
            <Tag key={v as string} pressed={filter === v} count={n as number} onClick={() => setFilter(v as string)}>
              {l}
            </Tag>
          ))}
        </Tags>
        <Tags>
          <Tag>Make it moodier</Tag>
          <Tag>Add the weather</Tag>
        </Tags>
      </Part>

      <Part name="Switch" job="On or off: a paper slider in a slot.">
        <Switch checked={isPublic} onChange={setPublic} hint={isPublic ? "Anyone with the link can see it" : "Only you can see it"}>
          Public wall
        </Switch>
        <Rule />
        <Switch checked={locked} onChange={setLocked} hint="Guests can't change it">
          Lock the title
        </Switch>
      </Part>

      <Part name="Field" job="Organizers and checkout only, since fans never fill in a form. You write on the line, and it turns orange while you type.">
        <Field id="org-paper" label="Organizer name" placeholder="Your organization" hint="Printed on every guest's stub" />
      </Part>

      <Part name="Source marks" job="Where each fact came from (EVAL-03), shown as small printer's marks with one legend line per screen.">
        <p className={s.factLine}>
          Night 2 of 3<SourceMark p="simulated" /> · 7°C, light rain
          <SourceMark p="live" /> · Winners
          <SourceMark p="pending" />
        </p>
        <MarkLegend marks={["live", "simulated", "pending"]} />
      </Part>

      <Part name="Rules" job="Ink rules divide the page instead of boxes: single, double (letterpress) and perforated (tear here).">
        <Rule />
        <Rule kind="double" />
        <Rule kind="perf" />
      </Part>
    </div>
  );
}


const CUES: { cue: Cue; job: string }[] = [
  { cue: "tap", job: "Paper button, tool" },
  { cue: "select", job: "Tab, tag, pick" },
  { cue: "toggle", job: "Switch" },
  { cue: "open", job: "Sheet opens" },
  { cue: "close", job: "Sheet closes" },
  { cue: "drop", job: "Stub set down" },
  { cue: "stamp", job: "Main action" },
  { cue: "success", job: "It worked" },
  { cue: "flick", job: "Foil catches light" },
  { cue: "flip", job: "Stub turns over" },
  { cue: "tear", job: "Stub tears off" },
  { cue: "pin", job: "Pinned to the wall" },
  { cue: "remix", job: "Shuffle for new art" },
  { cue: "print", job: "Printer feeds a stub" },
];

/** The same shape of feed the printing stage uses: six short runs with rests between. */
const DEMO_FEED: PrintBurst[] = [0.18, 0.62, 1.04, 1.5, 1.92, 2.36].map((at, i) => ({ at, dur: [0.3, 0.26, 0.34, 0.24, 0.32, 0.28][i] }));

const VOICE_OPTIONS: { value: PrintVoice; label: string; sub: string }[] = [
  { value: "chatter", label: "Chatter", sub: "receipt printer" },
  { value: "ticks", label: "Ticks", sub: "quiet head" },
  { value: "roller", label: "Roller", sub: "softest" },
];

function specimenStub(id: string, edition: Edition, finish: Finish): Stub {
  const st = newStub(PALE_HOURS, id);
  return { ...st, finish, versions: st.versions.map((v) => ({ ...v, edition })) };
}

function StubDesk() {
  const [edition, setEdition] = useState<Edition>("researched");
  const [material, setMaterial] = useState<Material>("print");
  return (
    <section className={s.sheets}>
      <p className="desk-label">The stub on the desk</p>
      <p className={s.body}>Tilt the stubs (move the pointer over them, or tilt your phone). The cast shadow slides away from the light, and the window light turns with the tilt. Holo is a fine flake film: its colour only blooms where the light falls.</p>
      <div className={s.row}>
        <PunchTabs
          label="Edition"
          value={edition}
          onChange={setEdition}
          options={[
            { value: "researched", label: "Researched" },
            { value: "letterpress", label: "Letterpress" },
            { value: "classic", label: "Classic" },
          ]}
        />
        <PunchTabs label="Material" value={material} onChange={setMaterial} options={MATERIALS.map(({ value, label }) => ({ value, label }))} />
      </div>
      <div className={s.stubRow}>
        {(["matte", "foil", "holo"] as Finish[]).map((f) => (
          <figure key={f} className={s.stubCell}>
            <MaterialFrame material={material} finish={f}>
              <StubView stub={specimenStub(`parts-${f}`, edition, f)} size="md" tilt />
            </MaterialFrame>
            <figcaption className="desk-label">{f}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

function SoundBoard() {
  const [emphasis, setEmphasis] = useState<Emphasis>("normal");
  // the device's choice, read after mount so the server render and the first client render agree
  const mounted = useMounted();
  const [picked, setVoice] = useState<PrintVoice | null>(null);
  const voice: PrintVoice = picked ?? (mounted ? getPrintVoice() : "chatter");
  const printDemo = (v: PrintVoice) => {
    stopPrint();
    play("print", { emphasis, schedule: DEMO_FEED, voice: v });
    setTimeout(stopPrint, 3000);
  };
  return (
    <section className={s.sheets}>
      <p className="desk-label">Sounds</p>
      <p className={s.body}>Every cue has its own shape and job. Each one swells in instead of clicking, rings faintly in one small room, and varies a little each time it plays. Repeat one quickly and it gets lighter.</p>
      <PunchTabs
        label="Emphasis"
        value={emphasis}
        onChange={setEmphasis}
        options={[
          { value: "subtle", label: "Subtle", sub: "frequent" },
          { value: "normal", label: "Normal" },
          { value: "strong", label: "Strong", sub: "rare" },
        ]}
      />
      <div className={s.cues}>
        {CUES.map(({ cue, job }) => (
          <button
            key={cue}
            type="button"
            className={s.cue}
            onClick={() => {
              if (cue === "print") printDemo(voice);
              else play(cue, { emphasis });
            }}
          >
            <span className={s.cueName}>{cue}</span>
            <span className={s.cueJob}>{job}</span>
          </button>
        ))}
      </div>
      <p className="desk-label">Printer voice</p>
      <p className={s.body}>Pick the printer you like best. It plays with the stub feeding out, and the app uses your choice on this device.</p>
      <PunchTabs
        label="Printer voice"
        value={voice}
        onChange={(v: PrintVoice) => {
          setVoice(v);
          setPrintVoice(v);
          printDemo(v);
        }}
        options={VOICE_OPTIONS}
      />
    </section>
  );
}

function Part({ name, job, children }: { name: string; job: string; children: React.ReactNode }) {
  return (
    <section className={s.part}>
      <header className={s.partHead}>
        <h3 className={s.partName}>{name}</h3>
        <p className={s.partJob}>{job}</p>
      </header>
      <div className={s.partBody}>{children}</div>
    </section>
  );
}

export default function PartsBoard() {
  const [sheet, setSheet] = useState(false);
  return (
    <main className={`${s.page} desk-surface`}>
      <SandboxStrip>Desk parts for review. Nothing here is a product screen.</SandboxStrip>
      <header className={s.head}>
        <p className="desk-label">TicketStub studio · desk parts</p>
        <h1 className={s.title}>Every control is something you could hold.</h1>
        <p className={s.lede}>Press, pick and toggle them. Each one sinks, moves and makes its own sound. With sound on (the default), the stamp thunks, tabs tick and finishes flick. Every screen gets rebuilt from these parts.</p>
      </header>

      <section className={s.type}>
        <p className="desk-label">Type</p>
        <p className={s.hero}>Keep the night.</p>
        <p className={s.h1}>Turn your ticket into a stub worth keeping.</p>
        <p className={s.h2}>Pinned to your wall</p>
        <p className={s.h3}>The Pale Hours · Night 2 of 3</p>
        <p className={s.body}>Paste the link from your ticket email. We find the night, the setlist and the weather, and print your stub.</p>
        <p className={s.data}>
          <span className="desk-label">Seat</span> Sec 104 · Row G · Seat 9 <span className="desk-label">Date</span> 12 Oct 2024 <span className="desk-label">Total</span> $104.00
        </p>
      </section>

      <StubDesk />

      <SoundBoard />

      <div className={s.cols}>
        <Specimen />
      </div>

      <section className={s.sheets}>
        <p className="desk-label">Paper sheet</p>
        <p className={s.body}>Slides up on phones with a torn top edge, and comes in from the side on desktop. Esc or tapping outside closes it.</p>
        <div className={s.row}>
          <PaperButton onClick={() => setSheet(true)}>Open a paper sheet</PaperButton>
        </div>
      </section>

      <PaperSheet open={sheet} onClose={() => setSheet(false)} title="Pinned to your wall">
        <div className={s.sheetBody}>
          <p className={s.body}>Your stub is finished. Share it, print it, or keep it on your phone.</p>
          <Stamp block price="$49">
            Print it
          </Stamp>
          <PaperButton block>Share your stub</PaperButton>
          <TearLink onClick={() => setSheet(false)}>Back to the stub</TearLink>
        </div>
      </PaperSheet>
    </main>
  );
}
